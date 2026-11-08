import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from database import SessionLocal
from models.account import Account

db = SessionLocal()
accs5 = db.query(Account).filter(Account.client_id == 5).all()
active_nums = sorted([a.account_number for a in accs5 if a.is_active])
inactive_nums = sorted([a.account_number for a in accs5 if not a.is_active])

print('Active count:', len(active_nums))
print('Inactive count:', len(inactive_nums))

output_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'seed', 'default_accounts_template.py')
with open(output_path, 'w', encoding='utf-8') as f:
    f.write('# Template of default active/inactive accounts based on Gabriela Velasquez Moreno (Client 5)\n')
    f.write(f'# Generated with {len(active_nums)} active accounts and {len(inactive_nums)} inactive accounts\n\n')
    f.write('DEFAULT_ACTIVE_ACCOUNT_NUMBERS = set([\n')
    for num in active_nums:
        f.write(f'    "{num}",\n')
    f.write('])\n\n')
    f.write('DEFAULT_INACTIVE_ACCOUNT_NUMBERS = set([\n')
    for num in inactive_nums:
        f.write(f'    "{num}",\n')
    f.write('])\n\n')
    f.write('def is_default_active(account_number: str) -> bool:\n')
    f.write('    return account_number in DEFAULT_ACTIVE_ACCOUNT_NUMBERS\n')

print('Generated seed/default_accounts_template.py successfully at', output_path)
