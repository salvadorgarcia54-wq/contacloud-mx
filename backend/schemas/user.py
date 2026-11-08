from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class UserCreate(BaseModel):
    username: str
    email: Optional[str] = None
    password: str
    full_name: Optional[str] = None
    position: Optional[str] = None
    phone: Optional[str] = None
    photo_url: Optional[str] = None
    can_create_clients: Optional[bool] = False
    assigned_client_ids: Optional[List[int]] = []
    role: str = 'accountant'
    client_id: Optional[int] = None
    is_active: Optional[bool] = True

class UserUpdate(BaseModel):
    username: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    full_name: Optional[str] = None
    position: Optional[str] = None
    phone: Optional[str] = None
    photo_url: Optional[str] = None
    can_create_clients: Optional[bool] = None
    assigned_client_ids: Optional[List[int]] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None

class UserLogin(BaseModel):
    username: str
    password: str

class UserResponse(BaseModel):
    id: int
    username: str
    email: Optional[str] = None
    full_name: Optional[str] = None
    position: Optional[str] = None
    phone: Optional[str] = None
    photo_url: Optional[str] = None
    can_create_clients: Optional[bool] = False
    assigned_client_ids: Optional[List[int]] = []
    role: str
    client_id: Optional[int] = None
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token: Optional[str] = None
    token_type: str = "bearer"
    user: Optional[UserResponse] = None

class TokenData(BaseModel):
    username: Optional[str] = None
    role: Optional[str] = None
    user_id: Optional[int] = None
    client_id: Optional[int] = None

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
