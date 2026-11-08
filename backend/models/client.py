from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from database import Base

class Client(Base):
    __tablename__ = 'clients'

    id = Column(Integer, primary_key=True, autoincrement=True)
    rfc = Column(String(13), unique=True, nullable=False, index=True)
    business_name = Column(String(300), nullable=False)
    legal_name = Column(String(300))
    tax_regime = Column(String(100))
    postal_code = Column(String(10))
    address = Column(Text)
    phone = Column(String(20))
    email = Column(String(100))
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    accounts = relationship("Account", back_populates="client")
    journal_entries = relationship("JournalEntry", back_populates="client")
    bank_accounts = relationship("BankAccount", back_populates="client")
    users = relationship("User", back_populates="client")
