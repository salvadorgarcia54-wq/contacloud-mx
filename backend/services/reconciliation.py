from sqlalchemy.orm import Session
from sqlalchemy import extract
from models.bank import BankStatement, BankTransaction, BankAccount
from models.journal import JournalLine, JournalEntry


def auto_reconcile(db: Session, statement_id: int) -> dict:
    statement = db.query(BankStatement).filter(BankStatement.id == statement_id).first()
    if not statement:
        return {"error": "Statement not found"}

    bank_account = db.query(BankAccount).filter(BankAccount.id == statement.bank_account_id).first()
    if not bank_account or not bank_account.linked_account_id:
        return {"error": "No linked accounting account"}

    all_bt = (
        db.query(BankTransaction)
        .filter(BankTransaction.statement_id == statement_id)
        .order_by(BankTransaction.date.asc(), BankTransaction.id.asc())
        .all()
    )
    unreconciled_bt = [bt for bt in all_bt if not bt.is_reconciled]

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
    unreconciled_jl = jl_query.order_by(JournalEntry.date.asc(), JournalEntry.id.asc()).all()

    matched_jl_ids = {bt.matched_journal_line_id for bt in all_bt if bt.is_reconciled and bt.matched_journal_line_id}
    reconciled_count = 0

    # Pasada 1: Coincidencia exacta de importe y fecha cercana (<= 5 días)
    for bt in unreconciled_bt:
        if bt.is_reconciled:
            continue
        bt_amt = float(bt.amount or 0)
        bt_date = bt.date.date() if hasattr(bt.date, "date") else bt.date

        for jl in unreconciled_jl:
            if jl.id in matched_jl_ids:
                continue
            jl_amt = float(jl.debit or 0) if bt.transaction_type == "deposit" else float(jl.credit or 0)
            if abs(bt_amt - jl_amt) < 0.01:
                entry_date = jl.entry.date.date() if hasattr(jl.entry.date, "date") else jl.entry.date
                if abs((bt_date - entry_date).days) <= 5:
                    bt.is_reconciled = True
                    bt.matched_journal_line_id = jl.id
                    matched_jl_ids.add(jl.id)
                    reconciled_count += 1
                    break

    # Pasada 2: Coincidencia exacta de importe dentro del mismo mes para los restantes
    for bt in unreconciled_bt:
        if bt.is_reconciled:
            continue
        bt_amt = float(bt.amount or 0)
        for jl in unreconciled_jl:
            if jl.id in matched_jl_ids:
                continue
            jl_amt = float(jl.debit or 0) if bt.transaction_type == "deposit" else float(jl.credit or 0)
            if abs(bt_amt - jl_amt) < 0.01:
                bt.is_reconciled = True
                bt.matched_journal_line_id = jl.id
                matched_jl_ids.add(jl.id)
                reconciled_count += 1
                break

    db.commit()
    return {
        "reconciled_count": reconciled_count,
        "total_bank_transactions": len(all_bt),
        "total_book_entries": len(unreconciled_jl),
    }


def get_reconciliation_report(db: Session, statement_id: int) -> dict:
    statement = db.query(BankStatement).filter(BankStatement.id == statement_id).first()
    if not statement:
        return {"error": "Statement not found"}
    bank_account = db.query(BankAccount).filter(BankAccount.id == statement.bank_account_id).first()

    reconciled = (
        db.query(BankTransaction)
        .filter(BankTransaction.statement_id == statement_id, BankTransaction.is_reconciled == True)
        .order_by(BankTransaction.date.asc(), BankTransaction.id.asc())
        .all()
    )

    unreconciled_b = (
        db.query(BankTransaction)
        .filter(BankTransaction.statement_id == statement_id, BankTransaction.is_reconciled == False)
        .order_by(BankTransaction.date.asc(), BankTransaction.id.asc())
        .all()
    )

    unreconciled_books = []
    books_balance = 0.0
    if bank_account and bank_account.linked_account_id:
        jls = (
            db.query(JournalLine)
            .join(JournalEntry, JournalLine.entry_id == JournalEntry.id)
            .filter(
                JournalLine.account_id == bank_account.linked_account_id,
                JournalEntry.is_cancelled == False,
            )
            .order_by(JournalEntry.date.asc(), JournalEntry.id.asc())
            .all()
        )
        reconciled_jl_ids = {r.matched_journal_line_id for r in reconciled if r.matched_journal_line_id}
        for jl in jls:
            net = float((jl.debit or 0) - (jl.credit or 0))
            books_balance += net
            if jl.id not in reconciled_jl_ids:
                unreconciled_books.append(
                    {
                        "id": jl.id,
                        "date": str(jl.entry.date),
                        "description": jl.description or jl.entry.description,
                        "amount": abs(net),
                        "type": "debe" if (jl.debit or 0) > 0 else "haber",
                    }
                )

    bank_deposits = sum(float(t.amount or 0) for t in reconciled if t.transaction_type == "deposit")
    bank_withdrawals = sum(float(t.amount or 0) for t in reconciled if t.transaction_type != "deposit")
    bank_balance = float(statement.initial_balance or 0) + bank_deposits - bank_withdrawals

    return {
        "reconciled_items": [
            {"id": r.id, "description": r.description, "amount": float(r.amount), "type": r.transaction_type}
            for r in reconciled
        ],
        "unreconciled_bank": [
            {"id": u.id, "description": u.description, "amount": float(u.amount), "type": u.transaction_type}
            for u in unreconciled_b
        ],
        "unreconciled_books": unreconciled_books,
        "bank_balance": bank_balance,
        "books_balance": books_balance,
        "difference": abs(bank_balance - books_balance),
    }


def manual_reconcile(db: Session, bank_transaction_id: int, journal_line_id: int) -> bool:
    bt = db.query(BankTransaction).filter(BankTransaction.id == bank_transaction_id).first()
    if not bt:
        return False

    bt.is_reconciled = True
    bt.matched_journal_line_id = journal_line_id
    db.commit()
    return True
