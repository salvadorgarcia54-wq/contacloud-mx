from sqlalchemy import Column, Integer, String, Boolean, Date, DateTime, Numeric, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base


class FixedAsset(Base):
    __tablename__ = 'fixed_assets'

    id = Column(Integer, primary_key=True, autoincrement=True)
    client_id = Column(Integer, ForeignKey('clients.id'), nullable=False, index=True)
    cfdi_invoice_id = Column(Integer, ForeignKey('cfdi_invoices.id'), nullable=True, index=True)
    cfdi_uuid = Column(String(36), nullable=True, index=True)

    description = Column(String(500), nullable=False)
    asset_type = Column(String(50), nullable=False)  # Ej: I01, I02, I03, I04, I05, I06, I07, I08, TERRENOS, ADAPTACIONES...
    asset_type_label = Column(String(200), nullable=True)

    acquisition_date = Column(Date, nullable=False)
    depreciation_start_date = Column(Date, nullable=False)
    has_disposal = Column(Boolean, default=False)
    disposal_date = Column(Date, nullable=True)

    moi = Column(Numeric(18, 2), nullable=False, default=0)
    depreciation_rate = Column(Numeric(8, 4), nullable=False, default=0)
    deductible_moi = Column(Numeric(18, 2), nullable=False, default=0)
    deductible_depreciation_rate = Column(Numeric(8, 4), nullable=False, default=0)
    sale_price = Column(Numeric(18, 2), nullable=False, default=0)

    asset_account_id = Column(Integer, ForeignKey('accounts.id'), nullable=True)
    depreciation_account_id = Column(Integer, ForeignKey('accounts.id'), nullable=True)
    expense_account_id = Column(Integer, ForeignKey('accounts.id'), nullable=True)
    non_deductible_account_id = Column(Integer, ForeignKey('accounts.id'), nullable=True)

    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    asset_account = relationship("Account", foreign_keys=[asset_account_id])
    depreciation_account = relationship("Account", foreign_keys=[depreciation_account_id])
    expense_account = relationship("Account", foreign_keys=[expense_account_id])
    non_deductible_account = relationship("Account", foreign_keys=[non_deductible_account_id])
    cfdi_invoice = relationship("CFDIInvoice", foreign_keys=[cfdi_invoice_id])
