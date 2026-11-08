from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class SATGroupResponse(BaseModel):
    code: str
    name: str
    level: int
    nature: str
    account_type: str
    parent_code: Optional[str] = None

    class Config:
        from_attributes = True

class AccountCreate(BaseModel):
    client_id: int
    account_number: str
    name: str
    sat_group_code: str
    level: Optional[int] = 3
    nature: Optional[str] = 'deudora'
    parent_id: Optional[int] = None
    classification: Optional[str] = 'Afectable'
    is_active: Optional[bool] = True

class AccountUpdate(BaseModel):
    account_number: Optional[str] = None
    name: Optional[str] = None
    sat_group_code: Optional[str] = None
    level: Optional[int] = None
    nature: Optional[str] = None
    classification: Optional[str] = None
    is_active: Optional[bool] = None

class AccountResponse(BaseModel):
    id: int
    client_id: int
    account_number: str
    name: str
    sat_group_code: str
    level: int
    nature: str
    parent_id: Optional[int] = None
    classification: str = 'Acumulación'
    is_active: bool = True
    created_at: datetime
    sat_group: Optional[SATGroupResponse] = None

    class Config:
        from_attributes = True
