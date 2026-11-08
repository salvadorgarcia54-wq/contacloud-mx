import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import SessionLocal
from models.cfdi import CFDIInvoice
from models.journal import JournalEntry, JournalLine
from services.cfdi_parser import post_cfdi_invoice_to_journal

db = SessionLocal()

try:
    for inv_id in [30, 34, 38]:
        inv = db.query(CFDIInvoice).filter(CFDIInvoice.id == inv_id).first()
        print(f"\n==========================================")
        print(f"PROCESSING INVOICE ID {inv.id}: {inv.folio} - {inv.issuer_name}")
        print(f"Subtotal: {inv.subtotal}, IVA: {inv.iva_trasladado}, Total: {inv.total}")
        
        entry = post_cfdi_invoice_to_journal(db, inv, current_user_id=1)
        db.refresh(inv)
        print(f"SUCCESS: Generated {entry.entry_type.upper()} #{entry.entry_number} (Entry ID: {entry.id})")
        print(f"Description: {entry.description}")
        print(f"Lines:")
        total_deb = 0
        total_cred = 0
        for l in entry.lines:
            acc_num = l.account.account_number if l.account else "N/A"
            acc_name = l.account.name if l.account else "N/A"
            print(f"  {l.line_order}. [{acc_num}] {acc_name}: Debe={l.debit} Haber={l.credit} | {l.description}")
            total_deb += float(l.debit)
            total_cred += float(l.credit)
        print(f"Total Debe: {total_deb:.2f} | Total Haber: {total_cred:.2f} | Diff: {abs(total_deb - total_cred):.2f}")

except Exception as e:
    print(f"ERROR: {str(e)}")
    import traceback
    traceback.print_exc()
finally:
    db.close()
