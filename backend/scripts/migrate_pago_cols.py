import sqlite3

conn = sqlite3.connect('contacloud.db')
c = conn.cursor()
cols = [r[1] for r in c.execute('PRAGMA table_info(cfdi_invoices)').fetchall()]
if 'tipo_comprobante' not in cols:
    c.execute("ALTER TABLE cfdi_invoices ADD COLUMN tipo_comprobante VARCHAR(5) DEFAULT 'I'")
if 'related_uuid' not in cols:
    c.execute("ALTER TABLE cfdi_invoices ADD COLUMN related_uuid VARCHAR(36)")
if 'related_folio' not in cols:
    c.execute("ALTER TABLE cfdi_invoices ADD COLUMN related_folio VARCHAR(50)")
conn.commit()
cols = [r[1] for r in c.execute('PRAGMA table_info(cfdi_invoices)').fetchall()]
print('Updated cols in cfdi_invoices:', cols)
conn.close()
