from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from datetime import datetime
from database import Base


class TempPassword(Base):
    __tablename__ = 'temp_passwords'

    id = Column(Integer, primary_key=True, autoincrement=True)
    token_uuid = Column(String(64), unique=True, nullable=False, index=True)
    token_clean = Column(String(32), unique=True, nullable=False, index=True)
    purpose = Column(String(50), nullable=False, default='general')
    target_user_id = Column(Integer, ForeignKey('users.id'), nullable=True)
    target_client_id = Column(Integer, ForeignKey('clients.id'), nullable=True)
    duration_value = Column(Integer, nullable=False, default=30)
    duration_unit = Column(String(20), nullable=False, default='minutes')
    notes = Column(String(300), nullable=True)
    recipient_email = Column(String(150), nullable=True)
    recipient_phone = Column(String(50), nullable=True)
    created_by_id = Column(Integer, ForeignKey('users.id'), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    is_revoked = Column(Boolean, default=False)
    used_count = Column(Integer, default=0)
    last_used_at = Column(DateTime, nullable=True)
