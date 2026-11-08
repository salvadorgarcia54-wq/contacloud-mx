import os
import sys
import openpyxl

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from database import SessionLocal
from models.account import SATAccountGroup, Account
from models.journal import JournalLine

EXCEL_PATHS = [
    os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'data', 'catalogo_sat.xlsx')),
    r'C:\Users\MAQRFDCSVDR01\OneDrive\Documentos\catalogo_sat.xlsx'
]

def load_excel_items():
    excel_path = None
    for p in EXCEL_PATHS:
        if os.path.exists(p):
            excel_path = p
            break
            
    if not excel_path:
        raise FileNotFoundError("No se encontró el archivo catalogo_sat.xlsx")
        
    print(f"Leyendo catálogo SAT desde: {excel_path}")
    wb = openpyxl.load_workbook(excel_path, data_only=True)
    sheet = wb.active
    rows = list(sheet.iter_rows(values_only=True))[1:]
    
    items = []
    seen_codes = set()
    
    for r in rows:
        if not r[0]:
            continue
        raw_code = str(r[0]).strip()
        name = str(r[1]).strip() if r[1] else ''
        
        if '.' in raw_code:
            base, sub = raw_code.split('.')
            seg1 = base.zfill(3)[:3]
            # Si sub tiene 1 solo dígito (ej. .1, .2 de Excel float), representa .10, .20
            seg2 = (sub + '0') if len(sub) == 1 else sub.zfill(2)[:2]
            code = f"{base}.{seg2}"
            acc_num = f"{seg1}-{seg2}-000"
            level = 2
            parent_code = base
        else:
            seg1 = raw_code.zfill(3)[:3]
            code = raw_code
            acc_num = f"{seg1}-00-000"
            level = 1 if code in ('100', '200', '300', '400', '500', '600', '700', '800') else 2
            parent_code = None if level == 1 else f"{code[0]}00"
            
        first_digit = seg1[0]
        type_map = {
            '1': 'activo',
            '2': 'pasivo',
            '3': 'capital',
            '4': 'ingreso',
            '5': 'costo',
            '6': 'gasto',
            '7': 'rif',
            '8': 'orden'
        }
        acc_type = type_map.get(first_digit, 'activo')
        
        # Determinar naturaleza contable oficial
        if acc_type == 'activo':
            # Cuentas complementarias de activo (depreciaciones, estimaciones, amortizaciones)
            if any(code.startswith(p) for p in ('108', '116', '171', '172', '183', '189')):
                nature = 'acreedora'
            else:
                nature = 'deudora'
        elif acc_type == 'pasivo':
            nature = 'acreedora'
        elif acc_type == 'capital':
            if any(code.startswith(p) for p in ('304.02', '305.02', '306.02')):
                nature = 'deudora'
            else:
                nature = 'acreedora'
        elif acc_type == 'ingreso':
            if code.startswith('402'): # Devoluciones y descuentos
                nature = 'deudora'
            else:
                nature = 'acreedora'
        elif acc_type == 'costo':
            if code.startswith('503'): # Devoluciones sobre compras
                nature = 'acreedora'
            else:
                nature = 'deudora'
        elif acc_type == 'gasto':
            nature = 'deudora'
        elif acc_type == 'rif':
            if code.startswith('701') or code.startswith('703'):
                nature = 'deudora'
            else:
                nature = 'acreedora'
        else: # orden
            nature = 'deudora'
            
        if code in seen_codes:
            continue
        seen_codes.add(code)
        
        items.append({
            'code': code,
            'name': name,
            'level': level,
            'nature': nature,
            'account_type': acc_type,
            'parent_code': parent_code,
            'account_number': acc_num,
            'seg1': seg1
        })
        
    return items

def sync():
    items = load_excel_items()
    print(f"Total de cuentas leídas del Excel oficial del SAT: {len(items)}")
    
    db = SessionLocal()
    try:
        # 1. Sincronizar sat_account_groups
        existing_groups = {g.code: g for g in db.query(SATAccountGroup).all()}
        added_g = 0
        updated_g = 0
        
        for item in items:
            code = item['code']
            if code in existing_groups:
                g = existing_groups[code]
                g.name = item['name']
                g.level = item['level']
                g.nature = item['nature']
                g.account_type = item['account_type']
                g.parent_code = item['parent_code']
                updated_g += 1
            else:
                g = SATAccountGroup(
                    code=code,
                    name=item['name'],
                    level=item['level'],
                    nature=item['nature'],
                    account_type=item['account_type'],
                    parent_code=item['parent_code']
                )
                db.add(g)
                existing_groups[code] = g
                added_g += 1
                
        db.commit()
        print(f"SAT Account Groups actualizados: {updated_g}, agregados: {added_g}. Total en DB: {len(existing_groups)}")
        
        from models.client import Client
        clients = db.query(Client).all()

        
        for client in clients:
            cid = client.id
            print(f"\n--- Sincronizando cuentas para cliente {cid}: {client.business_name} ---")
            
            # Cuentas existentes del cliente
            client_accounts = db.query(Account).filter(Account.client_id == cid).all()
            acc_by_num = {a.account_number: a for a in client_accounts}
            acc_by_sat = {a.sat_group_code: a for a in client_accounts}
            
            # Verificar cuáles tienen pólizas contables para protegerlas
            used_account_ids = {r[0] for r in db.query(JournalLine.account_id).distinct().all()}
            
            # Eliminar cuentas obsoletas que no están en el Excel y no tienen movimientos
            valid_acc_numbers = {it['account_number'] for it in items}
            deleted_count = 0
            for a in client_accounts:
                if a.account_number not in valid_acc_numbers and a.id not in used_account_ids:
                    # Es una cuenta vieja que ya no existe en el SAT oficial
                    db.delete(a)
                    deleted_count += 1
            if deleted_count > 0:
                db.commit()
                print(f"Eliminadas {deleted_count} cuentas obsoletas sin movimientos.")
                
            # Re-consultar cuentas del cliente
            client_accounts = db.query(Account).filter(Account.client_id == cid).all()
            acc_by_num = {a.account_number: a for a in client_accounts}
            
            # Paso A: Crear / actualizar cuentas de nivel 1 (XXX-00-000)
            l1_items = [it for it in items if it['account_number'].endswith('-00-000')]
            l1_id_map = {} # seg1 -> account_id
            
            added_c = 0
            updated_c = 0
            
            for it in l1_items:
                num = it['account_number']
                if num in acc_by_num:
                    a = acc_by_num[num]
                    a.name = it['name']
                    a.sat_group_code = it['code']
                    a.nature = it['nature']
                    a.classification = 'Acumulación'
                    a.level = 1 if it['level'] == 1 else 2
                    updated_c += 1
                    l1_id_map[it['seg1']] = a.id
                else:
                    a = Account(
                        client_id=cid,
                        account_number=num,
                        name=it['name'],
                        sat_group_code=it['code'],
                        level=1 if it['level'] == 1 else 2,
                        nature=it['nature'],
                        classification='Acumulación',
                        is_active=True
                    )
                    db.add(a)
                    db.flush()
                    acc_by_num[num] = a
                    l1_id_map[it['seg1']] = a.id
                    added_c += 1
                    
            db.commit()
            
            # Paso B: Crear / actualizar subcuentas nivel 2 (XXX-YY-000)
            l2_items = [it for it in items if not it['account_number'].endswith('-00-000')]
            
            for it in l2_items:
                num = it['account_number']
                parent_id = l1_id_map.get(it['seg1'])
                if num in acc_by_num:
                    a = acc_by_num[num]
                    a.name = it['name']
                    a.sat_group_code = it['code']
                    a.nature = it['nature']
                    a.classification = 'Acumulación'
                    a.level = 2
                    a.parent_id = parent_id
                    updated_c += 1
                else:
                    a = Account(
                        client_id=cid,
                        account_number=num,
                        name=it['name'],
                        sat_group_code=it['code'],
                        level=2,
                        nature=it['nature'],
                        classification='Acumulación',
                        is_active=True,
                        parent_id=parent_id
                    )
                    db.add(a)
                    acc_by_num[num] = a
                    added_c += 1
                    
            db.commit()
            print(f"Cliente {cid}: {updated_c} cuentas actualizadas, {added_c} cuentas agregadas. Total cuentas: {len(acc_by_num)}")
            
        print("\n¡Sincronización completada exitosamente!")
    finally:
        db.close()

if __name__ == '__main__':
    sync()
