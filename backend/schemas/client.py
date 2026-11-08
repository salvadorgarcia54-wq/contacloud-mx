from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class ClientCreate(BaseModel):
    rfc: str
    business_name: str
    legal_name: Optional[str] = None
    tax_regime: Optional[str] = None
    postal_code: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    status: Optional[str] = None
    is_active: Optional[bool] = True

class ClientUpdate(BaseModel):
    rfc: Optional[str] = None
    business_name: Optional[str] = None
    legal_name: Optional[str] = None
    tax_regime: Optional[str] = None
    postal_code: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    status: Optional[str] = None
    is_active: Optional[bool] = None

class ClientResponse(BaseModel):
    id: int
    rfc: str
    business_name: str
    legal_name: Optional[str] = None
    tax_regime: Optional[str] = None
    postal_code: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True
