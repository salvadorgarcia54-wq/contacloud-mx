from fastapi import APIRouter, Depends, HTTPException, Query, Body, UploadFile, File
from fastapi.responses import Response
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime, date
from decimal import Decimal
import json
import os

from database import get_db, get_effective_owner_id, ensure_user_columns
from models.user import User
from models.client import Client
from models.account import Account
from models.journal import JournalEntry, JournalLine
from models.cfdi import CFDIMapping, CFDIInvoice
from models.fixed_asset import FixedAsset
from models.bank import BankAccount, BankStatement, BankTransaction
from schemas.client import ClientCreate, ClientUpdate, ClientResponse
from schemas.user import UserCreate, UserResponse
from routers.auth import require_role, get_password_hash
from services.audit import log_activity

ensure_user_columns()

router = APIRouter(prefix="/api/clients", tags=["clients"])

class PortalUserRequest(BaseModel):
    username: str
    password: str

@router.get("", response_model=List[ClientResponse])
@router.get("/", response_model=List[ClientResponse])
def get_clients(
    skip: int = 0, 
    limit: int = 1000, 
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    owner_id = get_effective_owner_id(db, current_user)
    query = db.query(Client).filter(
        Client.is_active == True,
        Client.owner_user_id == owner_id,
    )
    if (current_user.role or "").strip().lower() != "admin":
        assigned_ids = [
            int(x) for x in (current_user.assigned_client_ids or [])
            if str(x).isdigit() or isinstance(x, int)
        ]
        if not assigned_ids:
            return []
        query = query.filter(Client.id.in_(assigned_ids))
    if search:
        search_term = f"%{search}%"
        query = query.filter(
            (Client.rfc.ilike(search_term)) | 
            (Client.business_name.ilike(search_term))
        )
    return query.offset(skip).limit(limit).all()

@router.get("/{client_id}", response_model=ClientResponse)
def get_client(
    client_id: int, 
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    owner_id = get_effective_owner_id(db, current_user)
    if current_user.role == "accountant":
        assigned_ids = current_user.assigned_client_ids or []
        if client_id not in assigned_ids:
            raise HTTPException(status_code=403, detail="No tiene asignado este cliente para trabajar")
    client = db.query(Client).filter(
        Client.id == client_id,
        Client.is_active == True,
        Client.owner_user_id == owner_id,
    ).first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    return client

def _save_new_client(client_data: ClientCreate, db: Session, current_user: User):
    if current_user.role != "admin" and not bool(current_user.can_create_clients):
        raise HTTPException(
            status_code=403,
            detail="No tiene permiso para dar de alta nuevos clientes. Solicite autorización al titular del despacho."
        )
    owner_id = get_effective_owner_id(db, current_user)
    count = db.query(Client).filter(
        Client.is_active == True,
        Client.owner_user_id == owner_id,
    ).count()
    if count >= 999:
        raise HTTPException(status_code=400, detail="Límite máximo de clientes alcanzado (999)")
        
    clean_rfc = client_data.rfc.strip().upper()
    existing = db.query(Client).filter(Client.rfc == clean_rfc).first()
    if existing:
        if not existing.is_active:
            # Reactivate client and assign to current tenant owner
            existing.is_active = True
            existing.owner_user_id = owner_id
            existing.business_name = client_data.business_name
            existing.legal_name = client_data.legal_name
            existing.tax_regime = client_data.tax_regime
            existing.postal_code = client_data.postal_code
            existing.address = client_data.address
            existing.phone = client_data.phone
            existing.email = client_data.email
            if current_user.role == "accountant":
                assigned = list(current_user.assigned_client_ids or [])
                if existing.id not in assigned:
                    assigned.append(existing.id)
                    current_user.assigned_client_ids = assigned
            db.commit()
            db.refresh(existing)
            return existing
        raise HTTPException(status_code=400, detail=f"El RFC '{clean_rfc}' ya está registrado con '{existing.business_name}'")
        
    client_dict = client_data.dict()
    client_dict.pop('status', None)
    client_dict['rfc'] = clean_rfc
    client_dict['owner_user_id'] = owner_id
    if client_data.status == 'inactivo':
        client_dict['is_active'] = False
        
    client = Client(**client_dict)
    db.add(client)
    db.commit()
    db.refresh(client)

    if current_user.role == "accountant":
        assigned = list(current_user.assigned_client_ids or [])
        if client.id not in assigned:
            assigned.append(client.id)
            current_user.assigned_client_ids = assigned
            db.commit()

    log_activity(
        db=db,
        user=current_user,
        action="CREAR_CLIENTE",
        module="Clientes",
        description=f"Dio de alta al cliente {client.business_name} ({client.rfc})",
        client_id=client.id,
        entity_id=client.id,
        details={"business_name": client.business_name, "rfc": client.rfc, "email": client.email}
    )

    return client

@router.post("", response_model=ClientResponse)
@router.post("/", response_model=ClientResponse)
def create_client(
    client_data: ClientCreate, 
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    return _save_new_client(client_data, db, current_user)

@router.put("/{client_id}", response_model=ClientResponse)
def update_client(
    client_id: int, 
    client_data: ClientUpdate, 
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    if current_user.role != "admin" and not bool(current_user.can_create_clients):
        raise HTTPException(
            status_code=403,
            detail="No cuenta con permiso para modificar la información del cliente. Solicite autorización al titular del despacho."
        )
    owner_id = get_effective_owner_id(db, current_user)
    client = db.query(Client).filter(Client.id == client_id, Client.owner_user_id == owner_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
        
    update_data = client_data.dict(exclude_unset=True)
    update_data.pop('status', None)
    if 'rfc' in update_data and update_data['rfc']:
        clean_rfc = update_data['rfc'].strip().upper()
        existing = db.query(Client).filter(Client.rfc == clean_rfc, Client.id != client_id).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"El RFC '{clean_rfc}' ya está registrado con otro cliente")
        update_data['rfc'] = clean_rfc

    if client_data.status == 'inactivo':
        update_data['is_active'] = False
    elif client_data.status == 'activo':
        update_data['is_active'] = True
        
    for key, value in update_data.items():
        setattr(client, key, value)
        
    db.commit()
    db.refresh(client)
    return client

@router.delete("/{client_id}")
def delete_client(
    client_id: int,
    temp_password: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    owner_id = get_effective_owner_id(db, current_user)
    if not temp_password or not temp_password.strip():
        raise HTTPException(
            status_code=403,
            detail="Se requiere una contraseña temporal vigente de 32 dígitos (UUID) para dar de baja a un cliente."
        )
    from routers.temp_passwords import validate_and_consume_temp_password
    tp = validate_and_consume_temp_password(db, temp_password, target_client_id=client_id)

    client = db.query(Client).filter(Client.id == client_id, Client.owner_user_id == owner_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    client.is_active = False
    db.commit()

    log_activity(
        db=db,
        user=current_user,
        action="BAJA_CLIENTE",
        module="Clientes",
        description=f"Dio de baja al cliente {client.business_name} ({client.rfc}) con clave temporal {tp.token_uuid[:8]}...",
        client_id=client.id,
        entity_id=client.id,
        details={"rfc": client.rfc, "business_name": client.business_name, "temp_password_id": tp.id}
    )

    return {"message": "Cliente dado de baja exitosamente"}

def _create_portal_user_internal(client_id: int, username: str, password: str, db: Session):
    client = db.query(Client).filter(Client.id == client_id, Client.is_active == True).first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
        
    existing_user = db.query(User).filter(User.username == username).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="El nombre de usuario ya existe")
        
    user = User(
        username=username,
        email=client.email,
        hashed_password=get_password_hash(password),
        full_name=f"Portal User - {client.business_name}",
        role="client",
        client_id=client_id,
        is_active=True
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

@router.post("/{client_id}/create-portal-user", response_model=UserResponse)
@router.post("/{client_id}/portal-user", response_model=UserResponse)
def create_portal_user(
    client_id: int,
    data: PortalUserRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    return _create_portal_user_internal(client_id, data.username, data.password, db)


@router.get("/{client_id}/backup")
def backup_client_data(
    client_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    if current_user.role == "accountant":
        assigned_ids = current_user.assigned_client_ids or []
        if client_id not in assigned_ids:
            raise HTTPException(status_code=403, detail="No tiene asignado este cliente para trabajar")

    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    # 1. Cuentas contables
    accounts = db.query(Account).filter(Account.client_id == client_id).order_by(Account.level.asc(), Account.account_number.asc()).all()
    id_to_acc_num = {a.id: a.account_number for a in accounts}

    accounts_data = [
        {
            "old_id": a.id,
            "account_number": a.account_number,
            "name": a.name,
            "sat_group_code": a.sat_group_code,
            "level": a.level,
            "nature": a.nature,
            "parent_account_number": id_to_acc_num.get(a.parent_id) if a.parent_id else None,
            "classification": a.classification,
            "is_active": bool(a.is_active),
        }
        for a in accounts
    ]

    # 2. Pólizas y movimientos
    entries = db.query(JournalEntry).filter(JournalEntry.client_id == client_id).order_by(JournalEntry.date.asc(), JournalEntry.id.asc()).all()
    entries_data = []
    for e in entries:
        lines_data = [
            {
                "old_line_id": l.id,
                "account_number": id_to_acc_num.get(l.account_id),
                "debit": float(l.debit or 0),
                "credit": float(l.credit or 0),
                "description": l.description,
                "line_order": l.line_order,
            }
            for l in sorted(e.lines or [], key=lambda x: x.line_order or 0)
        ]
        entries_data.append({
            "old_id": e.id,
            "entry_number": e.entry_number,
            "entry_type": e.entry_type,
            "date": e.date.isoformat() if e.date else None,
            "description": e.description,
            "reference": e.reference,
            "cfdi_uuid": e.cfdi_uuid,
            "cfdi_issuer_rfc": e.cfdi_issuer_rfc,
            "cfdi_issuer_name": e.cfdi_issuer_name,
            "cfdi_receiver_rfc": e.cfdi_receiver_rfc,
            "cfdi_total": float(e.cfdi_total) if e.cfdi_total is not None else None,
            "cfdi_xml_data": e.cfdi_xml_data,
            "is_auto": bool(e.is_auto),
            "is_cancelled": bool(e.is_cancelled),
            "lines": lines_data,
        })

    # 3. Mapeos CFDI
    mappings = db.query(CFDIMapping).filter(CFDIMapping.client_id == client_id).all()
    mappings_data = [
        {
            "mapping_type": m.mapping_type,
            "rfc": m.rfc,
            "clave_prod_serv": m.clave_prod_serv,
            "account_number": id_to_acc_num.get(m.account_id),
        }
        for m in mappings
    ]

    # 4. Facturas CFDI
    invoices = db.query(CFDIInvoice).filter(CFDIInvoice.client_id == client_id).all()
    invoices_data = [
        {
            "old_id": inv.id,
            "cfdi_type": inv.cfdi_type,
            "uuid": inv.uuid,
            "folio": inv.folio,
            "date": inv.date.isoformat() if inv.date else None,
            "issuer_rfc": inv.issuer_rfc,
            "issuer_name": inv.issuer_name,
            "receiver_rfc": inv.receiver_rfc,
            "receiver_name": inv.receiver_name,
            "payment_method": inv.payment_method,
            "payment_form": inv.payment_form,
            "cfdi_use": inv.cfdi_use,
            "clave_prod_serv": inv.clave_prod_serv,
            "description": inv.description,
            "subtotal": float(inv.subtotal or 0),
            "iva_trasladado": float(inv.iva_trasladado or 0),
            "retencion_isr": float(inv.retencion_isr or 0),
            "retencion_iva": float(inv.retencion_iva or 0),
            "total": float(inv.total or 0),
            "assigned_account_number": id_to_acc_num.get(inv.assigned_account_id) if inv.assigned_account_id else None,
            "journal_entry_old_id": inv.journal_entry_id,
            "is_posted": bool(inv.is_posted),
            "tipo_comprobante": inv.tipo_comprobante,
            "related_uuid": inv.related_uuid,
            "related_folio": inv.related_folio,
            "raw_xml": inv.raw_xml,
        }
        for inv in invoices
    ]

    # 5. Activos Fijos / Inversiones
    assets = db.query(FixedAsset).filter(FixedAsset.client_id == client_id).all()
    assets_data = [
        {
            "cfdi_uuid": fa.cfdi_uuid,
            "description": fa.description,
            "asset_type": fa.asset_type,
            "asset_type_label": fa.asset_type_label,
            "acquisition_date": fa.acquisition_date.isoformat() if fa.acquisition_date else None,
            "depreciation_start_date": fa.depreciation_start_date.isoformat() if fa.depreciation_start_date else None,
            "has_disposal": bool(fa.has_disposal),
            "disposal_date": fa.disposal_date.isoformat() if fa.disposal_date else None,
            "moi": float(fa.moi or 0),
            "depreciation_rate": float(fa.depreciation_rate or 0),
            "deductible_moi": float(fa.deductible_moi or 0),
            "deductible_depreciation_rate": float(fa.deductible_depreciation_rate or 0),
            "sale_price": float(fa.sale_price or 0),
            "asset_account_number": id_to_acc_num.get(fa.asset_account_id) if fa.asset_account_id else None,
            "depreciation_account_number": id_to_acc_num.get(fa.depreciation_account_id) if fa.depreciation_account_id else None,
            "expense_account_number": id_to_acc_num.get(fa.expense_account_id) if fa.expense_account_id else None,
            "non_deductible_account_number": id_to_acc_num.get(fa.non_deductible_account_id) if fa.non_deductible_account_id else None,
            "is_active": bool(fa.is_active),
        }
        for fa in assets
    ]

    # 6. Cuentas Bancarias, Estados de Cuenta y Transacciones
    bank_accounts = db.query(BankAccount).filter(BankAccount.client_id == client_id).all()
    banks_data = []
    for ba in bank_accounts:
        stmts_data = []
        for st in ba.statements or []:
            txs_data = [
                {
                    "date": tx.date.isoformat() if tx.date else None,
                    "description": tx.description,
                    "reference": tx.reference,
                    "amount": float(tx.amount or 0),
                    "transaction_type": tx.transaction_type,
                    "is_reconciled": bool(tx.is_reconciled),
                    "matched_journal_line_old_id": tx.matched_journal_line_id,
                }
                for tx in st.transactions or []
            ]
            stmts_data.append({
                "period_year": st.period_year,
                "period_month": st.period_month,
                "initial_balance": float(st.initial_balance or 0),
                "final_balance": float(st.final_balance or 0),
                "file_name": st.file_name,
                "transactions": txs_data,
            })
        banks_data.append({
            "bank_name": ba.bank_name,
            "account_number": ba.account_number,
            "clabe": ba.clabe,
            "currency": ba.currency,
            "linked_account_number": id_to_acc_num.get(ba.linked_account_id) if ba.linked_account_id else None,
            "is_active": bool(ba.is_active),
            "statements": stmts_data,
        })

    timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_payload = {
        "backup_version": "1.0",
        "system": "ContaCloud MX",
        "created_at": datetime.now().isoformat(),
        "client": {
            "rfc": client.rfc,
            "business_name": client.business_name,
            "legal_name": client.legal_name,
            "tax_regime": client.tax_regime,
            "postal_code": client.postal_code,
            "address": client.address,
            "phone": client.phone,
            "email": client.email,
            "is_active": bool(client.is_active),
        },
        "summary": {
            "accounts_count": len(accounts_data),
            "journal_entries_count": len(entries_data),
            "cfdi_invoices_count": len(invoices_data),
            "fixed_assets_count": len(assets_data),
            "bank_accounts_count": len(banks_data),
        },
        "accounts": accounts_data,
        "journal_entries": entries_data,
        "cfdi_mappings": mappings_data,
        "cfdi_invoices": invoices_data,
        "fixed_assets": assets_data,
        "bank_accounts": banks_data,
    }

    json_str = json.dumps(backup_payload, ensure_ascii=False, indent=2)

    # Guardar copia de respaldo en el servidor además de enviarla para descarga inmediata
    try:
        backups_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "backups")
        os.makedirs(backups_dir, exist_ok=True)
        local_file = os.path.join(backups_dir, f"Respaldo_{client.rfc}_{timestamp_str}.json")
        with open(local_file, "w", encoding="utf-8") as f:
            f.write(json_str)
    except Exception as e:
        print(f"Note saving local backup copy: {e}")

    filename = f"Respaldo_{client.rfc}_{timestamp_str}.json"

    log_activity(
        db=db,
        user=current_user,
        action="DESCARGAR_RESPALDO",
        module="Respaldos",
        description=f"Descargó respaldo completo de datos de {client.business_name} ({client.rfc})",
        client_id=client.id,
        details={
            "filename": filename,
            "accounts_count": len(accounts_data),
            "journal_entries_count": len(entries_data),
            "cfdi_invoices_count": len(invoices_data),
            "fixed_assets_count": len(assets_data)
        }
    )

    return Response(
        content=json_str.encode("utf-8"),
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        }
    )


@router.post("/{client_id}/restore")
async def restore_client_backup(
    client_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    if current_user.role == "accountant":
        assigned_ids = current_user.assigned_client_ids or []
        if client_id not in assigned_ids:
            raise HTTPException(status_code=403, detail="No tiene asignado este cliente para trabajar")

    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    try:
        raw_bytes = await file.read()
        backup = json.loads(raw_bytes.decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail="El archivo seleccionado no es un respaldo JSON válido")

    if not isinstance(backup, dict) or "accounts" not in backup or "journal_entries" not in backup:
        raise HTTPException(
            status_code=400,
            detail="El archivo no tiene la estructura de respaldo de ContaCloud MX"
        )

    try:
        # 1. Limpiar datos actuales del cliente en orden inverso de dependencia
        existing_banks = db.query(BankAccount).filter(BankAccount.client_id == client_id).all()
        for ba in existing_banks:
            for st in ba.statements or []:
                db.query(BankTransaction).filter(BankTransaction.statement_id == st.id).delete(synchronize_session=False)
            db.query(BankStatement).filter(BankStatement.bank_account_id == ba.id).delete(synchronize_session=False)
        db.query(BankAccount).filter(BankAccount.client_id == client_id).delete(synchronize_session=False)

        db.query(FixedAsset).filter(FixedAsset.client_id == client_id).delete(synchronize_session=False)
        db.query(CFDIInvoice).filter(CFDIInvoice.client_id == client_id).delete(synchronize_session=False)
        db.query(CFDIMapping).filter(CFDIMapping.client_id == client_id).delete(synchronize_session=False)

        existing_entries = db.query(JournalEntry).filter(JournalEntry.client_id == client_id).all()
        for e in existing_entries:
            db.query(JournalLine).filter(JournalLine.entry_id == e.id).delete(synchronize_session=False)
        db.query(JournalEntry).filter(JournalEntry.client_id == client_id).delete(synchronize_session=False)

        # Desvincular parent_id antes de eliminar cuentas para evitar restricción FK
        db.query(Account).filter(Account.client_id == client_id).update({"parent_id": None}, synchronize_session=False)
        db.query(Account).filter(Account.client_id == client_id).delete(synchronize_session=False)
        db.flush()

        # 2. Actualizar datos básicos del cliente si vienen en el respaldo (conservando su RFC único o actualizando campos)
        c_info = backup.get("client") or {}
        if c_info.get("business_name"):
            client.business_name = c_info["business_name"]
        if "legal_name" in c_info:
            client.legal_name = c_info["legal_name"]
        if "tax_regime" in c_info:
            client.tax_regime = c_info["tax_regime"]
        if "postal_code" in c_info:
            client.postal_code = c_info["postal_code"]
        if "address" in c_info:
            client.address = c_info["address"]
        if "phone" in c_info:
            client.phone = c_info["phone"]
        if "email" in c_info:
            client.email = c_info["email"]

        # 3. Restaurar Cuentas Contables
        acc_num_to_obj = {}
        accounts_list = backup.get("accounts") or []
        for a_data in accounts_list:
            acc_num = a_data.get("account_number")
            if not acc_num:
                continue
            new_acc = Account(
                client_id=client_id,
                account_number=acc_num,
                name=a_data.get("name") or acc_num,
                sat_group_code=a_data.get("sat_group_code") or "100",
                level=int(a_data.get("level") or 1),
                nature=a_data.get("nature") or "deudora",
                classification=a_data.get("classification") or "Acumulación",
                is_active=bool(a_data.get("is_active", True)),
            )
            db.add(new_acc)
            acc_num_to_obj[acc_num] = new_acc

        db.flush()

        # Vincular parent_id por parent_account_number
        for a_data in accounts_list:
            acc_num = a_data.get("account_number")
            parent_num = a_data.get("parent_account_number")
            if acc_num in acc_num_to_obj and parent_num and parent_num in acc_num_to_obj:
                acc_num_to_obj[acc_num].parent_id = acc_num_to_obj[parent_num].id

        db.flush()

        # 4. Restaurar Pólizas y Líneas
        old_entry_to_new_id = {}
        old_line_to_new_id = {}
        entries_list = backup.get("journal_entries") or []
        for e_data in entries_list:
            e_date_str = e_data.get("date")
            e_date = date.fromisoformat(e_date_str[:10]) if e_date_str else date.today()
            new_entry = JournalEntry(
                client_id=client_id,
                entry_number=int(e_data.get("entry_number") or 1),
                entry_type=e_data.get("entry_type") or "diario",
                date=e_date,
                description=e_data.get("description"),
                reference=e_data.get("reference"),
                cfdi_uuid=e_data.get("cfdi_uuid"),
                cfdi_issuer_rfc=e_data.get("cfdi_issuer_rfc"),
                cfdi_issuer_name=e_data.get("cfdi_issuer_name"),
                cfdi_receiver_rfc=e_data.get("cfdi_receiver_rfc"),
                cfdi_total=Decimal(str(e_data["cfdi_total"])) if e_data.get("cfdi_total") is not None else None,
                cfdi_xml_data=e_data.get("cfdi_xml_data"),
                is_auto=bool(e_data.get("is_auto", False)),
                is_cancelled=bool(e_data.get("is_cancelled", False)),
                created_by=current_user.id,
            )
            db.add(new_entry)
            db.flush()

            if e_data.get("old_id") is not None:
                old_entry_to_new_id[e_data["old_id"]] = new_entry.id

            for idx, l_data in enumerate(e_data.get("lines") or []):
                acc_num = l_data.get("account_number")
                target_acc = acc_num_to_obj.get(acc_num)
                if not target_acc:
                    continue
                new_line = JournalLine(
                    entry_id=new_entry.id,
                    account_id=target_acc.id,
                    debit=Decimal(str(l_data.get("debit") or 0)),
                    credit=Decimal(str(l_data.get("credit") or 0)),
                    description=l_data.get("description"),
                    line_order=int(l_data.get("line_order") or (idx + 1)),
                )
                db.add(new_line)
                db.flush()
                if l_data.get("old_line_id") is not None:
                    old_line_to_new_id[l_data["old_line_id"]] = new_line.id

        # 5. Restaurar Mapeos CFDI
        for m_data in backup.get("cfdi_mappings") or []:
            target_acc = acc_num_to_obj.get(m_data.get("account_number"))
            if not target_acc:
                continue
            db.add(CFDIMapping(
                client_id=client_id,
                mapping_type=m_data.get("mapping_type") or "recibido",
                rfc=m_data.get("rfc") or "",
                clave_prod_serv=m_data.get("clave_prod_serv"),
                account_id=target_acc.id,
            ))

        # 6. Restaurar Facturas CFDI
        uuid_to_invoice_id = {}
        invoices_list = backup.get("cfdi_invoices") or []
        for inv_data in invoices_list:
            inv_date_str = inv_data.get("date")
            try:
                inv_dt = datetime.fromisoformat(inv_date_str) if inv_date_str else datetime.now()
            except Exception:
                inv_dt = datetime.now()

            assigned_acc = acc_num_to_obj.get(inv_data.get("assigned_account_number"))
            linked_entry_id = old_entry_to_new_id.get(inv_data.get("journal_entry_old_id"))

            new_inv = CFDIInvoice(
                client_id=client_id,
                cfdi_type=inv_data.get("cfdi_type") or "recibido",
                uuid=inv_data.get("uuid"),
                folio=inv_data.get("folio"),
                date=inv_dt,
                issuer_rfc=inv_data.get("issuer_rfc"),
                issuer_name=inv_data.get("issuer_name"),
                receiver_rfc=inv_data.get("receiver_rfc"),
                receiver_name=inv_data.get("receiver_name"),
                payment_method=inv_data.get("payment_method"),
                payment_form=inv_data.get("payment_form"),
                cfdi_use=inv_data.get("cfdi_use"),
                clave_prod_serv=inv_data.get("clave_prod_serv"),
                description=inv_data.get("description"),
                subtotal=Decimal(str(inv_data.get("subtotal") or 0)),
                iva_trasladado=Decimal(str(inv_data.get("iva_trasladado") or 0)),
                retencion_isr=Decimal(str(inv_data.get("retencion_isr") or 0)),
                retencion_iva=Decimal(str(inv_data.get("retencion_iva") or 0)),
                total=Decimal(str(inv_data.get("total") or 0)),
                assigned_account_id=assigned_acc.id if assigned_acc else None,
                journal_entry_id=linked_entry_id,
                is_posted=bool(inv_data.get("is_posted", False)),
                tipo_comprobante=inv_data.get("tipo_comprobante") or "I",
                related_uuid=inv_data.get("related_uuid"),
                related_folio=inv_data.get("related_folio"),
                raw_xml=inv_data.get("raw_xml"),
            )
            db.add(new_inv)
            db.flush()
            if new_inv.uuid:
                uuid_to_invoice_id[new_inv.uuid] = new_inv.id

        # 7. Restaurar Activos Fijos / Inversiones
        assets_list = backup.get("fixed_assets") or []
        for fa_data in assets_list:
            acq_str = fa_data.get("acquisition_date")
            dep_str = fa_data.get("depreciation_start_date")
            disp_str = fa_data.get("disposal_date")
            acq_date = date.fromisoformat(acq_str[:10]) if acq_str else date.today()
            dep_date = date.fromisoformat(dep_str[:10]) if dep_str else acq_date
            disp_date = date.fromisoformat(disp_str[:10]) if disp_str else None

            asset_acc = acc_num_to_obj.get(fa_data.get("asset_account_number"))
            dep_acc = acc_num_to_obj.get(fa_data.get("depreciation_account_number"))
            exp_acc = acc_num_to_obj.get(fa_data.get("expense_account_number"))
            nonded_acc = acc_num_to_obj.get(fa_data.get("non_deductible_account_number"))

            db.add(FixedAsset(
                client_id=client_id,
                cfdi_invoice_id=uuid_to_invoice_id.get(fa_data.get("cfdi_uuid")),
                cfdi_uuid=fa_data.get("cfdi_uuid"),
                description=fa_data.get("description") or "Activo Fijo",
                asset_type=fa_data.get("asset_type") or "151-00-000",
                asset_type_label=fa_data.get("asset_type_label"),
                acquisition_date=acq_date,
                depreciation_start_date=dep_date,
                has_disposal=bool(fa_data.get("has_disposal", False)),
                disposal_date=disp_date,
                moi=Decimal(str(fa_data.get("moi") or 0)),
                depreciation_rate=Decimal(str(fa_data.get("depreciation_rate") or 0)),
                deductible_moi=Decimal(str(fa_data.get("deductible_moi") or 0)),
                deductible_depreciation_rate=Decimal(str(fa_data.get("deductible_depreciation_rate") or 0)),
                sale_price=Decimal(str(fa_data.get("sale_price") or 0)),
                asset_account_id=asset_acc.id if asset_acc else None,
                depreciation_account_id=dep_acc.id if dep_acc else None,
                expense_account_id=exp_acc.id if exp_acc else None,
                non_deductible_account_id=nonded_acc.id if nonded_acc else None,
                is_active=bool(fa_data.get("is_active", True)),
            ))

        # 8. Restaurar Cuentas Bancarias y Conciliaciones
        banks_list = backup.get("bank_accounts") or []
        for ba_data in banks_list:
            linked_acc = acc_num_to_obj.get(ba_data.get("linked_account_number"))
            new_ba = BankAccount(
                client_id=client_id,
                bank_name=ba_data.get("bank_name") or "Banco",
                account_number=ba_data.get("account_number"),
                clabe=ba_data.get("clabe"),
                currency=ba_data.get("currency") or "MXN",
                linked_account_id=linked_acc.id if linked_acc else None,
                is_active=bool(ba_data.get("is_active", True)),
            )
            db.add(new_ba)
            db.flush()

            for st_data in ba_data.get("statements") or []:
                new_st = BankStatement(
                    bank_account_id=new_ba.id,
                    period_year=int(st_data.get("period_year") or datetime.now().year),
                    period_month=int(st_data.get("period_month") or 1),
                    initial_balance=Decimal(str(st_data.get("initial_balance") or 0)),
                    final_balance=Decimal(str(st_data.get("final_balance") or 0)),
                    file_name=st_data.get("file_name"),
                )
                db.add(new_st)
                db.flush()

                for tx_data in st_data.get("transactions") or []:
                    tx_date_str = tx_data.get("date")
                    tx_date = date.fromisoformat(tx_date_str[:10]) if tx_date_str else date.today()
                    matched_line_id = old_line_to_new_id.get(tx_data.get("matched_journal_line_old_id"))
                    db.add(BankTransaction(
                        statement_id=new_st.id,
                        date=tx_date,
                        description=tx_data.get("description"),
                        reference=tx_data.get("reference"),
                        amount=Decimal(str(tx_data.get("amount") or 0)),
                        transaction_type=tx_data.get("transaction_type") or "cargo",
                        is_reconciled=bool(tx_data.get("is_reconciled", False)),
                        matched_journal_line_id=matched_line_id,
                    ))

        db.commit()

        log_activity(
            db=db,
            user=current_user,
            action="RESTAURAR_RESPALDO",
            module="Respaldos",
            description=f"Restauró respaldo de datos para {client.business_name} ({len(accounts_list)} cuentas, {len(entries_list)} pólizas, {len(invoices_list)} CFDIs)",
            client_id=client.id,
            details={
                "accounts_restored": len(accounts_list),
                "journal_entries_restored": len(entries_list),
                "cfdi_invoices_restored": len(invoices_list),
                "assets_restored": len(assets_list)
            }
        )

        return {
            "message": f"Respaldo restaurado exitosamente para {client.business_name}",
            "restored": {
                "accounts": len(accounts_list),
                "journal_entries": len(entries_list),
                "cfdi_invoices": len(invoices_list),
                "fixed_assets": len(assets_list),
                "bank_accounts": len(banks_list),
            }
        }
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Error al restaurar el respaldo: {str(e)}")

