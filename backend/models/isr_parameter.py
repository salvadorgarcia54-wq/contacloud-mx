from sqlalchemy import Column, Integer, String, Float, Text, DateTime, ForeignKey, UniqueConstraint
from datetime import datetime
from database import Base


class ISRParameter(Base):
    __tablename__ = "isr_parameters"

    id = Column(Integer, primary_key=True, autoincrement=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False, index=True)
    year = Column(Integer, nullable=False, index=True)
    month = Column(Integer, nullable=False, index=True)

    # Régimen seleccionado: '601', '626_PM', '626_PF', '612'
    regime_code = Column(String(20), nullable=True)

    # Parámetros fiscales editables
    coeficiente_utilidad = Column(Float, nullable=False, default=0.0)  # Ej. 0.1452 (hasta 4-6 decimales)
    perdidas_fiscales = Column(Float, nullable=False, default=0.0)     # Pérdidas de ejercicios anteriores por amortizar
    ptu_pagada = Column(Float, nullable=False, default=0.0)            # PTU pagada disminuible en el periodo
    estimulos_fiscales = Column(Float, nullable=False, default=0.0)    # Estímulos fiscales aplicables
    ingresos_adicionales = Column(Float, nullable=False, default=0.0)  # Otros ingresos nominales / ajuste manual
    deducciones_adicionales = Column(Float, nullable=False, default=0.0)  # Otras deducciones autorizadas manuales
    pagos_provisionales_manual = Column(Float, nullable=True)          # Override opcional de pagos provisionales previos
    retenciones_manual = Column(Float, nullable=True)                  # Override opcional de ISR retenido

    notes = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("client_id", "year", "month", name="uix_client_isr_period"),
    )
