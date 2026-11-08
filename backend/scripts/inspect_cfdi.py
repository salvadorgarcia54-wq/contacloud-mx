import sqlite3
from lxml import etree

conn = sqlite3.connect('contacloud.db')
c = conn.cursor()

for inv_id in [30, 34, 38]:
    row = c.execute('SELECT id, folio, issuer_name, raw_xml FROM cfdi_invoices WHERE id = ?', (inv_id,)).fetchone()
    print('==============================')
    print(f'INVOICE ID {row[0]}: {row[1]} - {row[2]}')
    root = etree.fromstring(row[3].encode('utf-8'))
    
    print('Namespaces:', root.nsmap)
    print('Root attributes:', dict(root.attrib))
    
    print('--- Conceptos ---')
    for conc in root.xpath('//*[local-name()="Concepto"]'):
        print('Concepto:', dict(conc.attrib))
        for child in conc.iterchildren():
            print('  child:', child.tag, dict(child.attrib))
            for gchild in child.iterchildren():
                print('    grandchild:', gchild.tag, dict(gchild.attrib))
                
    print('--- Impuestos global ---')
    for imp in root.xpath('/cfdi:Comprobante/cfdi:Impuestos', namespaces={'cfdi': root.nsmap.get(None, 'http://www.sat.gob.mx/cfd/4')}):
        print('Impuestos node:', imp.tag, dict(imp.attrib))
        for child in imp.iterchildren():
            print('  child:', child.tag, dict(child.attrib))
            for gchild in child.iterchildren():
                print('    grandchild:', gchild.tag, dict(gchild.attrib))

    print('--- Complemento ---')
    for comp in root.xpath('//*[local-name()="Complemento"]'):
        for child in comp.iterchildren():
            print('  Complemento child:', child.tag, dict(child.attrib))
            for gchild in child.iterchildren():
                print('    gchild:', gchild.tag, dict(gchild.attrib))
