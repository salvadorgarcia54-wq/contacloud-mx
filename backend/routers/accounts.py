from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel

from database import get_db
from models.account import Account, SATAccountGroup
from models.client import Client
from models.user import User
from models.journal import JournalLine, JournalEntry
from schemas.account import AccountCreate, AccountUpdate, AccountResponse, SATGroupResponse
from routers.auth import require_role
from seed.default_accounts_template import is_default_active, DEFAULT_ACTIVE_ACCOUNT_NUMBERS

router = APIRouter(prefix="/api/accounts", tags=["accounts"])

def format_3_2_3(raw_num: str, sat_code: str = None) -> str:
    raw_num = str(raw_num or "").strip()
    sat_code = str(sat_code or "").strip()
    
    # If already hyphenated
    if '-' in raw_num:
        parts = [p.strip() for p in raw_num.split('-')]
        if len(parts) == 3:
            return f"{parts[0].zfill(3)[:3]}-{parts[1].zfill(2)[:2]}-{parts[2].zfill(3)[:3]}"
        elif len(parts) == 2:
            return f"{parts[0].zfill(3)[:3]}-{parts[1].zfill(2)[:2]}-000"

    # Try mapping from SAT code if available and raw_num is short
    if sat_code and len(raw_num) <= 5:
        parts = sat_code.split('.')
        seg1 = parts[0].zfill(3)[:3]
        if len(parts) > 1:
            sub = parts[1].strip()
            seg2 = (sub + '0') if len(sub) == 1 else sub.zfill(2)[:2]
        else:
            seg2 = '00'
        return f"{seg1}-{seg2}-000"

    digits = "".join(filter(str.isdigit, raw_num))
    if len(digits) >= 8:
        return f"{digits[:3]}-{digits[3:5]}-{digits[5:8]}"
    elif len(digits) <= 3:
        return f"{digits.zfill(3)}-00-000"
    elif len(digits) <= 5:
        return f"{digits[:3]}-{digits[3:].zfill(2)}-000"
    else:
        return f"{digits[:3]}-{digits[3:5].zfill(2)}-{digits[5:].zfill(3)[:3]}"

@router.get("/sat-catalog", response_model=List[SATGroupResponse])
def get_sat_catalog(
    account_type: Optional[str] = None,
    level: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    query = db.query(SATAccountGroup)
    if account_type:
        query = query.filter(SATAccountGroup.account_type == account_type)
    if level is not None:
        query = query.filter(SATAccountGroup.level == level)
    return query.order_by(SATAccountGroup.code.asc()).all()

@router.get("/client/{client_id}", response_model=List[AccountResponse])
def get_client_accounts(
    client_id: int,
    active_only: Optional[bool] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant", "client"))
):
    if current_user.role == "client" and current_user.client_id != client_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    query = db.query(Account).filter(Account.client_id == client_id)
    if active_only is True:
        query = query.filter(Account.is_active == True)
        
    # Sorteo por el primer digito y luego por el numero de cuenta (1xx, 2xx, 3xx, 4xx, etc.)
    return query.order_by(Account.account_number.asc()).all()

def _create_account_internal(account: AccountCreate, db: Session):
    sat_group = db.query(SATAccountGroup).filter(SATAccountGroup.code == account.sat_group_code).first()
    if not sat_group:
        raise HTTPException(status_code=400, detail="Código agrupador del SAT inválido")

    # Formatear a estructura 3 2 3 (XXX-XX-XXX) con relleno de ceros
    formatted_number = format_3_2_3(account.account_number, account.sat_group_code)
    
    # Validar que no exista
    existing = db.query(Account).filter(
        Account.client_id == account.client_id,
        Account.account_number == formatted_number
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"El número de cuenta '{formatted_number}' ya está registrado")

    # Determinar nivel según segmentos
    parts = formatted_number.split('-')
    if parts[1] == '00' and parts[2] == '000':
        level = 1
    elif parts[2] == '000':
        level = 2
    else:
        level = 3

    acc_dict = account.dict()
    acc_dict['account_number'] = formatted_number
    acc_dict['level'] = level
    if not acc_dict.get('classification'):
        acc_dict['classification'] = 'Afectable' if level >= 3 else 'Acumulación'
        
    new_account = Account(**acc_dict)
    db.add(new_account)
    db.commit()
    db.refresh(new_account)
    return new_account

@router.post("", response_model=AccountResponse)
@router.post("/", response_model=AccountResponse)
def create_account(
    account: AccountCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    return _create_account_internal(account, db)

@router.put("/{account_id}", response_model=AccountResponse)
def update_account(
    account_id: int,
    account_update: AccountUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
        
    update_data = account_update.dict(exclude_unset=True)
    if 'account_number' in update_data and update_data['account_number']:
        new_num = format_3_2_3(update_data['account_number'], account.sat_group_code)
        existing = db.query(Account).filter(
            Account.client_id == account.client_id,
            Account.account_number == new_num,
            Account.id != account_id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"El número de cuenta '{new_num}' ya está en uso")
        update_data['account_number'] = new_num
        
        parts = new_num.split('-')
        if parts[1] == '00' and parts[2] == '000':
            update_data['level'] = 1
        elif parts[2] == '000':
            update_data['level'] = 2
        else:
            update_data['level'] = 3
            
    for key, value in update_data.items():
        setattr(account, key, value)
        
    db.commit()
    db.refresh(account)
    return account

@router.delete("/{account_id}")
def delete_account(
    account_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    account.is_active = False
    db.commit()
    return {"message": "Cuenta desactivada"}

@router.post("/client/{client_id}/init-default")
def init_default_accounts(
    client_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    existing = db.query(Account).filter(Account.client_id == client_id).count()
    if existing > 0:
        raise HTTPException(status_code=400, detail="El cliente ya tiene cuentas registradas")
        
    sat_groups = db.query(SATAccountGroup).order_by(SATAccountGroup.code.asc()).all()
    created_accounts = []
    seen_numbers = set()
    l1_mapping = {}
    
    # 1. Cuentas de Mayor / Nivel 1 (sin punto): XXX-00-000, Clasificación: 'Acumulación'
    for group in [g for g in sat_groups if '.' not in g.code]:
        seg1 = group.code.zfill(3)[:3]
        acc_num = f"{seg1}-00-000"
        if acc_num in seen_numbers:
            continue
        seen_numbers.add(acc_num)
        level = 1 if group.code in ('100', '200', '300', '400', '500', '600', '700', '800') else 2
        
        acc = Account(
            client_id=client_id,
            account_number=acc_num,
            name=group.name,
            sat_group_code=group.code,
            level=level,
            nature=group.nature,
            classification='Acumulación',
            is_active=is_default_active(acc_num)
        )
        db.add(acc)
        db.flush()
        l1_mapping[seg1] = acc.id
        created_accounts.append(acc)
        
    # 2. Subcuentas oficiales del SAT (con punto): XXX-YY-000, Clasificación: 'Acumulación'
    for group in [g for g in sat_groups if '.' in g.code]:
        parts = group.code.split('.')
        base = parts[0].zfill(3)[:3]
        sub = parts[1].strip()
        seg2 = (sub + '0') if len(sub) == 1 else sub.zfill(2)[:2]
        acc_num = f"{base}-{seg2}-000"
        if acc_num in seen_numbers:
            continue
        seen_numbers.add(acc_num)
        
        parent_id = l1_mapping.get(base)
        acc = Account(
            client_id=client_id,
            account_number=acc_num,
            name=group.name,
            sat_group_code=group.code,
            level=2,
            nature=group.nature,
            parent_id=parent_id,
            classification='Acumulación',
            is_active=is_default_active(acc_num)
        )
        db.add(acc)
        created_accounts.append(acc)

    # 3. Cuenta de detalle bancaria inicial predeterminada (102-01-001)
    if "102-01-001" not in seen_numbers:
        parent_id = l1_mapping.get("102")
        acc = Account(
            client_id=client_id,
            account_number="102-01-001",
            name="BANCO CUENTA DE DETALLE",
            sat_group_code="102.01",
            level=3,
            nature="deudora",
            parent_id=parent_id,
            classification="Afectable",
            is_active=True
        )
        db.add(acc)
        created_accounts.append(acc)
        
    db.commit()

    active_cnt = sum(1 for a in created_accounts if a.is_active)
    inactive_cnt = len(created_accounts) - active_cnt
    return {
        "message": f"Catálogo inicializado con {len(created_accounts)} cuentas (Predeterminadas: {active_cnt} activas, {inactive_cnt} inactivas)",
        "total": len(created_accounts),
        "active_count": active_cnt,
        "inactive_count": inactive_cnt
    }

@router.post("/client/{client_id}/apply-defaults")
def apply_default_accounts(
    client_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    accounts = db.query(Account).filter(Account.client_id == client_id).all()
    if not accounts:
        raise HTTPException(status_code=400, detail="El cliente no tiene cuentas registradas")

    # Obtener conjunto de cuentas activas de Gabriela Velasquez Moreno (Cliente 5 o RFC VEMG841223EW4)
    template_active = set()
    gabi = db.query(Client).filter((Client.id == 5) | (Client.rfc == 'VEMG841223EW4')).first()
    if gabi:
        gabi_accs = db.query(Account).filter(Account.client_id == gabi.id, Account.is_active == True).all()
        template_active = {a.account_number for a in gabi_accs}

    if not template_active:
        template_active = set(DEFAULT_ACTIVE_ACCOUNT_NUMBERS)

    LEVEL_1_CODES = {
        '100-00-000', '200-00-000', '300-00-000', '400-00-000',
        '500-00-000', '600-00-000', '700-00-000', '800-00-000'
    }
    template_active.update(LEVEL_1_CODES)

    # Proteger cuentas que ya cuenten con pólizas registradas (movimientos contables) y sus cuentas padre de acumulación
    lines_query = (
        db.query(JournalLine.account_id)
        .join(JournalEntry, JournalEntry.id == JournalLine.entry_id)
        .filter(JournalEntry.client_id == client_id)
        .distinct()
        .all()
    )
    direct_used_ids = {row[0] for row in lines_query if row[0]}

    protected_account_numbers = set(LEVEL_1_CODES)
    acc_map = {a.id: a for a in accounts}
    for aid in direct_used_ids:
        acc = acc_map.get(aid)
        if acc:
            num = acc.account_number or ""
            protected_account_numbers.add(num)
            parts = num.split('-')
            if len(parts) >= 3:
                protected_account_numbers.add(f"{parts[0]}-00-000")
                protected_account_numbers.add(f"{parts[0]}-{parts[1]}-000")

    activated_count = 0
    deactivated_count = 0
    preserved_count = 0

    for acc in accounts:
        if acc.id in direct_used_ids or acc.account_number in protected_account_numbers:
            if not acc.is_active:
                acc.is_active = True
                activated_count += 1
            if acc.id in direct_used_ids:
                preserved_count += 1
        elif acc.account_number in template_active:
            if not acc.is_active:
                acc.is_active = True
                activated_count += 1
        else:
            if acc.is_active:
                acc.is_active = False
                deactivated_count += 1

    db.commit()

    total_active = db.query(Account).filter(Account.client_id == client_id, Account.is_active == True).count()
    total_inactive = db.query(Account).filter(Account.client_id == client_id, Account.is_active == False).count()

    msg = f"Se dejaron activas {total_active} cuentas predeterminadas y {total_inactive} cuentas desactivadas conforme al modelo de Gabriela Velasquez Moreno."
    if preserved_count > 0:
        msg += f" (Se preservaron {preserved_count} cuentas por contar con pólizas registradas)."

    return {
        "message": msg,
        "active_count": total_active,
        "inactive_count": total_inactive,
        "activated": activated_count,
        "deactivated": deactivated_count,
        "preserved_movements": preserved_count
    }


class BulkClassificationRequest(BaseModel):
    account_ids: List[int]
    classification: str


@router.post("/client/{client_id}/bulk-classification")
def bulk_update_classification(
    client_id: int,
    req: BulkClassificationRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    if req.classification not in ("Acumulación", "Afectable"):
        raise HTTPException(status_code=400, detail="Clasificación inválida; debe ser 'Acumulación' o 'Afectable'")

    if not req.account_ids:
        return {"updated_count": 0, "message": "No hay cuentas seleccionadas para actualizar."}

    target_accounts = (
        db.query(Account)
        .filter(Account.client_id == client_id, Account.id.in_(req.account_ids))
        .all()
    )
    updated_count = 0
    for acc in target_accounts:
        # Las cuentas de rubro de mayor (XXX-00-000) siempre se mantienen como Acumulación si hay subcuentas
        if req.classification == "Afectable" and (acc.account_number or "").endswith("-00-000"):
            continue
        if acc.classification != req.classification:
            acc.classification = req.classification
            updated_count += 1

    db.commit()
    return {
        "updated_count": updated_count,
        "classification": req.classification,
        "message": f"Se actualizaron {updated_count} cuenta(s) a '{req.classification}'."
    }

