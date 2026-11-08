from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base

class SATAccountGroup(Base):
    __tablename__ = 'sat_account_groups'

    id = Column(Integer, primary_key=True)
    code = Column(String(20), unique=True, nullable=False, index=True)
    name = Column(String(300), nullable=False)
    level = Column(Integer, nullable=False)
    nature = Column(String(10), nullable=False)
    account_type = Column(String(20), nullable=False)
    parent_code = Column(String(20), ForeignKey('sat_account_groups.code'), nullable=True)

    parent = relationship("SATAccountGroup", remote_side=[code])

class Account(Base):
    __tablename__ = 'accounts'

    id = Column(Integer, primary_key=True, autoincrement=True)
    client_id = Column(Integer, ForeignKey('clients.id'), nullable=False, index=True)
    account_number = Column(String(30), nullable=False)
    name = Column(String(300), nullable=False)
    sat_group_code = Column(String(20), ForeignKey('sat_account_groups.code'), nullable=False)
    level = Column(Integer, nullable=False)
    nature = Column(String(10), nullable=False)
    parent_id = Column(Integer, ForeignKey('accounts.id'), nullable=True)
    classification = Column(String(20), default='Acumulación', nullable=False) # 'Acumulación' o 'Afectable'
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint('client_id', 'account_number', name='uix_client_account_number'),
    )

    client = relationship("Client", back_populates="accounts")
    sat_group = relationship("SATAccountGroup")
    parent = relationship("Account", remote_side=[id], back_populates="children")
    children = relationship("Account", back_populates="parent")
    journal_lines = relationship("JournalLine", back_populates="account")
