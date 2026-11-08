from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime
from decimal import Decimal

class JournalLineCreate(BaseModel):
    account_id: int
    debit: Decimal = Decimal('0.0')
    credit: Decimal = Decimal('0.0')
    description: Optional[str] = None
    concept: Optional[str] = None
    line_order: Optional[int] = None

class JournalLineResponse(BaseModel):
    id: int
    entry_id: int
    account_id: int
    account_name: Optional[str] = None
    account_number: Optional[str] = None
    debit: Decimal
    credit: Decimal
    description: Optional[str] = None
    line_order: int

    class Config:
        from_attributes = True

class JournalEntryCreate(BaseModel):
    client_id: int
    entry_number: Optional[int] = None
    entry_type: str
    date: date
    description: Optional[str] = None
    concept: Optional[str] = None
    reference: Optional[str] = None
    cfdi_uuid: Optional[str] = None
    cfdi_issuer_rfc: Optional[str] = None
    cfdi_issuer_name: Optional[str] = None
    cfdi_receiver_rfc: Optional[str] = None
    cfdi_total: Optional[Decimal] = None
    cfdi_xml_data: Optional[str] = None
    is_auto: Optional[bool] = False
    lines: List[JournalLineCreate]

class JournalEntryResponse(BaseModel):
    id: int
    client_id: int
    entry_number: int
    entry_type: str
    date: date
    description: Optional[str] = None
    reference: Optional[str] = None
    cfdi_uuid: Optional[str] = None
    cfdi_issuer_rfc: Optional[str] = None
    cfdi_issuer_name: Optional[str] = None
    cfdi_receiver_rfc: Optional[str] = None
    cfdi_total: Optional[Decimal] = None
    cfdi_xml_data: Optional[str] = None
    is_auto: bool
    is_cancelled: bool
    created_by: Optional[int] = None
    created_at: datetime
    lines: List[JournalLineResponse]

    class Config:
        from_attributes = True

class JournalEntryListResponse(BaseModel):
    id: int
    client_id: int
    entry_number: int
    entry_type: str
    date: date
    description: Optional[str] = None
    reference: Optional[str] = None
    cfdi_uuid: Optional[str] = None
    is_auto: bool = False
    is_cancelled: bool = False
    total_debit: Decimal = Decimal('0.0')
    total_credit: Decimal = Decimal('0.0')
    has_resultado_accounts: Optional[bool] = False
    lines: Optional[List[JournalLineResponse]] = []
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True
