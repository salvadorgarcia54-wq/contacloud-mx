import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from datetime import datetime
from database import SessionLocal
from models.cfdi import CFDIInvoice
from models.journal import JournalEntry, JournalLine
from models.account import Account
from services.cfdi_parser import post_cfdi_invoice_to_journal

db = SessionLocal()

# Cleanup previous test records if any
db.query(CFDIInvoice).filter(CFDIInvoice.uuid.in_(['TEST-PAGO-EMITIDO-001', 'TEST-PAGO-RECIBIDO-002'])).delete()
db.commit()

try:
    print("=== TEST 1: Complemento de Pago Emitido (Cobro a Cliente) ===")
    inv_emitido = CFDIInvoice(
        client_id=4,
        cfdi_type='emitido',
        uuid='TEST-PAGO-EMITIDO-001',
        folio='PAGO-01',
        date=datetime.now(),
        issuer_rfc='GASS680127FF3',
        issuer_name='SALVADOR GARCIA SALAS',
        receiver_rfc='MEMH891127MF9',
        receiver_name='HECTOR ANTONIO MEDINA MENDEZ',
        payment_method='PAGO',
        payment_form='03',
        clave_prod_serv='84111506',
        description='Complemento de Pago Cobro Factura F-F35',
        subtotal=1000.0,
        iva_trasladado=160.0,
        total=1160.0,
        tipo_comprobante='P',
        related_uuid='F35-UUID-ORIGINAL-TEST',
        related_folio='F-F35',
        is_posted=False
    )
    db.add(inv_emitido)
    db.commit()
    db.refresh(inv_emitido)

    entry_emitido = post_cfdi_invoice_to_journal(db, inv_emitido, 1)
    db.commit()
    print(f"Póliza #{entry_emitido.entry_number} ({entry_emitido.entry_type}) generada con éxito.")
    print(f"CFDI UUID: {entry_emitido.cfdi_uuid} | Referencia: {entry_emitido.reference}")
    for l in entry_emitido.lines:
        acc = db.query(Account).filter(Account.id == l.account_id).first()
        print(f"  Line: {acc.account_number} ({acc.name}) | Debe: {l.debit:.2f} | Haber: {l.credit:.2f} | Desc: {l.description}")

    total_debe = sum(l.debit for l in entry_emitido.lines)
    total_haber = sum(l.credit for l in entry_emitido.lines)
    assert abs(total_debe - total_haber) < 0.01, "Descuadrada"
    assert entry_emitido.entry_type == 'ingreso', "Tipo de póliza debe ser ingreso"
    print(f"Cuadre perfecto: Debe ${total_debe:.2f} == Haber ${total_haber:.2f}\n")

    print("=== TEST 2: Complemento de Pago Recibido (Pago a Proveedor) ===")
    inv_recibido = CFDIInvoice(
        client_id=4,
        cfdi_type='recibido',
        uuid='TEST-PAGO-RECIBIDO-002',
        folio='REC-PAGO-01',
        date=datetime.now(),
        issuer_rfc='CON150220HIA',
        issuer_name='CONTALINK',
        receiver_rfc='GASS680127FF3',
        receiver_name='SALVADOR GARCIA SALAS',
        payment_method='PAGO',
        payment_form='03',
        clave_prod_serv='84111506',
        description='Complemento de Pago Factura C565847',
        subtotal=1000.0,
        iva_trasladado=160.0,
        total=1160.0,
        tipo_comprobante='P',
        related_uuid='C565847-UUID-ORIGINAL-TEST',
        related_folio='C565847',
        is_posted=False
    )
    db.add(inv_recibido)
    db.commit()
    db.refresh(inv_recibido)

    entry_recibido = post_cfdi_invoice_to_journal(db, inv_recibido, 1)
    db.commit()
    print(f"Póliza #{entry_recibido.entry_number} ({entry_recibido.entry_type}) generada con éxito.")
    print(f"CFDI UUID: {entry_recibido.cfdi_uuid} | Referencia: {entry_recibido.reference}")
    for l in entry_recibido.lines:
        acc = db.query(Account).filter(Account.id == l.account_id).first()
        print(f"  Line: {acc.account_number} ({acc.name}) | Debe: {l.debit:.2f} | Haber: {l.credit:.2f} | Desc: {l.description}")

    total_debe_rec = sum(l.debit for l in entry_recibido.lines)
    total_haber_rec = sum(l.credit for l in entry_recibido.lines)
    assert abs(total_debe_rec - total_haber_rec) < 0.01, "Descuadrada"
    assert entry_recibido.entry_type == 'egreso', "Tipo de póliza debe ser egreso"
    print(f"Cuadre perfecto: Debe ${total_debe_rec:.2f} == Haber ${total_haber_rec:.2f}\n")

    # Clean up test entries
    db.query(JournalLine).filter(JournalLine.entry_id.in_([entry_emitido.id, entry_recibido.id])).delete()
    db.query(JournalEntry).filter(JournalEntry.id.in_([entry_emitido.id, entry_recibido.id])).delete()
    db.query(CFDIInvoice).filter(CFDIInvoice.id.in_([inv_emitido.id, inv_recibido.id])).delete()
    db.commit()
    print("=== TODOS LOS TESTS PASARON EXITOSAMENTE Y LIMPIARON REGISTROS DE PRUEBA ===")

finally:
    db.close()
