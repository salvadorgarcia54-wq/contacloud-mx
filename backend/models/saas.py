from sqlalchemy import Column, Integer, String, Boolean, DateTime, Float, ForeignKey, Text
from datetime import datetime, timedelta
from database import Base


class SaasTenant(Base):
    __tablename__ = "saas_tenants"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False)
    slug = Column(String(120), unique=True, nullable=False, index=True)
    rfc = Column(String(20), nullable=True)
    postal_code = Column(String(10), nullable=True)
    tax_regime = Column(String(120), nullable=True)
    cfdi_use = Column(String(120), nullable=True, default="G03 - Gastos en general")
    billing_email = Column(String(150), nullable=True)
    phone = Column(String(50), nullable=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    admin_username = Column(String(80), nullable=True)
    admin_password = Column(String(120), nullable=True)

    # Plan SaaS: starter | profesional | empresarial | corporativo
    plan_code = Column(String(40), nullable=False, default="empresarial")
    billing_cycle = Column(String(20), nullable=False, default="monthly")  # monthly | annual
    status = Column(String(30), nullable=False, default="active")  # active | trial | past_due | cancelled

    price_mxn = Column(Float, nullable=False, default=3490.0)
    max_clients = Column(Integer, nullable=False, default=100)
    max_users = Column(Integer, nullable=False, default=25)
    max_cfdis_per_month = Column(Integer, nullable=False, default=50000)

    payment_method = Column(String(120), nullable=True, default="Tarjeta Corporativa •••• 4242")
    stripe_customer_id = Column(String(100), nullable=True)
    stripe_subscription_id = Column(String(100), nullable=True)
    stripe_payment_method_id = Column(String(100), nullable=True)
    card_brand = Column(String(40), nullable=True)
    card_last4 = Column(String(10), nullable=True)
    card_holder_name = Column(String(150), nullable=True)

    auto_renew = Column(Boolean, default=True)
    trial_ends_at = Column(DateTime, nullable=True)
    current_period_start = Column(DateTime, default=datetime.utcnow)
    current_period_end = Column(DateTime, default=lambda: datetime.utcnow() + timedelta(days=30))
    created_at = Column(DateTime, default=datetime.utcnow)

    # Indicadores de Comportamiento, CX, Retención, Soporte y Adquisición (KPIs por Tenant)
    nps_score = Column(Integer, nullable=True)       # Escala 0 a 10
    csat_score = Column(Float, nullable=True)        # Escala 1.0 a 5.0
    ces_score = Column(Float, nullable=True)         # Escala 1.0 a 5.0 (menor = menos esfuerzo)
    frt_minutes = Column(Float, nullable=True)       # First Response Time (minutos)
    fcr_rate = Column(Float, nullable=True)          # First Contact Resolution (%)
    art_hours = Column(Float, nullable=True)         # Average Resolution Time / TMR (horas)
    cac_mxn = Column(Float, nullable=True)           # Costo de Adquisición del Cliente (MXN)
    tenure_months = Column(Integer, nullable=True)   # Meses de relación / vida estimada

    # Datos de Cancelación y Retroalimentación
    cancelled_at = Column(DateTime, nullable=True)
    cancellation_reason = Column(String(200), nullable=True)
    cancellation_comments = Column(Text, nullable=True)


class SaasCancellationFeedback(Base):
    __tablename__ = "saas_cancellation_feedback"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("saas_tenants.id"), nullable=False, index=True)
    tenant_name = Column(String(200), nullable=True)
    plan_code = Column(String(40), nullable=True)
    primary_reason = Column(String(200), nullable=False)
    secondary_reasons = Column(Text, nullable=True)
    satisfaction_score = Column(Integer, nullable=False, default=4)
    nps_likelihood = Column(Integer, nullable=True, default=7)
    missing_features = Column(Text, nullable=True)
    alternative_solution = Column(String(150), nullable=True)
    would_return = Column(String(40), nullable=True, default="Tal vez")
    comments = Column(Text, nullable=True)
    cancelled_by_username = Column(String(80), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class SaasInvoice(Base):
    __tablename__ = "saas_invoices"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("saas_tenants.id"), nullable=False, index=True)
    folio = Column(String(60), unique=True, nullable=False)
    plan_name = Column(String(100), nullable=False)
    billing_cycle = Column(String(20), nullable=False, default="monthly")
    amount = Column(Float, nullable=False, default=0.0)
    currency = Column(String(10), nullable=False, default="MXN")
    status = Column(String(30), nullable=False, default="Pagado")
    payment_method = Column(String(120), nullable=True)
    period_label = Column(String(100), nullable=True)
    cfdi_uuid = Column(String(60), nullable=True)
    stripe_payment_intent_id = Column(String(100), nullable=True)
    payment_reference = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class SaasStripeConfig(Base):
    __tablename__ = "saas_stripe_config"

    id = Column(Integer, primary_key=True, autoincrement=True)
    mode = Column(String(20), nullable=False, default="test")  # test | live
    publishable_key = Column(String(255), nullable=True)
    secret_key = Column(String(255), nullable=True)
    webhook_secret = Column(String(255), nullable=True)
    payment_link_starter = Column(String(300), nullable=True)
    payment_link_profesional = Column(String(300), nullable=True)
    payment_link_empresarial = Column(String(300), nullable=True)
    payment_link_corporativo = Column(String(300), nullable=True)
    spei_bank_name = Column(String(100), nullable=True, default="STP / BBVA México (Stripe SPEI)")
    spei_clabe = Column(String(30), nullable=True, default="646180157042891042")
    spei_beneficiary = Column(String(180), nullable=True, default="Iterumx S.A. de C.V.")
    enable_oxxo_7eleven = Column(Boolean, default=True)
    auto_block_expired_trials = Column(Boolean, default=True)
    updated_at = Column(DateTime, default=datetime.utcnow)
