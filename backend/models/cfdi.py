from sqlalchemy import Column, Integer, String, Boolean, DateTime, Numeric, Text, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base

class CFDIMapping(Base):
    __tablename__ = 'cfdi_mappings'

    id = Column(Integer, primary_key=True, autoincrement=True)
    client_id = Column(Integer, ForeignKey('clients.id'), nullable=False, index=True)
    mapping_type = Column(String(20), nullable=False)  # 'emitido' o 'recibido'
    rfc = Column(String(15), nullable=False, index=True)
    clave_prod_serv = Column(String(20), nullable=True, index=True)
    account_id = Column(Integer, ForeignKey('accounts.id'), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint('client_id', 'mapping_type', 'rfc', 'clave_prod_serv', name='uix_cfdi_mapping'),
    )

    account = relationship("Account")

class CFDIInvoice(Base):
    __tablename__ = 'cfdi_invoices'

    id = Column(Integer, primary_key=True, autoincrement=True)
    client_id = Column(Integer, ForeignKey('clients.id'), nullable=False, index=True)
    cfdi_type = Column(String(20), nullable=False)  # 'emitido' o 'recibido'
    uuid = Column(String(36), nullable=False, index=True)
    folio = Column(String(50), nullable=True)
    date = Column(DateTime, nullable=False)
    
    # Emisor / Receptor
    issuer_rfc = Column(String(15), nullable=True)
    issuer_name = Column(String(300), nullable=True)
    receiver_rfc = Column(String(15), nullable=True)
    receiver_name = Column(String(300), nullable=True)
    
    # Fiscal fields
    payment_method = Column(String(10), nullable=True)  # PUE / PPD
    payment_form = Column(String(10), nullable=True)  # 01, 03, 99...
    cfdi_use = Column(String(10), nullable=True)  # G03, CP01...
    clave_prod_serv = Column(String(20), nullable=True)  # Clave SAT
    description = Column(String(500), nullable=True)
    
    # Amounts
    subtotal = Column(Numeric(18,2), nullable=False, default=0)
    iva_trasladado = Column(Numeric(18,2), nullable=False, default=0)
    retencion_isr = Column(Numeric(18,2), nullable=False, default=0)
    retencion_iva = Column(Numeric(18,2), nullable=False, default=0)
    total = Column(Numeric(18,2), nullable=False, default=0)
    
    # Accounting link
    assigned_account_id = Column(Integer, ForeignKey('accounts.id'), nullable=True)
    journal_entry_id = Column(Integer, ForeignKey('journal_entries.id'), nullable=True)
    is_posted = Column(Boolean, default=False)
    
    # Complementos de Pago
    tipo_comprobante = Column(String(5), nullable=True, default='I')
    related_uuid = Column(String(36), nullable=True, index=True)
    related_folio = Column(String(50), nullable=True)

    raw_xml = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint('client_id', 'uuid', name='uix_client_cfdi_uuid'),
    )

    assigned_account = relationship("Account")
    journal_entry = relationship("JournalEntry")
