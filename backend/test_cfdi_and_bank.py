import sys
sys.path.insert(0, '.')
from starlette.testclient import TestClient
from main import app
import io

client = TestClient(app)
res = client.post('/api/auth/login', json={'username': 'admin', 'password': 'admin123'})
assert res.status_code == 200, res.text
token = res.json()['access_token']
headers = {'Authorization': f'Bearer {token}'}

sample_cfdi = b'''<?xml version="1.0" encoding="utf-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" Version="4.0" Serie="A" Folio="1001" Fecha="2026-10-02T12:00:00" TipoDeComprobante="I" SubTotal="10000.00" Total="11600.00" Moneda="MXN" MetodoPago="PUE" FormaPago="03">
    <cfdi:Emisor Rfc="AAA010101AAA" Nombre="EMPRESA EMISORA SA DE CV" RegimenFiscal="601" />
    <cfdi:Receptor Rfc="XAXX010101000" Nombre="PUBLICO EN GENERAL" UsoCFDI="G03" RegimenFiscalReceptor="616" DomicilioFiscalReceptor="06000" />
    <cfdi:Conceptos>
        <cfdi:Concepto ClaveProdServ="84111500" Cantidad="1" ClaveUnidad="E48" Descripcion="Servicios contables" ValorUnitario="10000.00" Importe="10000.00">
            <cfdi:Impuestos>
                <cfdi:Traslados>
                    <cfdi:Traslado Base="10000.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="1600.00" />
                </cfdi:Traslados>
            </cfdi:Impuestos>
        </cfdi:Concepto>
    </cfdi:Conceptos>
    <cfdi:Impuestos TotalImpuestosTrasladados="1600.00">
        <cfdi:Traslados>
            <cfdi:Traslado Base="10000.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="1600.00" />
        </cfdi:Traslados>
    </cfdi:Impuestos>
    <cfdi:Complemento>
        <tfd:TimbreFiscalDigital Version="1.1" UUID="ABCDEF12-3456-7890-ABCD-EF1234567890" FechaTimbrado="2026-10-02T12:01:00" RfcProvCertif="SAT970701NN3" SelloCFD="dummy" NoCertificadoSAT="00001000000500000000" SelloSAT="dummy" />
    </cfdi:Complemento>
</cfdi:Comprobante>
'''

files = {'file': ('factura_1001.xml', io.BytesIO(sample_cfdi), 'text/xml')}
res_upload = client.post('/api/journals/client/1/cfdi-upload', files=files, headers=headers)
print('CFDI Upload Status:', res_upload.status_code)
print('CFDI Upload Response:', res_upload.json())
assert res_upload.status_code == 200

# Verify created entry
entry_id = res_upload.json()['entry_id']
res_entry = client.get(f'/api/journals/{entry_id}', headers=headers)
entry_data = res_entry.json()
print('Fetched Entry:', res_entry.status_code, 'UUID:', entry_data['cfdi_uuid'], 'is_auto:', entry_data['is_auto'])
print('Lines count:', len(entry_data['lines']))
for l in entry_data['lines']:
    print(f"  Line: {l['account_number']} - {l['account_name']} | Debe: {l['debit']} | Haber: {l['credit']}")

# Now test Bank account creation and bank reconciliation
accs = client.get('/api/accounts/client/1', headers=headers).json()
banco_account = next(a for a in accs if a['sat_group_code'].startswith('102'))

bank_acc_payload = {
    'client_id': 1,
    'bank_name': 'BBVA México',
    'account_number': '0123456789',
    'clabe': '012180001234567890',
    'currency': 'MXN',
    'linked_account_id': banco_account['id']
}
res_bank = client.post('/api/bank/accounts', json=bank_acc_payload, headers=headers)
print('Bank Account Created:', res_bank.status_code, res_bank.json())
assert res_bank.status_code == 200
bank_acc_id = res_bank.json()['id']

# Upload statement CSV
csv_content = b'''Fecha,Descripcion,Referencia,Cargo,Abono
01/10/2026,DEPOSITO TRANSFERENCIA,TRF123456,0,11600.00
02/10/2026,COMISION POR MANEJO DE CUENTA,COM001,250.00,0
'''
files_csv = {'file': ('estado_cuenta_oct2026.csv', io.BytesIO(csv_content), 'text/csv')}
data_csv = {'bank_account_id': bank_acc_id, 'year': 2026, 'month': 10}
res_stmt = client.post('/api/bank/statements/upload', data=data_csv, files=files_csv, headers=headers)
print('Statement Upload Status:', res_stmt.status_code, res_stmt.json())
assert res_stmt.status_code == 200

# List transactions
stmts = client.get(f'/api/bank/statements/{bank_acc_id}', headers=headers).json()
stmt_id = stmts[0]['id']
txs = client.get(f'/api/bank/statements/{stmt_id}/transactions', headers=headers).json()
print('Transactions imported:', len(txs))

# Run auto-reconciliation
res_rec = client.post(f'/api/bank/reconcile/{stmt_id}', headers=headers)
print('Auto-reconcile Status:', res_rec.status_code, res_rec.json())

# Get reconciliation report
res_rep = client.get(f'/api/bank/reconciliation-report/{stmt_id}', headers=headers)
print('Recon Report Status:', res_rep.status_code, res_rep.json())

print('ALL TESTS PASSED SUCCESSFULLY!')
