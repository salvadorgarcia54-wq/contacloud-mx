from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from sqlalchemy.orm import Session
from sqlalchemy import or_, extract
from typing import List, Optional, Tuple
from datetime import datetime, date, timedelta
import unicodedata
import csv
import io
import re
import openpyxl

from database import get_db
from models.bank import BankAccount, BankStatement, BankTransaction
from models.account import Account
from models.user import User
from models.journal import JournalLine, JournalEntry
from schemas.bank import (
    BankAccountCreate,
    BankAccountResponse,
    BankTransactionResponse,
    BankStatementResponse,
    ReconciliationResult,
)
from routers.auth import require_role

try:
    from services.reconciliation import auto_reconcile, get_reconciliation_report, manual_reconcile
    RECON_AVAILABLE = True
except ImportError:
    RECON_AVAILABLE = False

router = APIRouter(prefix="/api/bank", tags=["bank"])

SPANISH_MONTHS = {
    "ene": 1, "enero": 1, "jan": 1,
    "feb": 2, "febrero": 2,
    "mar": 3, "marzo": 3,
    "abr": 4, "abril": 4, "apr": 4,
    "may": 5, "mayo": 5,
    "jun": 6, "junio": 6,
    "jul": 7, "julio": 7,
    "ago": 8, "agosto": 8, "aug": 8,
    "sep": 9, "sept": 9, "septiembre": 9, "set": 9,
    "oct": 10, "octubre": 10,
    "nov": 11, "noviembre": 11,
    "dic": 12, "diciembre": 12, "dec": 12,
}


def _strip_accents(text: str) -> str:
    if not text:
        return ""
    return "".join(
        c for c in unicodedata.normalize("NFD", str(text)) if unicodedata.category(c) != "Mn"
    )


def _parse_flexible_date(val) -> Optional[date]:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val

    # Excel serial number (e.g. 46113 -> 2026-04-01)
    if isinstance(val, (int, float)):
        if 35000 <= val <= 60000:
            return (datetime(1899, 12, 30) + timedelta(days=int(round(val)))).date()
        return None

    s = str(val).strip()
    if not s:
        return None

    # Check if string is an Excel serial date number
    if re.match(r"^\d{5}(?:\.\d+)?$", s):
        num = float(s)
        if 35000 <= num <= 60000:
            return (datetime(1899, 12, 30) + timedelta(days=int(round(num)))).date()

    # Remove time part if present (e.g. "2026-04-15 10:20:30" or "15/04/2026 10:20")
    s_date = s.split("T")[0].split(" ")[0].strip()

    # Standard formats
    for fmt in (
        "%Y-%m-%d",
        "%d/%m/%Y",
        "%d-%m-%Y",
        "%Y/%m/%d",
        "%d/%m/%y",
        "%d-%m-%y",
        "%d.%m.%Y",
        "%m/%d/%Y",
    ):
        try:
            return datetime.strptime(s_date, fmt).date()
        except ValueError:
            pass

    # Spanish text month formats like "15/Abr/2026", "15-abr-26", "15 de abril de 2026", "05 Abr 2026"
    s_clean = _strip_accents(s.lower().strip())
    m = re.match(r"^(\d{1,2})[/\-\.\s]+([a-z]+)[/\-\.\s]+(\d{2,4})", s_clean)
    if not m:
        m = re.match(r"^(\d{1,2})\s+de\s+([a-z]+)\s+(?:de\s+|del?\s+)?(\d{2,4})", s_clean)
    if m:
        day_i = int(m.group(1))
        mon_s = m.group(2).strip(".")
        yr_i = int(m.group(3))
        if yr_i < 100:
            yr_i += 2000
        mon_i = SPANISH_MONTHS.get(mon_s) or SPANISH_MONTHS.get(mon_s[:3])
        if mon_i and 1 <= day_i <= 31:
            try:
                return date(yr_i, mon_i, day_i)
            except ValueError:
                pass

    return None


def _parse_money(val) -> Optional[float]:
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).strip()
    if not s or s in ("-", "--", "N/A", "n/a", "null", "None"):
        return 0.0

    is_negative = False
    if s.startswith("(") and s.endswith(")"):
        is_negative = True
        s = s[1:-1]
    elif s.endswith("-"):
        is_negative = True
        s = s[:-1]
    elif s.startswith("-"):
        is_negative = True
        s = s[1:]

    # Strip currency symbols and spaces
    s = re.sub(r"[^\d.,]", "", s)
    if not s:
        return None

    # Handle European vs Mexican/US decimal separators
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        parts = s.split(",")
        if len(parts[-1]) == 2 and len(parts) == 2:
            s = s.replace(",", ".")
        else:
            s = s.replace(",", "")

    try:
        num = float(s)
        return -num if is_negative else num
    except ValueError:
        return None


def _extract_rows_from_upload(filename: str, content: bytes) -> List[List[str]]:
    fname_lower = (filename or "").lower()
    is_xlsx = fname_lower.endswith(".xlsx") or content[:4] == b"PK\x03\x04"

    if is_xlsx:
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
        rows = []
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            sheet_rows = []
            for row in ws.iter_rows(values_only=True):
                if any(cell is not None and str(cell).strip() != "" for cell in row):
                    formatted_row = []
                    for cell in row:
                        if cell is None:
                            formatted_row.append("")
                        elif isinstance(cell, datetime):
                            formatted_row.append(cell.strftime("%Y-%m-%d"))
                        elif isinstance(cell, date):
                            formatted_row.append(cell.strftime("%Y-%m-%d"))
                        else:
                            formatted_row.append(str(cell).strip())
                    sheet_rows.append(formatted_row)
            if len(sheet_rows) > len(rows):
                rows = sheet_rows
        return rows

    # Decode text/CSV
    text = None
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            text = content.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        text = content.decode("latin-1", errors="ignore")

    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        return []

    delimiter = ","
    best_count = 0
    for cand in (",", ";", "\t", "|"):
        cnt = sum(line.count(cand) for line in lines[:15])
        if cnt > best_count:
            best_count = cnt
            delimiter = cand

    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    return [[cell.strip() for cell in row] for row in reader if any(c.strip() for c in row)]


def _parse_bank_rows(rows: List[List[str]]) -> Tuple[List[dict], float, float]:
    """
    Analiza filas de un estado de cuenta bancario (.csv o .xlsx) y devuelve:
    (lista_movimientos, saldo_inicial, saldo_final)
    """
    if not rows:
        return [], 0.0, 0.0

    initial_balance = 0.0
    final_balance = 0.0

    # Buscar metadatos de saldo inicial / final en las primeras filas
    for r in rows[:30]:
        joined = _strip_accents(" ".join(r).lower())
        if "saldo inicial" in joined or "saldo anterior" in joined:
            for cell in r:
                val = _parse_money(cell)
                if val is not None and val != 0:
                    initial_balance = val
                    break
        if "saldo final" in joined or "saldo actual" in joined or "saldo al corte" in joined:
            for cell in r:
                val = _parse_money(cell)
                if val is not None and val != 0:
                    final_balance = val
                    break

    # Localizar la fila de encabezados en las primeras 50 filas
    header_idx = None
    header_map = {}

    for idx, r in enumerate(rows[:50]):
        r_low = [_strip_accents(re.sub(r"\s+", " ", c.lower().strip())) for c in r]
        has_date = any(
            any(k in c for k in ("fecha", "date", "f. oper", "f.oper", "dia"))
            for c in r_low
        )
        has_amount = any(
            any(
                k in c
                for k in (
                    "cargo",
                    "retiro",
                    "abono",
                    "deposito",
                    "importe",
                    "monto",
                    "cantidad",
                    "valor",
                    "debit",
                    "credit",
                    "amount",
                    "salida",
                    "entrada",
                    "egreso",
                    "ingreso",
                )
            )
            for c in r_low
        )
        if has_date and has_amount:
            header_idx = idx
            for col_i, col_name in enumerate(r_low):
                if not col_name:
                    continue
                if any(k in col_name for k in ("fecha", "date", "f. oper", "f.oper")) or col_name == "dia":
                    if "fecha" not in header_map:
                        header_map["fecha"] = col_i
                elif any(k in col_name for k in ("descrip", "concepto", "detalle", "movimiento", "leyenda", "narrativa", "observa")):
                    if "desc" not in header_map:
                        header_map["desc"] = col_i
                elif any(k in col_name for k in ("referencia", "ref", "folio", "documento", "cheque", "autorizacion", "rastreo")):
                    if "ref" not in header_map:
                        header_map["ref"] = col_i
                elif any(k in col_name for k in ("cargo", "retiro", "debit", "salida", "egreso", "disposicion")):
                    if "cargo" not in header_map:
                        header_map["cargo"] = col_i
                elif any(k in col_name for k in ("abono", "deposit", "credit", "entrada", "ingreso")):
                    if "abono" not in header_map:
                        header_map["abono"] = col_i
                elif any(k in col_name for k in ("importe", "monto", "cantidad", "valor", "amount")):
                    if "importe" not in header_map:
                        header_map["importe"] = col_i
                elif any(k in col_name for k in ("tipo", "naturaleza", "operacion", "cod", "c/a")):
                    if "tipo" not in header_map:
                        header_map["tipo"] = col_i
                elif "saldo" in col_name or "balance" in col_name:
                    if "saldo" not in header_map:
                        header_map["saldo"] = col_i
            break

    start_row = (header_idx + 1) if header_idx is not None else 0

    # Si no se detectó fila de encabezado clara, inferir columnas buscando la primera fila con fecha
    if header_idx is None:
        for idx, r in enumerate(rows):
            date_col = None
            for col_i, cell in enumerate(r[:5]):
                if _parse_flexible_date(cell) is not None:
                    date_col = col_i
                    break
            if date_col is not None and len(r) >= date_col + 2:
                start_row = idx
                header_map["fecha"] = date_col
                header_map["desc"] = date_col + 1
                rem = len(r) - (date_col + 2)
                if rem >= 3:
                    header_map["ref"] = date_col + 2
                    header_map["cargo"] = date_col + 3
                    header_map["abono"] = date_col + 4
                elif rem == 2:
                    header_map["cargo"] = date_col + 2
                    header_map["abono"] = date_col + 3
                elif rem == 1:
                    header_map["importe"] = date_col + 2
                break

    idx_fecha = header_map.get("fecha", 0)
    idx_desc = header_map.get("desc", idx_fecha + 1)
    idx_ref = header_map.get("ref")
    idx_cargo = header_map.get("cargo")
    idx_abono = header_map.get("abono")
    idx_importe = header_map.get("importe")
    idx_tipo = header_map.get("tipo")
    idx_saldo = header_map.get("saldo")

    parsed_txs = []
    last_running_balance = None

    for r in rows[start_row:]:
        if not r or len(r) <= idx_fecha:
            continue

        dt = _parse_flexible_date(r[idx_fecha])
        if dt is None:
            continue

        desc = r[idx_desc].strip() if idx_desc is not None and idx_desc < len(r) else ""
        ref = r[idx_ref].strip() if idx_ref is not None and idx_ref < len(r) else ""

        cargo_val = 0.0
        abono_val = 0.0

        if idx_cargo is not None or idx_abono is not None:
            if idx_cargo is not None and idx_cargo < len(r):
                c_parsed = _parse_money(r[idx_cargo])
                if c_parsed is not None:
                    cargo_val = abs(c_parsed)
            if idx_abono is not None and idx_abono < len(r):
                a_parsed = _parse_money(r[idx_abono])
                if a_parsed is not None:
                    abono_val = abs(a_parsed)

        if cargo_val == 0.0 and abono_val == 0.0 and idx_importe is not None and idx_importe < len(r):
            imp = _parse_money(r[idx_importe])
            if imp is not None and imp != 0.0:
                tipo_str = _strip_accents(r[idx_tipo].lower().strip()) if idx_tipo is not None and idx_tipo < len(r) else ""
                if any(k in tipo_str for k in ("cargo", "retiro", "salida", "egreso", "debito", "-")):
                    cargo_val = abs(imp)
                elif any(k in tipo_str for k in ("abono", "deposito", "entrada", "ingreso", "credito", "+")):
                    abono_val = abs(imp)
                else:
                    if imp < 0:
                        cargo_val = abs(imp)
                    else:
                        abono_val = abs(imp)

        # Fallback: buscar cualquier columna numérica después de la descripción si no se mapeó cargo/abono
        if cargo_val == 0.0 and abono_val == 0.0 and idx_cargo is None and idx_abono is None and idx_importe is None:
            for col_i in range(max(idx_desc + 1, idx_fecha + 1), len(r)):
                if col_i == idx_saldo or col_i == idx_ref:
                    continue
                imp = _parse_money(r[col_i])
                if imp is not None and imp != 0.0:
                    if imp < 0:
                        cargo_val = abs(imp)
                    else:
                        abono_val = abs(imp)
                    break

        if cargo_val == 0.0 and abono_val == 0.0:
            continue

        if idx_saldo is not None and idx_saldo < len(r):
            s_val = _parse_money(r[idx_saldo])
            if s_val is not None and s_val != 0.0:
                last_running_balance = s_val

        signed_amount = abono_val if abono_val > 0 else -cargo_val
        tx_type = "deposit" if signed_amount > 0 else "withdrawal"

        parsed_txs.append(
            {
                "date": dt,
                "description": desc or ("Depósito bancario" if signed_amount > 0 else "Cargo bancario"),
                "reference": ref,
                "amount": abs(signed_amount),
                "signed_amount": signed_amount,
                "cargo": cargo_val,
                "abono": abono_val,
                "transaction_type": tx_type,
            }
        )

    if final_balance == 0.0 and last_running_balance is not None:
        final_balance = last_running_balance
    elif final_balance == 0.0 and parsed_txs:
        net_change = sum(t["signed_amount"] for t in parsed_txs)
        final_balance = round(initial_balance + net_change, 2)

    return parsed_txs, initial_balance, final_balance


def _resolve_or_create_bank_account(
    db: Session,
    account_or_bank_id: int,
    client_id: Optional[int] = None,
) -> BankAccount:
    acct_query = db.query(Account).filter(Account.id == account_or_bank_id)
    if client_id:
        acct_query = acct_query.filter(Account.client_id == client_id)
    acct = acct_query.first()

    if acct:
        bank_acct = (
            db.query(BankAccount)
            .filter(
                BankAccount.client_id == acct.client_id,
                BankAccount.linked_account_id == acct.id,
            )
            .first()
        )
        if not bank_acct:
            bank_acct = BankAccount(
                client_id=acct.client_id,
                bank_name=acct.name,
                account_number=acct.account_number,
                currency="USD" if acct.account_number.startswith("102-02-") else "MXN",
                linked_account_id=acct.id,
                is_active=True,
            )
            db.add(bank_acct)
            db.flush()
        return bank_acct

    bank_acct = db.query(BankAccount).filter(BankAccount.id == account_or_bank_id).first()
    if bank_acct:
        return bank_acct

    raise HTTPException(status_code=404, detail="Cuenta bancaria no encontrada")


def _build_statement_payload(db: Session, statement: BankStatement) -> dict:
    bank_account = db.query(BankAccount).filter(BankAccount.id == statement.bank_account_id).first()
    txs = (
        db.query(BankTransaction)
        .filter(BankTransaction.statement_id == statement.id)
        .order_by(BankTransaction.date.asc(), BankTransaction.id.asc())
        .all()
    )

    book_lines = []
    if bank_account and bank_account.linked_account_id:
        jl_query = (
            db.query(JournalLine)
            .join(JournalEntry, JournalLine.entry_id == JournalEntry.id)
            .filter(
                JournalLine.account_id == bank_account.linked_account_id,
                JournalEntry.is_cancelled == False,
            )
        )
        if statement.period_year and statement.period_month:
            jl_query = jl_query.filter(
                extract("year", JournalEntry.date) == statement.period_year,
                extract("month", JournalEntry.date) == statement.period_month,
            )
        book_lines = jl_query.order_by(JournalEntry.date.asc(), JournalEntry.id.asc()).all()

    matched_jl_ids = {t.matched_journal_line_id for t in txs if t.is_reconciled and t.matched_journal_line_id}

    bank_transactions_out = []
    for t in txs:
        amt = float(t.amount or 0)
        is_deposit = t.transaction_type == "deposit"
        signed = amt if is_deposit else -amt
        bank_transactions_out.append(
            {
                "id": t.id,
                "date": str(t.date),
                "description": t.description or "",
                "ref": t.reference or "",
                "reference": t.reference or "",
                "amount": signed,
                "cargo": 0.0 if is_deposit else amt,
                "abono": amt if is_deposit else 0.0,
                "type": "abono" if is_deposit else "cargo",
                "transaction_type": t.transaction_type,
                "reconciled": bool(t.is_reconciled),
                "matched_journal_line_id": t.matched_journal_line_id,
            }
        )

    book_entries_out = []
    books_net_period = 0.0
    in_transit_debits = 0.0
    in_transit_credits = 0.0

    for jl in book_lines:
        debit = float(jl.debit or 0)
        credit = float(jl.credit or 0)
        if debit == 0 and credit == 0:
            continue
        books_net_period += (debit - credit)
        is_rec = jl.id in matched_jl_ids
        if not is_rec:
            if debit > 0:
                in_transit_debits += debit
            if credit > 0:
                in_transit_credits += credit

        entry = jl.entry
        folio = f"{(entry.entry_type or 'P')[0].upper()}-{entry.entry_number}" if entry else f"#{jl.entry_id}"
        book_entries_out.append(
            {
                "id": jl.id,
                "entry_id": jl.entry_id,
                "date": str(entry.date) if entry else "",
                "journal": folio,
                "concept": jl.description or (entry.description if entry else ""),
                "debit": debit,
                "credit": credit,
                "amount": debit if debit > 0 else credit,
                "type": "debe" if debit > 0 else "haber",
                "reconciled": is_rec,
            }
        )

    unreconciled_bank_deposits = sum(
        float(t.amount or 0) for t in txs if not t.is_reconciled and t.transaction_type == "deposit"
    )
    unreconciled_bank_withdrawals = sum(
        float(t.amount or 0) for t in txs if not t.is_reconciled and t.transaction_type != "deposit"
    )

    bank_net = sum(
        (float(t.amount or 0) if t.transaction_type == "deposit" else -float(t.amount or 0))
        for t in txs
    )
    bank_balance = float(statement.final_balance or 0)
    if bank_balance == 0.0:
        bank_balance = round(float(statement.initial_balance or 0) + bank_net, 2)

    book_balance = round(books_net_period, 2)
    reconciled_balance = round(
        bank_balance + in_transit_debits - in_transit_credits - unreconciled_bank_deposits + unreconciled_bank_withdrawals,
        2,
    )
    diff = round(reconciled_balance - book_balance, 2)

    return {
        "statement_id": statement.id,
        "bank_account_id": statement.bank_account_id,
        "linked_account_id": bank_account.linked_account_id if bank_account else None,
        "period_year": statement.period_year,
        "period_month": statement.period_month,
        "file_name": statement.file_name,
        "transactions_count": len(bank_transactions_out),
        "bank_transactions": bank_transactions_out,
        "book_entries": book_entries_out,
        "summary": {
            "initialBalance": round(float(statement.initial_balance or 0), 2),
            "bankBalance": round(bank_balance, 2),
            "inTransitDebits": round(in_transit_debits, 2),
            "inTransitCredits": round(in_transit_credits, 2),
            "unreconciledBankDeposits": round(unreconciled_bank_deposits, 2),
            "unreconciledBankWithdrawals": round(unreconciled_bank_withdrawals, 2),
            "reconciledBalance": reconciled_balance,
            "bookBalance": book_balance,
            "diff": diff,
        },
    }


@router.get("/accounts/client/{client_id}")
def list_reconcilable_bank_accounts(
    client_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant", "client"))
):
    accounts = (
        db.query(Account)
        .filter(
            Account.client_id == client_id,
            Account.is_active == True,
            Account.classification == "Afectable",
            or_(
                Account.account_number.like("102-01-%"),
                Account.account_number.like("102-02-%"),
            ),
            ~Account.account_number.in_(["102-01-000", "102-02-000"]),
        )
        .order_by(Account.account_number.asc())
        .all()
    )
    return [
        {
            "id": a.id,
            "client_id": a.client_id,
            "account_number": a.account_number,
            "name": a.name,
            "classification": a.classification,
            "sat_group_code": a.sat_group_code,
            "is_active": a.is_active,
        }
        for a in accounts
    ]


@router.get("/accounts/{client_id}", response_model=List[BankAccountResponse])
def list_bank_accounts(
    client_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant", "client"))
):
    return db.query(BankAccount).filter(BankAccount.client_id == client_id, BankAccount.is_active == True).all()


@router.post("/accounts", response_model=BankAccountResponse)
def create_bank_account(
    account_data: BankAccountCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    account = BankAccount(**account_data.dict())
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


@router.put("/accounts/{bank_account_id}", response_model=BankAccountResponse)
def update_bank_account(
    bank_account_id: int,
    account_data: BankAccountCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    account = db.query(BankAccount).filter(BankAccount.id == bank_account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Bank account not found")

    update_dict = account_data.dict(exclude_unset=True)
    for k, v in update_dict.items():
        setattr(account, k, v)

    db.commit()
    db.refresh(account)
    return account


async def _process_statement_upload(
    db: Session,
    account_or_bank_id: int,
    file: UploadFile,
    year: Optional[int] = None,
    month: Optional[int] = None,
    client_id: Optional[int] = None,
) -> dict:
    bank_account = _resolve_or_create_bank_account(db, account_or_bank_id, client_id=client_id)
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="El archivo está vacío.")

    try:
        rows = _extract_rows_from_upload(file.filename or "estado_cuenta.csv", content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"No se pudo leer el archivo ({e}). Usa formato CSV o Excel (.xlsx).")

    parsed_txs, init_bal, final_bal = _parse_bank_rows(rows)
    if not parsed_txs:
        raise HTTPException(
            status_code=400,
            detail="No se detectaron movimientos bancarios válidos en el archivo. Verifica que incluya columnas de Fecha y Cargo/Abono o Importe.",
        )

    parsed_txs.sort(key=lambda x: x["date"])

    first_date = parsed_txs[0]["date"]
    period_year = year or first_date.year
    period_month = month or first_date.month

    statement = BankStatement(
        bank_account_id=bank_account.id,
        period_year=period_year,
        period_month=period_month,
        file_name=file.filename,
        initial_balance=init_bal,
        final_balance=final_bal,
    )
    db.add(statement)
    db.flush()

    transactions = []
    for item in parsed_txs:
        t = BankTransaction(
            statement_id=statement.id,
            date=item["date"],
            description=item["description"][:500],
            reference=(item["reference"] or "")[:100],
            amount=item["amount"],
            transaction_type=item["transaction_type"],
            is_reconciled=False,
        )
        transactions.append(t)

    db.add_all(transactions)
    db.commit()
    db.refresh(statement)

    return _build_statement_payload(db, statement)


@router.post("/statements/upload")
async def upload_statement(
    bank_account_id: int = Form(...),
    year: Optional[int] = Form(None),
    month: Optional[int] = Form(None),
    client_id: Optional[int] = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    return await _process_statement_upload(
        db=db,
        account_or_bank_id=bank_account_id,
        file=file,
        year=year,
        month=month,
        client_id=client_id,
    )


@router.post("/accounts/{account_id}/statements/{year}/{month}")
async def upload_statement_by_path(
    account_id: int,
    year: int,
    month: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    return await _process_statement_upload(
        db=db,
        account_or_bank_id=account_id,
        file=file,
        year=year,
        month=month,
    )


@router.get("/statements/{bank_account_id}", response_model=List[BankStatementResponse])
def list_statements(
    bank_account_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant", "client"))
):
    bank_account = _resolve_or_create_bank_account(db, bank_account_id)
    return (
        db.query(BankStatement)
        .filter(BankStatement.bank_account_id == bank_account.id)
        .order_by(BankStatement.uploaded_at.desc())
        .all()
    )


@router.get("/statements/{statement_id}/detail")
def get_statement_detail(
    statement_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant", "client"))
):
    statement = db.query(BankStatement).filter(BankStatement.id == statement_id).first()
    if not statement:
        raise HTTPException(status_code=404, detail="Estado de cuenta no encontrado")
    return _build_statement_payload(db, statement)


@router.get("/statements/{statement_id}/transactions", response_model=List[BankTransactionResponse])
def list_transactions(
    statement_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant", "client"))
):
    return (
        db.query(BankTransaction)
        .filter(BankTransaction.statement_id == statement_id)
        .order_by(BankTransaction.date.asc(), BankTransaction.id.asc())
        .all()
    )


@router.post("/reconcile/{statement_id}")
@router.post("/statements/{statement_id}/auto-reconcile")
def run_auto_reconcile(
    statement_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    statement = db.query(BankStatement).filter(BankStatement.id == statement_id).first()
    if not statement:
        raise HTTPException(status_code=404, detail="Estado de cuenta no encontrado")

    if RECON_AVAILABLE:
        auto_reconcile(db, statement_id)

    payload = _build_statement_payload(db, statement)
    reconciled_cnt = sum(1 for t in payload["bank_transactions"] if t["reconciled"])
    payload["reconciled_count"] = reconciled_cnt
    return payload


@router.post("/reconcile-manual")
@router.post("/reconcile/manual")
def run_manual_reconcile(
    bank_transaction_id: int = Form(...),
    journal_line_id: int = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    if not RECON_AVAILABLE:
        raise HTTPException(status_code=501, detail="Reconciliation service not available")
    success = manual_reconcile(db, bank_transaction_id, journal_line_id)
    bt = db.query(BankTransaction).filter(BankTransaction.id == bank_transaction_id).first()
    if bt:
        statement = db.query(BankStatement).filter(BankStatement.id == bt.statement_id).first()
        if statement:
            return _build_statement_payload(db, statement)
    return {"success": success}


@router.get("/reconciliation-report/{statement_id}")
@router.get("/statements/{statement_id}/report")
def get_recon_report(
    statement_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant", "client"))
):
    statement = db.query(BankStatement).filter(BankStatement.id == statement_id).first()
    if not statement:
        raise HTTPException(status_code=404, detail="Estado de cuenta no encontrado")
    return _build_statement_payload(db, statement)
