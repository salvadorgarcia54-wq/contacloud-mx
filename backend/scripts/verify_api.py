import sqlite3
import json
import urllib.request
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from routers.auth import create_access_token

conn = sqlite3.connect('contacloud.db')
c = conn.cursor()
user = c.execute('SELECT id, username, role FROM users LIMIT 1').fetchone()
token = create_access_token({'sub': user[1], 'role': user[2], 'user_id': user[0]})

headers = {'Authorization': f'Bearer {token}'}

for eid in [20, 8, 19]:
    req = urllib.request.Request(f'http://localhost:8000/api/journals/{eid}', headers=headers)
    with urllib.request.urlopen(req) as resp:
        entry = json.loads(resp.read().decode())
    print('=============================================')
    print(f"ENTRY ID: {eid} | TIPO: {entry['entry_type'].upper()} | NO: {entry['entry_number']}")
    print(f"CONCEPTO: {entry['description']}")
    print(f"REFERENCIA: {entry['reference']}")
    print(f"CFDI UUID: {entry['cfdi_uuid']}")
    print('LINEAS:')
    for l in entry['lines']:
        print(f"  {l['line_order']}. [{l['account_number']}] {l['account_name']}: Debe={l['debit']} Haber={l['credit']} | {l['description']}")
