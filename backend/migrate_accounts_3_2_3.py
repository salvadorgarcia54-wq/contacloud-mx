import sys
sys.path.insert(0, '.')
from database import engine, SessionLocal
from models.account import Account
from sqlalchemy import text

# 1. Add classification column if not exists
with engine.connect() as conn:
    cols = [c[1] for c in conn.execute(text('PRAGMA table_info(accounts);')).fetchall()]
    if 'classification' not in cols:
        conn.execute(text("ALTER TABLE accounts ADD COLUMN classification VARCHAR(20) DEFAULT 'Acumulación';"))
        conn.commit()
        print('Column classification added!')
    else:
        print('Column classification already exists.')

# 2. Helper to format to 3-2-3 (XXX-XX-XXX)
def format_3_2_3(acc_num, sat_code, level):
    acc_num = str(acc_num or '').strip()
    sat_code = str(sat_code or '').strip()
    
    # Try SAT code first for exact standard mapping
    if sat_code:
        parts = sat_code.split('.')
        seg1 = parts[0].zfill(3)[:3]
        seg2 = parts[1].zfill(2)[:2] if len(parts) > 1 else '00'
        
        # Check if acc_num has explicit 3rd segment
        if '-' in acc_num:
            sub = acc_num.split('-')[-1].strip()
            digits = ''.join(filter(str.isdigit, sub))
            if digits and digits not in ('0', '00', '000', '001', '1'):
                seg3 = digits.zfill(3)[:3]
            elif digits and (sub == '001' or sub == '1') and level >= 3:
                seg3 = digits.zfill(3)[:3]
            else:
                seg3 = '000'
        else:
            seg3 = '000'
        return f'{seg1}-{seg2}-{seg3}'

    digits = ''.join(filter(str.isdigit, acc_num))
    if len(digits) >= 8:
        return f'{digits[:3]}-{digits[3:5]}-{digits[5:8]}'
    elif len(digits) <= 3:
        return f'{digits.zfill(3)}-00-000'
    elif len(digits) <= 5:
        return f'{digits[:3]}-{digits[3:].zfill(2)}-000'
    else:
        return f'{digits[:3]}-{digits[3:5].zfill(2)}-{digits[5:].zfill(3)[:3]}'

db = SessionLocal()
accs = db.query(Account).all()
updated = 0
for a in accs:
    new_num = format_3_2_3(a.account_number, a.sat_group_code, a.level)
    a.account_number = new_num
    a.classification = 'Acumulación'
    updated += 1

db.commit()
print(f'Successfully updated {updated} accounts to XXX-XX-XXX structure and classification=Acumulación!')

# Print sample
print('--- Sample Updated Accounts ---')
for a in db.query(Account).filter(Account.client_id == 1).order_by(Account.account_number.asc()).limit(20).all():
    print(f'{a.account_number} | {a.name[:35]:35} | SAT: {a.sat_group_code:6} | {a.classification:12} | Activa: {a.is_active}')

db.close()
