from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base

class AuditLog(Base):
    __tablename__ = 'audit_logs'

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True)
    username = Column(String(100), nullable=False, index=True)
    user_full_name = Column(String(200), nullable=True)
    user_role = Column(String(50), nullable=True)
    client_id = Column(Integer, ForeignKey('clients.id', ondelete='SET NULL'), nullable=True, index=True)
    client_name = Column(String(255), nullable=True)
    client_rfc = Column(String(20), nullable=True)
    action = Column(String(100), nullable=False, index=True)
    module = Column(String(100), nullable=False, index=True)
    entity_id = Column(String(100), nullable=True)
    description = Column(Text, nullable=False)
    details = Column(Text, nullable=True)
    ip_address = Column(String(60), nullable=True)
    duration_seconds = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    user = relationship("User", foreign_keys=[user_id])
    client = relationship("Client", foreign_keys=[client_id])

    __table_args__ = (
        Index('idx_audit_logs_user_created', 'user_id', 'created_at'),
        Index('idx_audit_logs_client_created', 'client_id', 'created_at'),
    )
