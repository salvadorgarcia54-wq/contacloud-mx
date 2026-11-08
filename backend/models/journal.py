from sqlalchemy import Column, Integer, String, Boolean, DateTime, Date, Numeric, Text, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base

class JournalEntry(Base):
    __tablename__ = 'journal_entries'

    id = Column(Integer, primary_key=True, autoincrement=True)
    client_id = Column(Integer, ForeignKey('clients.id'), nullable=False, index=True)
    entry_number = Column(Integer, nullable=False)
    entry_type = Column(String(20), nullable=False)
    date = Column(Date, nullable=False, index=True)
    description = Column(String(500))
    reference = Column(String(150), nullable=True)
    cfdi_uuid = Column(String(36), nullable=True, index=True)
    cfdi_issuer_rfc = Column(String(13), nullable=True)
    cfdi_issuer_name = Column(String(300), nullable=True)
    cfdi_receiver_rfc = Column(String(13), nullable=True)
    cfdi_total = Column(Numeric(18,2), nullable=True)
    cfdi_xml_data = Column(Text, nullable=True)
    is_auto = Column(Boolean, default=False)
    is_cancelled = Column(Boolean, default=False)
    created_by = Column(Integer, ForeignKey('users.id'))
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint('client_id', 'entry_number', 'entry_type', 'date', name='uix_journal_entry_unique'),
    )

    client = relationship("Client", back_populates="journal_entries")
    lines = relationship("JournalLine", back_populates="entry", cascade="all, delete-orphan")
    created_by_user = relationship("User")

class JournalLine(Base):
    __tablename__ = 'journal_lines'

    id = Column(Integer, primary_key=True, autoincrement=True)
    entry_id = Column(Integer, ForeignKey('journal_entries.id'), nullable=False, index=True)
    account_id = Column(Integer, ForeignKey('accounts.id'), nullable=False, index=True)
    debit = Column(Numeric(18,2), default=0)
    credit = Column(Numeric(18,2), default=0)
    description = Column(String(500))
    line_order = Column(Integer, nullable=False)

    entry = relationship("JournalEntry", back_populates="lines")
    account = relationship("Account", back_populates="journal_lines")
