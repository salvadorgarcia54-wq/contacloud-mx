from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from sqlalchemy.orm import Session
from sqlalchemy import func, case, or_
from typing import List, Optional, Dict, Any
from datetime import date

from database import get_db
from models.journal import JournalEntry, JournalLine
from models.account import Account
from models.user import User
from schemas.journal import JournalEntryCreate, JournalEntryResponse, JournalEntryListResponse
from routers.auth import get_current_user, require_role
from services.audit import log_activity

try:
    from services.cfdi_parser import parse_cfdi_xml, generate_journal_entry_from_cfdi
    CFDI_SERVICE_AVAILABLE = True
except ImportError:
    CFDI_SERVICE_AVAILABLE = False

router = APIRouter(prefix="/api/journals", tags=["journals"])


def is_resultado_account(account_number: Optional[str]) -> bool:
    """Devuelve True si la cuenta pertenece a Cuentas de Resultados (4xx, 5xx, 6xx, 7xx)."""
    num = (account_number or "").strip()
    return bool(num) and num[0] in ("4", "5", "6", "7")


def get_closing_entry_for_year(db: Session, client_id: int, year: int) -> Optional[JournalEntry]:
    """Busca si el ejercicio fiscal ya cuenta con una Póliza de Cierre activa."""
    return (
        db.query(JournalEntry)
        .filter(
            JournalEntry.client_id == client_id,
            JournalEntry.reference == f"CIERRE-{year}",
            JournalEntry.is_cancelled == False,
        )
        .order_by(JournalEntry.id.desc())
        .first()
    )


def get_closed_years(db: Session, client_id: int) -> List[int]:
    """Devuelve la lista de años que tienen Póliza de Cierre activa para este cliente."""
    closing_entries = (
        db.query(JournalEntry)
        .filter(
            JournalEntry.client_id == client_id,
            JournalEntry.reference.like("CIERRE-%"),
            JournalEntry.is_cancelled == False,
        )
        .all()
    )
    years = set()
    for e in closing_entries:
        ref = (e.reference or "").strip()
        if ref.startswith("CIERRE-"):
            yr_part = ref.replace("CIERRE-", "").strip()
            if yr_part.isdigit():
                years.add(int(yr_part))
    return sorted(years)


def _find_or_create_result_closing_account(
    db: Session,
    client_id: int,
    year: int,
    is_utilidad: bool,
    create_if_missing: bool = True,
) -> Dict[str, Any]:
    """
    Localiza o crea de forma automática la cuenta afectable:
      - 304-01-xxx con nombre "Utilidad del ejercicio 20xx" si es utilidad
      - 304-02-xxx con nombre "Pérdida del ejercicio 20xx" si es pérdida
    """
    if is_utilidad:
        prefix = "304-01-"
        parent_num = "304-01-000"
        sat_code = "304.01"
        nature = "acreedora"
        target_name = f"Utilidad del ejercicio {year}"
        match_names = {f"utilidad del ejercicio {year}"}
    else:
        prefix = "304-02-"
        parent_num = "304-02-000"
        sat_code = "304.02"
        nature = "deudora"
        target_name = f"Pérdida del ejercicio {year}"
        match_names = {f"pérdida del ejercicio {year}", f"perdida del ejercicio {year}"}

    existing_subs = (
        db.query(Account)
        .filter(
            Account.client_id == client_id,
            Account.account_number.like(f"{prefix}%"),
            Account.account_number != parent_num,
        )
        .order_by(Account.account_number.asc())
        .all()
    )

    for sub in existing_subs:
        if (sub.name or "").strip().lower() in match_names:
            if create_if_missing and (not sub.is_active or sub.classification != "Afectable"):
                sub.is_active = True
                sub.classification = "Afectable"
                db.commit()
                db.refresh(sub)
            return {
                "account": sub,
                "account_id": sub.id,
                "account_number": sub.account_number,
                "account_name": sub.name,
                "already_exists": True,
            }

    # Calcular siguiente consecutivo 304-01-xxx o 304-02-xxx
    max_seq = 0
    for sub in existing_subs:
        parts = (sub.account_number or "").split("-")
        if len(parts) == 3 and parts[2].isdigit():
            seq = int(parts[2])
            if seq > max_seq:
                max_seq = seq

    next_seq = max_seq + 1
    new_acc_number = f"{prefix}{next_seq:03d}"

    if not create_if_missing:
        return {
            "account": None,
            "account_id": None,
            "account_number": new_acc_number,
            "account_name": target_name,
            "already_exists": False,
        }

    # Asegurar que 304-00-000 y la cuenta acumulativa padre (304-01-000 o 304-02-000) estén activas
    mayor_304 = (
        db.query(Account)
        .filter(Account.client_id == client_id, Account.account_number == "304-00-000")
        .first()
    )
    if mayor_304 and not mayor_304.is_active:
        mayor_304.is_active = True

    parent_acc = (
        db.query(Account)
        .filter(Account.client_id == client_id, Account.account_number == parent_num)
        .first()
    )
    if parent_acc and not parent_acc.is_active:
        parent_acc.is_active = True

    new_acc = Account(
        client_id=client_id,
        account_number=new_acc_number,
        name=target_name,
        sat_group_code=sat_code,
        level=3,
        nature=parent_acc.nature if parent_acc and parent_acc.nature else nature,
        parent_id=parent_acc.id if parent_acc else (mayor_304.id if mayor_304 else None),
        classification="Afectable",
        is_active=True,
    )
    db.add(new_acc)
    db.commit()
    db.refresh(new_acc)

    return {
        "account": new_acc,
        "account_id": new_acc.id,
        "account_number": new_acc.account_number,
        "account_name": new_acc.name,
        "already_exists": False,
    }


def _compute_year_end_close_data(
    db: Session,
    client_id: int,
    year: int,
    create_account: bool = False,
) -> Dict[str, Any]:
    start_date = date(year, 1, 1)
    end_date = date(year, 12, 31)
    ref_code = f"CIERRE-{year}"

    # Obtener todos los movimientos de cuentas de resultados del ejercicio (excluyendo póliza de cierre si existiera)
    rows = (
        db.query(
            Account.id,
            Account.account_number,
            Account.name,
            func.sum(JournalLine.debit).label("tot_debit"),
            func.sum(JournalLine.credit).label("tot_credit"),
        )
        .join(JournalLine, JournalLine.account_id == Account.id)
        .join(JournalEntry, JournalLine.entry_id == JournalEntry.id)
        .filter(
            JournalEntry.client_id == client_id,
            JournalEntry.date >= start_date,
            JournalEntry.date <= end_date,
            JournalEntry.is_cancelled == False,
            or_(JournalEntry.reference == None, JournalEntry.reference != ref_code),
        )
        .group_by(Account.id, Account.account_number, Account.name)
        .order_by(Account.account_number.asc())
        .all()
    )

    closing_lines = []
    sum_closing_debits = 0.0
    sum_closing_credits = 0.0

    for row in rows:
        if not is_resultado_account(row.account_number):
            continue
        tot_deb = float(row.tot_debit or 0.0)
        tot_cred = float(row.tot_credit or 0.0)
        net_debit = round(tot_deb - tot_cred, 2)

        if abs(net_debit) < 0.01:
            continue

        # Si el saldo de la cuenta de resultados es Deudor (net_debit > 0, ej. Costos/Gastos):
        # Para cancelarla a cero se ABONA (credit = net_debit).
        # Si el saldo de la cuenta de resultados es Acreedor (net_debit < 0, ej. Ingresos):
        # Para cancelarla a cero se CARGA (debit = abs(net_debit)).
        if net_debit > 0:
            c_debit = 0.0
            c_credit = net_debit
        else:
            c_debit = round(abs(net_debit), 2)
            c_credit = 0.0

        sum_closing_debits = round(sum_closing_debits + c_debit, 2)
        sum_closing_credits = round(sum_closing_credits + c_credit, 2)

        closing_lines.append({
            "account_id": row.id,
            "account_number": row.account_number,
            "account_name": row.name,
            "debit": c_debit,
            "credit": c_credit,
            "description": f"Cancelación por cierre del ejercicio {year} - {row.name}",
            "is_result_account": False,
        })

    # Resultado neto = Ingresos netos cancelados (sum_closing_debits) - Egresos netos cancelados (sum_closing_credits)
    resultado_neto = round(sum_closing_debits - sum_closing_credits, 2)
    is_utilidad = resultado_neto >= 0
    result_amount = round(abs(resultado_neto), 2)

    acc_info = _find_or_create_result_closing_account(
        db=db,
        client_id=client_id,
        year=year,
        is_utilidad=is_utilidad,
        create_if_missing=create_account,
    )

    if closing_lines and result_amount > 0:
        if is_utilidad:
            # Utilidad del ejercicio: se ABONA a 304-01-xxx ("Utilidad del ejercicio 20xx")
            closing_lines.append({
                "account_id": acc_info["account_id"],
                "account_number": acc_info["account_number"],
                "account_name": acc_info["account_name"],
                "debit": 0.0,
                "credit": result_amount,
                "description": f"Traspaso de la {acc_info['account_name']}",
                "is_result_account": True,
            })
            sum_closing_credits = round(sum_closing_credits + result_amount, 2)
        else:
            # Pérdida del ejercicio: se CARGA a 304-02-xxx ("Pérdida del ejercicio 20xx")
            closing_lines.append({
                "account_id": acc_info["account_id"],
                "account_number": acc_info["account_number"],
                "account_name": acc_info["account_name"],
                "debit": result_amount,
                "credit": 0.0,
                "description": f"Traspaso de la {acc_info['account_name']}",
                "is_result_account": True,
            })
            sum_closing_debits = round(sum_closing_debits + result_amount, 2)

    return {
        "year": year,
        "entry_date": end_date.isoformat(),
        "formatted_date": end_date.strftime("%d/%m/%Y"),
        "concepto": f"Póliza de cierre del ejercicio {year} - Cancelación de cuentas de resultados",
        "reference": ref_code,
        "result_type": "utilidad" if is_utilidad else "perdida",
        "result_label": f"Utilidad del ejercicio {year}" if is_utilidad else f"Pérdida del ejercicio {year}",
        "result_amount": result_amount,
        "target_account_id": acc_info["account_id"],
        "target_account_number": acc_info["account_number"],
        "target_account_name": acc_info["account_name"],
        "target_account_already_exists": acc_info["already_exists"],
        "cuentas_resultados_count": len([l for l in closing_lines if not l["is_result_account"]]),
        "total_debit": sum_closing_debits,
        "total_credit": sum_closing_credits,
        "lines": closing_lines,
    }


@router.get("/client/{client_id}/year-end-close/{year}")
def get_year_end_close_info(
    client_id: int,
    year: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant", "client"))
):
    if current_user.role == "client" and current_user.client_id != client_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    existing = get_closing_entry_for_year(db, client_id, year)
    closed_years = get_closed_years(db, client_id)
    preview = _compute_year_end_close_data(db, client_id, year, create_account=False)

    closing_entry_info = None
    if existing:
        acc_map = {
            a.id: a
            for a in db.query(Account).filter(Account.client_id == client_id).all()
        }
        existing_lines = []
        res_acc_num = preview["target_account_number"]
        res_acc_name = preview["target_account_name"]
        for l in existing.lines:
            acc = acc_map.get(l.account_id)
            num = acc.account_number if acc else ""
            name = acc.name if acc else ""
            is_res = num.startswith("304-01-") or num.startswith("304-02-")
            if is_res:
                res_acc_num = num
                res_acc_name = name
            existing_lines.append({
                "id": l.id,
                "account_id": l.account_id,
                "account_number": num,
                "account_name": name,
                "debit": float(l.debit or 0),
                "credit": float(l.credit or 0),
                "description": l.description,
                "is_result_account": is_res,
            })

        closing_entry_info = {
            "id": existing.id,
            "entry_number": existing.entry_number,
            "entry_type": existing.entry_type,
            "date": existing.date.isoformat() if existing.date else f"{year}-12-31",
            "formatted_date": existing.date.strftime("%d/%m/%Y") if existing.date else f"31/12/{year}",
            "description": existing.description,
            "reference": existing.reference,
            "result_account_number": res_acc_num,
            "result_account_name": res_acc_name,
            "total_debit": round(sum(float(l.debit or 0) for l in existing.lines), 2),
            "total_credit": round(sum(float(l.credit or 0) for l in existing.lines), 2),
            "lines": existing_lines,
        }

    return {
        "client_id": client_id,
        "year": year,
        "is_closed": existing is not None,
        "closed_years": closed_years,
        "closing_entry": closing_entry_info,
        "preview": preview,
    }


@router.post("/client/{client_id}/year-end-close/{year}")
def create_year_end_close_entry(
    client_id: int,
    year: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    existing = get_closing_entry_for_year(db, client_id, year)
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"El ejercicio {year} ya cuenta con la Póliza de Cierre #{existing.entry_number}. Si necesita regenerarla, primero revierta la póliza de cierre actual."
        )

    close_data = _compute_year_end_close_data(db, client_id, year, create_account=True)
    lines = close_data["lines"]
    if not lines or close_data["cuentas_resultados_count"] == 0:
        raise HTTPException(
            status_code=400,
            detail=f"No existen saldos pendientes en cuentas de resultados (400 a 700) en el ejercicio {year} para generar la Póliza de Cierre."
        )

    entry_date = date(year, 12, 31)
    max_num = db.query(func.max(JournalEntry.entry_number)).filter(
        JournalEntry.client_id == client_id,
        JournalEntry.entry_type == "diario",
        func.strftime("%Y", JournalEntry.date) == str(year)
    ).scalar()
    new_num = (max_num or 0) + 1

    db_entry = JournalEntry(
        client_id=client_id,
        entry_number=new_num,
        entry_type="diario",
        date=entry_date,
        description=close_data["concepto"],
        reference=close_data["reference"],
        is_auto=True,
        is_cancelled=False,
        created_by=current_user.id,
    )
    db.add(db_entry)
    db.flush()

    for idx, line in enumerate(lines):
        db.add(JournalLine(
            entry_id=db_entry.id,
            account_id=line["account_id"],
            debit=line["debit"],
            credit=line["credit"],
            description=line["description"],
            line_order=idx + 1,
        ))

    db.commit()
    db.refresh(db_entry)

    log_activity(
        db=db,
        user=current_user,
        action="CIERRE_EJERCICIO",
        module="Cierre Anual",
        description=f"Generó Póliza de Cierre del Ejercicio {year} (Diario #{db_entry.entry_number}) por ${close_data['result_amount']:,.2f} MXN ({close_data['target_account_name']})",
        client_id=client_id,
        entity_id=db_entry.id,
        details={
            "year": year,
            "entry_number": db_entry.entry_number,
            "result_type": close_data["result_type"],
            "result_amount": close_data["result_amount"],
            "target_account": close_data["target_account_number"]
        }
    )

    return {
        "success": True,
        "message": (
            f"Póliza de Cierre del Ejercicio {year} (Diario #{db_entry.entry_number}) generada exitosamente. "
            f"Se registró en la cuenta {close_data['target_account_number']} ({close_data['target_account_name']}) "
            f"por ${close_data['result_amount']:,.2f} MXN. El ejercicio {year} ha quedado cerrado para cuentas de resultados."
        ),
        "entry_id": db_entry.id,
        "entry_number": db_entry.entry_number,
        "year": year,
        "result_type": close_data["result_type"],
        "result_amount": close_data["result_amount"],
        "target_account_number": close_data["target_account_number"],
        "target_account_name": close_data["target_account_name"],
    }


@router.post("/client/{client_id}/year-end-close/{year}/revert")
def revert_year_end_close_entry(
    client_id: int,
    year: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    existing = get_closing_entry_for_year(db, client_id, year)
    if not existing:
        raise HTTPException(
            status_code=404,
            detail=f"No existe una Póliza de Cierre activa para el ejercicio {year}."
        )

    entry_num = existing.entry_number
    # Identificar cuentas 304-01-xxx o 304-02-xxx usadas en esta póliza de cierre
    closing_result_acc_ids = []
    for l in existing.lines:
        acc = db.query(Account).filter(Account.id == l.account_id).first()
        if acc and (acc.account_number.startswith("304-01-") or acc.account_number.startswith("304-02-")):
            closing_result_acc_ids.append(acc.id)

    db.query(JournalLine).filter(JournalLine.entry_id == existing.id).delete()
    db.delete(existing)
    db.commit()

    log_activity(
        db=db,
        user=current_user,
        action="REVERTIR_CIERRE",
        module="Cierre Anual",
        description=f"Revirtió y canceló la Póliza de Cierre del Ejercicio {year} (Diario #{entry_num})",
        client_id=client_id,
        entity_id=entry_num,
        details={"year": year, "reverted_entry_number": entry_num}
    )

    return {
        "success": True,
        "message": f"La Póliza de Cierre del Ejercicio {year} (Diario #{entry_num}) fue revertida exitosamente. Las cuentas de resultados del ejercicio {year} nuevamente permiten modificaciones.",
        "year": year,
        "reverted_entry_number": entry_num,
    }

def _ensure_nomina_account(db: Session, client_id: int, acc_number: str, acc_name: str, sat_code: str, parent_num: str, parent_name: str, parent_sat: str) -> Account:
    acc = db.query(Account).filter(
        Account.client_id == client_id,
        Account.account_number == acc_number
    ).first()
    if not acc:
        parent_acc = db.query(Account).filter(
            Account.client_id == client_id,
            Account.account_number == parent_num
        ).first()
        if not parent_acc:
            parent_acc = Account(
                client_id=client_id,
                account_number=parent_num,
                name=parent_name,
                type="Pasivo",
                nature="Acreedora",
                level=1,
                sat_group_code=parent_sat,
                classification="Acumulación",
                is_active=True
            )
            db.add(parent_acc)
            db.flush()
        acc = Account(
            client_id=client_id,
            account_number=acc_number,
            name=acc_name,
            type="Pasivo",
            nature="Acreedora",
            level=2,
            sat_group_code=sat_code,
            parent_id=parent_acc.id,
            classification="Afectable",
            is_active=True
        )
        db.add(acc)
        db.flush()
    else:
        changed = False
        if not acc.is_active:
            acc.is_active = True
            changed = True
        if acc.classification != "Afectable":
            acc.classification = "Afectable"
            changed = True
        if changed:
            db.flush()
    return acc


def _heal_nomina_entry_lines(db: Session, entry: JournalEntry, acc_map: dict = None) -> bool:
    """Corrige asientos de nómina donde ISR retenido se registró en 210-01-000 o Provisión de sueldos en 201-01-000."""
    healed = False
    for line in entry.lines:
        desc = (line.description or "").strip()
        curr_acc = acc_map.get(line.account_id) if acc_map else db.query(Account).filter(Account.id == line.account_id).first()
        curr_num = curr_acc.account_number if curr_acc else ""

        if desc.startswith("ISR retenido por salarios") and curr_num != "216-01-000":
            target = _ensure_nomina_account(
                db, entry.client_id,
                "216-01-000", "Impuestos retenidos de ISR por sueldos y salarios", "216.01",
                "216-00-000", "Impuestos y derechos por pagar", "216"
            )
            line.account_id = target.id
            if acc_map is not None:
                acc_map[target.id] = target
            healed = True

        elif (desc.startswith("Provisión de sueldos y salarios por pagar") or desc.startswith("Neto de nómina por pagar")) and curr_num != "210-01-000":
            target = _ensure_nomina_account(
                db, entry.client_id,
                "210-01-000", "Provisión de sueldos y salarios por pagar", "210.01",
                "210-00-000", "Provisión de sueldos y salarios por pagar", "210"
            )
            line.account_id = target.id
            if acc_map is not None:
                acc_map[target.id] = target
            healed = True

    return healed


@router.get("/client/{client_id}", response_model=List[JournalEntryListResponse])
def list_journal_entries(
    client_id: int,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    entry_type: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 500,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant", "client"))
):
    if current_user.role == "client" and current_user.client_id != client_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    query = db.query(JournalEntry).filter(
        JournalEntry.client_id == client_id,
        JournalEntry.is_cancelled == False
    )
    if date_from:
        query = query.filter(JournalEntry.date >= date_from)
    if date_to:
        query = query.filter(JournalEntry.date <= date_to)
    if entry_type:
        query = query.filter(JournalEntry.entry_type == entry_type)
    if search:
        search_term = f"%{search}%"
        query = query.filter(
            (JournalEntry.description.ilike(search_term)) |
            (JournalEntry.reference.ilike(search_term)) |
            (JournalEntry.cfdi_uuid.ilike(search_term))
        )
        
    type_priority = case(
        (JournalEntry.entry_type == 'ingreso', 1),
        (JournalEntry.entry_type == 'egreso', 2),
        (JournalEntry.entry_type == 'diario', 3),
        else_=4
    )

    entries = query.order_by(
        JournalEntry.date.asc(),
        JournalEntry.entry_number.asc(),
        JournalEntry.id.asc()
    ).offset(skip).limit(limit).all()

    acc_map = {a.id: a for a in db.query(Account).filter(Account.client_id == client_id).all()}

    any_healed = False
    for entry in entries:
        if _heal_nomina_entry_lines(db, entry, acc_map):
            any_healed = True
    if any_healed:
        db.commit()

    # Enrich with totals and line details
    results = []
    for entry in entries:
        total_debit = sum(line.debit for line in entry.lines)
        total_credit = sum(line.credit for line in entry.lines)
        has_res = False
        lines_list = []
        for idx, line in enumerate(entry.lines):
            acc = acc_map.get(line.account_id)
            acc_num = acc.account_number if acc else ""
            acc_name = acc.name if acc else ""
            if is_resultado_account(acc_num):
                has_res = True
            lines_list.append({
                "id": line.id,
                "entry_id": line.entry_id,
                "account_id": line.account_id,
                "account_name": acc_name,
                "account_number": acc_num,
                "debit": line.debit,
                "credit": line.credit,
                "description": line.description,
                "line_order": line.line_order if line.line_order is not None else idx + 1,
            })

        entry_dict = {
            "id": entry.id,
            "client_id": entry.client_id,
            "entry_number": entry.entry_number,
            "entry_type": entry.entry_type,
            "date": entry.date,
            "description": entry.description,
            "reference": entry.reference,
            "cfdi_uuid": entry.cfdi_uuid,
            "is_auto": bool(entry.is_auto),
            "is_cancelled": bool(entry.is_cancelled),
            "total_debit": total_debit,
            "total_credit": total_credit,
            "has_resultado_accounts": has_res,
            "lines": lines_list,
            "created_at": entry.created_at
        }
        results.append(entry_dict)
        
    return results

@router.get("/{entry_id}", response_model=JournalEntryResponse)
def get_journal_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    entry = db.query(JournalEntry).filter(JournalEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
        
    if current_user.role == "client" and current_user.client_id != entry.client_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    if _heal_nomina_entry_lines(db, entry):
        db.commit()
        
    # Inject account details into lines
    lines = []
    for line in entry.lines:
        account = db.query(Account).filter(Account.id == line.account_id).first()
        line_dict = {
            "id": line.id,
            "entry_id": line.entry_id,
            "account_id": line.account_id,
            "account_name": account.name if account else "",
            "account_number": account.account_number if account else "",
            "debit": line.debit,
            "credit": line.credit,
            "description": line.description,
            "line_order": line.line_order
        }
        lines.append(line_dict)
        
    return {
        **entry.__dict__,
        "lines": lines
    }

@router.get("/client/{client_id}/next-number")
def get_next_entry_number(
    client_id: int,
    entry_type: str = Query('diario'),
    year: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    if not year:
        year = date.today().year
    max_num = db.query(func.max(JournalEntry.entry_number)).filter(
        JournalEntry.client_id == client_id,
        JournalEntry.entry_type == entry_type,
        func.strftime('%Y', JournalEntry.date) == str(year)
    ).scalar()
    return {"next_number": (max_num or 0) + 1}

@router.get("/client/{client_id}/next-numbers")
def get_all_next_numbers(
    client_id: int,
    year: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    if not year:
        year = date.today().year
    result = {}
    for t in ["ingreso", "egreso", "diario"]:
        max_num = db.query(func.max(JournalEntry.entry_number)).filter(
            JournalEntry.client_id == client_id,
            JournalEntry.entry_type == t,
            func.strftime('%Y', JournalEntry.date) == str(year)
        ).scalar()
        result[t] = (max_num or 0) + 1
    return result

@router.post("", response_model=JournalEntryResponse)
@router.post("/", response_model=JournalEntryResponse)
def create_journal_entry(
    entry_data: JournalEntryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    # Validation
    total_debit = sum(line.debit for line in entry_data.lines)
    total_credit = sum(line.credit for line in entry_data.lines)
    # Allow minor floating point difference
    if abs(total_debit - total_credit) > 0.01:
        raise HTTPException(status_code=400, detail=f"Debits ({total_debit}) and credits ({total_credit}) must equal")

    year = entry_data.date.year
    closing_entry = get_closing_entry_for_year(db, entry_data.client_id, year)
        
    for idx, line in enumerate(entry_data.lines):
        deb = float(line.debit or 0)
        cred = float(line.credit or 0)
        if deb > 0 and cred > 0:
            raise HTTPException(
                status_code=400,
                detail=f"El movimiento #{idx + 1} no puede tener Cargo (${deb:.2f}) y Abono (${cred:.2f}) simultáneamente. Debe registrarse solo un Cargo o solo un Abono por movimiento."
            )
        if deb <= 0 and cred <= 0:
            raise HTTPException(
                status_code=400,
                detail=f"El movimiento #{idx + 1} debe contener un importe mayor a cero en Cargo o en Abono."
            )

        acc = db.query(Account).filter(Account.id == line.account_id, Account.client_id == entry_data.client_id).first()
        if not acc:
            raise HTTPException(status_code=400, detail=f"Account {line.account_id} not valid for this client")

        if closing_entry and is_resultado_account(acc.account_number):
            raise HTTPException(
                status_code=400,
                detail=f"El ejercicio {year} ya cuenta con Póliza de Cierre (#{closing_entry.entry_number}). No se permite hacer modificaciones ni agregar movimientos a las cuentas de resultados ({acc.account_number} - {acc.name}) del ejercicio {year} cerrado. Si requiere realizar ajustes, primero revierta la Póliza de Cierre."
            )

    # Entry number: automatic consecutive according to entry_type and year
    if entry_data.entry_number and entry_data.entry_number > 0:
        # Check if already in use to prevent duplicate folios
        existing = db.query(JournalEntry).filter(
            JournalEntry.client_id == entry_data.client_id,
            JournalEntry.entry_type == entry_data.entry_type,
            JournalEntry.entry_number == entry_data.entry_number,
            func.strftime('%Y', JournalEntry.date) == str(year)
        ).first()
        if existing:
            max_num = db.query(func.max(JournalEntry.entry_number)).filter(
                JournalEntry.client_id == entry_data.client_id,
                JournalEntry.entry_type == entry_data.entry_type,
                func.strftime('%Y', JournalEntry.date) == str(year)
            ).scalar()
            new_num = (max_num or 0) + 1
        else:
            new_num = entry_data.entry_number
    else:
        max_num = db.query(func.max(JournalEntry.entry_number)).filter(
            JournalEntry.client_id == entry_data.client_id,
            JournalEntry.entry_type == entry_data.entry_type,
            func.strftime('%Y', JournalEntry.date) == str(year)
        ).scalar()
        new_num = (max_num or 0) + 1
    
    desc = entry_data.description or entry_data.concept or ""
    db_entry = JournalEntry(
        client_id=entry_data.client_id,
        entry_number=new_num,
        entry_type=entry_data.entry_type,
        date=entry_data.date,
        description=desc,
        reference=entry_data.reference,
        cfdi_uuid=entry_data.cfdi_uuid,
        cfdi_issuer_rfc=entry_data.cfdi_issuer_rfc,
        cfdi_receiver_rfc=entry_data.cfdi_receiver_rfc,
        cfdi_total=entry_data.cfdi_total,
        is_auto=False,
        is_cancelled=False,
        created_by=current_user.id
    )
    db.add(db_entry)
    db.flush()
    
    for i, line in enumerate(entry_data.lines):
        db_line = JournalLine(
            entry_id=db_entry.id,
            account_id=line.account_id,
            debit=line.debit,
            credit=line.credit,
            description=line.description or line.concept or desc,
            line_order=line.line_order if line.line_order is not None else i
        )
        db.add(db_line)
        
    db.commit()
    db.refresh(db_entry)

    log_activity(
        db=db,
        user=current_user,
        action="CREAR_POLIZA",
        module="Pólizas",
        description=f"Creó Póliza de {db_entry.entry_type.capitalize()} #{db_entry.entry_number} por ${total_debit:,.2f} MXN: {desc[:100]}",
        client_id=db_entry.client_id,
        entity_id=db_entry.id,
        details={
            "entry_type": db_entry.entry_type,
            "entry_number": db_entry.entry_number,
            "total_debit": float(total_debit),
            "lines_count": len(entry_data.lines),
            "date": str(entry_data.date),
            "cfdi_uuid": entry_data.cfdi_uuid
        }
    )

    return get_journal_entry(db_entry.id, db, current_user)

@router.put("/{entry_id}")
def update_journal_entry(
    entry_id: int,
    entry_data: JournalEntryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    entry = db.query(JournalEntry).filter(JournalEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    if (entry.reference or "").strip().startswith("CIERRE-"):
        raise HTTPException(
            status_code=400,
            detail="La Póliza de Cierre de Ejercicio no puede editarse manualmente. Utilice el botón 'Revertir Póliza de Cierre' si desea deshacer el cierre del ejercicio."
        )

    # Validar si el año original de la póliza está cerrado y la póliza original afectaba cuentas de resultados
    old_year = entry.date.year if entry.date else entry_data.date.year
    old_closing = get_closing_entry_for_year(db, entry.client_id, old_year)
    if old_closing:
        for old_line in entry.lines:
            old_acc = db.query(Account).filter(Account.id == old_line.account_id).first()
            if old_acc and is_resultado_account(old_acc.account_number):
                raise HTTPException(
                    status_code=400,
                    detail=f"El ejercicio {old_year} ya cuenta con Póliza de Cierre (#{old_closing.entry_number}). No se permiten modificaciones a las cuentas de resultados ({old_acc.account_number} - {old_acc.name}) de ese ejercicio cerrado. Primero revierta la Póliza de Cierre."
                )

    new_year = entry_data.date.year
    new_closing = get_closing_entry_for_year(db, entry.client_id, new_year)
        
    # Same validations and update logic
    total_debit = sum(line.debit for line in entry_data.lines)
    total_credit = sum(line.credit for line in entry_data.lines)
    if abs(total_debit - total_credit) > 0.01:
        raise HTTPException(status_code=400, detail="Debits and credits must equal")

    for idx, line in enumerate(entry_data.lines):
        deb = float(line.debit or 0)
        cred = float(line.credit or 0)
        if deb > 0 and cred > 0:
            raise HTTPException(
                status_code=400,
                detail=f"El movimiento #{idx + 1} no puede tener Cargo (${deb:.2f}) y Abono (${cred:.2f}) simultáneamente. Debe registrarse solo un Cargo o solo un Abono por movimiento."
            )
        if deb <= 0 and cred <= 0:
            raise HTTPException(
                status_code=400,
                detail=f"El movimiento #{idx + 1} debe contener un importe mayor a cero en Cargo o en Abono."
            )

        acc = db.query(Account).filter(Account.id == line.account_id, Account.client_id == entry.client_id).first()
        if new_closing and acc and is_resultado_account(acc.account_number):
            raise HTTPException(
                status_code=400,
                detail=f"El ejercicio {new_year} ya cuenta con Póliza de Cierre (#{new_closing.entry_number}). No se permiten modificaciones a las cuentas de resultados ({acc.account_number} - {acc.name}) de ese ejercicio cerrado. Primero revierta la Póliza de Cierre."
            )

    if entry_data.entry_number and entry_data.entry_number > 0:
        entry.entry_number = entry_data.entry_number
    entry.date = entry_data.date
    entry.description = entry_data.description or entry_data.concept or ""
    entry.reference = entry_data.reference
    entry.cfdi_uuid = entry_data.cfdi_uuid
    
    # Delete old lines
    db.query(JournalLine).filter(JournalLine.entry_id == entry_id).delete()
    
    # Create new lines
    for i, line in enumerate(entry_data.lines):
        db_line = JournalLine(
            entry_id=entry.id,
            account_id=line.account_id,
            debit=line.debit,
            credit=line.credit,
            description=line.description or line.concept or entry.description,
            line_order=i
        )
        db.add(db_line)
        
    db.commit()

    log_activity(
        db=db,
        user=current_user,
        action="EDITAR_POLIZA",
        module="Pólizas",
        description=f"Editó Póliza de {entry.entry_type.capitalize()} #{entry.entry_number} ({entry.description[:80]})",
        client_id=entry.client_id,
        entity_id=entry.id,
        details={"entry_type": entry.entry_type, "entry_number": entry.entry_number, "lines_count": len(entry_data.lines)}
    )

    return get_journal_entry(entry.id, db, current_user)

@router.delete("/{entry_id}")
@router.post("/{entry_id}/cancel")
def cancel_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    entry = db.query(JournalEntry).filter(JournalEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    ref = (entry.reference or "").strip()
    if ref.startswith("CIERRE-"):
        # Si se elimina la propia Póliza de Cierre, revertir el cierre del ejercicio
        entry_num = entry.entry_number
        c_id = entry.client_id
        db.query(JournalLine).filter(JournalLine.entry_id == entry.id).delete()
        db.delete(entry)
        db.commit()
        log_activity(
            db=db,
            user=current_user,
            action="REVERTIR_CIERRE",
            module="Cierre Anual",
            description=f"Eliminó Póliza de Cierre #{entry_num} (Reversión de cierre de ejercicio)",
            client_id=c_id,
            entity_id=entry_num
        )
        return {"message": "Póliza de cierre revertida exitosamente"}

    if entry.date:
        closing = get_closing_entry_for_year(db, entry.client_id, entry.date.year)
        if closing:
            for l in entry.lines:
                acc = db.query(Account).filter(Account.id == l.account_id).first()
                if acc and is_resultado_account(acc.account_number):
                    raise HTTPException(
                        status_code=400,
                        detail=f"El ejercicio {entry.date.year} ya cuenta con Póliza de Cierre (#{closing.entry_number}). No se puede eliminar ni cancelar una póliza que afecta cuentas de resultados ({acc.account_number}) en un ejercicio cerrado. Primero revierta la Póliza de Cierre."
                    )

    entry_num = entry.entry_number
    entry_t = entry.entry_type
    c_id = entry.client_id
    desc_val = entry.description or ""
    entry.is_cancelled = True

    # Desvincular cualquier CFDI asociado a esta póliza para permitir volver a contabilizarlo o subirlo
    from models.cfdi import CFDIInvoice
    linked_cfdis = db.query(CFDIInvoice).filter(
        CFDIInvoice.client_id == c_id,
        (CFDIInvoice.journal_entry_id == entry.id) | (
            (CFDIInvoice.uuid == entry.cfdi_uuid) if entry.cfdi_uuid else False
        )
    ).all()
    for inv in linked_cfdis:
        inv.is_posted = False
        inv.journal_entry_id = None

    db.commit()

    log_activity(
        db=db,
        user=current_user,
        action="ELIMINAR_POLIZA",
        module="Pólizas",
        description=f"Canceló Póliza de {entry_t.capitalize()} #{entry_num} ({desc_val[:80]})",
        client_id=c_id,
        entity_id=entry_id
    )

    return {"message": "Entry cancelled"}

async def _process_cfdi_upload(client_id: int, file: UploadFile, db: Session, current_user: User):
    if not CFDI_SERVICE_AVAILABLE:
        raise HTTPException(status_code=501, detail="CFDI Service not available yet")
        
    contents = await file.read()
    try:
        cfdi_data = parse_cfdi_xml(contents)
        result = generate_journal_entry_from_cfdi(cfdi_data, client_id, db)
        
        # Save entry logic...
        entry = JournalEntry(
            client_id=client_id,
            entry_type=result['entry_type'],
            date=result['date'],
            description=result['description'],
            cfdi_uuid=result['cfdi_uuid'],
            cfdi_issuer_rfc=result['cfdi_issuer_rfc'],
            cfdi_issuer_name=result['cfdi_issuer_name'],
            cfdi_receiver_rfc=result['cfdi_receiver_rfc'],
            cfdi_total=result['cfdi_total'],
            is_auto=True,
            created_by=current_user.id
        )
        
        year = result['date'].year
        max_num = db.query(func.max(JournalEntry.entry_number)).filter(
            JournalEntry.client_id == client_id,
            JournalEntry.entry_type == result['entry_type'],
            func.strftime('%Y', JournalEntry.date) == str(year)
        ).scalar()
        entry.entry_number = (max_num or 0) + 1
        
        db.add(entry)
        db.flush()
        
        for idx, line_data in enumerate(result['lines']):
            line = JournalLine(
                entry_id=entry.id,
                line_order=idx + 1,
                **line_data
            )
            db.add(line)
            
        db.commit()
        return {
            "message": "CFDI processed successfully",
            "warnings": result.get("warnings", []),
            "entry_id": entry.id,
            "uuid": result.get("cfdi_uuid"),
            "type": result.get("entry_type"),
            "total": float(result.get("cfdi_total") or 0)
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/upload-cfdi")
async def upload_cfdi(
    client_id: int = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    return await _process_cfdi_upload(client_id, file, db, current_user)

@router.post("/client/{client_id}/cfdi-upload")
async def upload_cfdi_for_client(
    client_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    return await _process_cfdi_upload(client_id, file, db, current_user)
