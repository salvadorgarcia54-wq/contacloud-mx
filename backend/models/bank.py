from sqlalchemy import Column, Integer, String, Boolean, DateTime, Date, Numeric, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base

class BankAccount(Base):
    __tablename__ = 'bank_accounts'

    id = Column(Integer, primary_key=True, autoincrement=True)
    client_id = Column(Integer, ForeignKey('clients.id'), nullable=False)
    bank_name = Column(String(100), nullable=False)
    account_number = Column(String(30))
    clabe = Column(String(18))
    currency = Column(String(3), default='MXN')
    linked_account_id = Column(Integer, ForeignKey('accounts.id'), nullable=True)
    is_active = Column(Boolean, default=True)

    client = relationship("Client", back_populates="bank_accounts")
    linked_account = relationship("Account")
    statements = relationship("BankStatement", back_populates="bank_account")

class BankStatement(Base):
    __tablename__ = 'bank_statements'

    id = Column(Integer, primary_key=True, autoincrement=True)
    bank_account_id = Column(Integer, ForeignKey('bank_accounts.id'), nullable=False)
    period_year = Column(Integer, nullable=False)
    period_month = Column(Integer, nullable=False)
    initial_balance = Column(Numeric(18,2), default=0)
    final_balance = Column(Numeric(18,2), default=0)
    file_name = Column(String(255))
    uploaded_at = Column(DateTime, default=datetime.utcnow)

    bank_account = relationship("BankAccount", back_populates="statements")
    transactions = relationship("BankTransaction", back_populates="statement", cascade="all, delete-orphan")

class BankTransaction(Base):
    __tablename__ = 'bank_transactions'

    id = Column(Integer, primary_key=True, autoincrement=True)
    statement_id = Column(Integer, ForeignKey('bank_statements.id'), nullable=False, index=True)
    date = Column(Date, nullable=False)
    description = Column(String(500))
    reference = Column(String(100))
    amount = Column(Numeric(18,2), nullable=False)
    transaction_type = Column(String(10), nullable=False)
    is_reconciled = Column(Boolean, default=False)
    matched_journal_line_id = Column(Integer, ForeignKey('journal_lines.id'), nullable=True)

    statement = relationship("BankStatement", back_populates="transactions")
    matched_journal_line = relationship("JournalLine")
