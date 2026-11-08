from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime
from decimal import Decimal

class BankAccountCreate(BaseModel):
    client_id: int
    bank_name: str
    account_number: Optional[str] = None
    clabe: Optional[str] = None
    currency: str = 'MXN'
    linked_account_id: Optional[int] = None

class BankAccountResponse(BaseModel):
    id: int
    client_id: int
    bank_name: str
    account_number: Optional[str] = None
    clabe: Optional[str] = None
    currency: str
    linked_account_id: Optional[int] = None
    is_active: bool

    class Config:
        from_attributes = True

class BankTransactionResponse(BaseModel):
    id: int
    statement_id: int
    date: date
    description: Optional[str] = None
    reference: Optional[str] = None
    amount: Decimal
    transaction_type: str
    is_reconciled: bool
    matched_journal_line_id: Optional[int] = None

    class Config:
        from_attributes = True

class BankStatementResponse(BaseModel):
    id: int
    bank_account_id: int
    period_year: int
    period_month: int
    initial_balance: Decimal
    final_balance: Decimal
    file_name: Optional[str] = None
    uploaded_at: datetime
    transactions: List[BankTransactionResponse] = []

    class Config:
        from_attributes = True

class ReconciliationResult(BaseModel):
    reconciled_count: int
    unreconciled_bank: int
    unreconciled_books: int
    bank_balance: Decimal
    books_balance: Decimal
