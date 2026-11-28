"""Run against a disposable PostgreSQL container with the casino schema installed.

    python3 tools/test-case-battles-postgres.py CONTAINER_NAME
"""
import json
import subprocess
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor

container = sys.argv[1]


def sql(query):
    result = subprocess.run(['docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1'], input=query, text=True, capture_output=True, check=True)
    return result.stdout.strip()


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def rpc(name, *args):
    return json.loads(sql('select public.' + name + '(' + ','.join(quote(arg) for arg in args) + ');'))


suffix = uuid.uuid4().hex[:6]
accounts = [rpc('cc_signup', name + suffix, 'qa-case-battles-123') for name in ['Host', 'Guest', 'Third']]
assert all(account['ok'] for account in accounts), accounts
tokens = [account['token'] for account in accounts]
host, guest, third = tokens
cases = '{after-hours,neon-vault,high-roller}'
assert rpc('cc_cases_list', 'invalid')['error'] == 'auth'
cancel_id = str(uuid.uuid4())
assert rpc('cc_cases_create', host, cancel_id, cases, 'private')['balance'] == 950
assert rpc('cc_cases_create', host, cancel_id, cases, 'private')['balance'] == 950
assert not rpc('cc_cases_list', guest)['rooms']
assert rpc('cc_cases_cancel', guest, cancel_id)['error'] == 'battle_missing'
assert rpc('cc_cases_cancel', host, cancel_id)['balance'] == 1000
assert rpc('cc_cases_cancel', host, cancel_id)['balance'] == 1000

expired = str(uuid.uuid4())
rpc('cc_cases_create', host, expired, cases, 'public')
sql('update cc.case_battles set expires_at = clock_timestamp() - interval \'1 second\' where id=' + quote(expired) + ';')
assert rpc('cc_cases_list', host)['balance'] == 1000
assert rpc('cc_cases_join', guest, expired)['error'] == 'battle_full'

battle_id = str(uuid.uuid4())
created = rpc('cc_cases_create', host, battle_id, cases, 'public')
assert created['battle']['pulls'] == [None,None,None]
assert len(rpc('cc_cases_list', guest)['rooms']) >= 1
with ThreadPoolExecutor(max_workers=2) as pool:
    joined = list(pool.map(lambda token: rpc('cc_cases_join', token, battle_id), [guest,third]))
assert sum(result['ok'] for result in joined) == 1, joined
winning_join = 0 if joined[0]['ok'] else 1
join_token = [guest,third][winning_join]
other_token = [guest,third][1-winning_join]
assert rpc('cc_me', other_token)['balance'] == 1000
assert rpc('cc_cases_join', join_token, battle_id)['balance'] == 950
assert rpc('cc_cases_join', host, battle_id)['balance'] == 950
assert rpc('cc_cases_cancel', host, battle_id)['error'] == 'battle_started'
assert rpc('cc_cases_create', join_token, str(uuid.uuid4()), cases, 'bot')['error'] == 'battle_active'
assert rpc('cc_cases_get', host, battle_id)['battle']['pulls'] == [None,None,None]
sql('update cc.case_battles set started_at=clock_timestamp()-interval \'1 second\' where id=' + quote(battle_id) + ';')
visible = rpc('cc_cases_get', join_token, battle_id)['battle']['pulls']
assert visible[0] is not None and visible[1:] == [None,None]
sql('update cc.case_battles set started_at=clock_timestamp()-interval \'30 seconds\', pulls=\'[[5,0],[4,0],[3,0]]\'::jsonb where id=' + quote(battle_id) + ';')
with ThreadPoolExecutor(max_workers=4) as pool:
    results = list(pool.map(lambda token: rpc('cc_cases_get', token, battle_id), [host,join_token,host,join_token]))
assert all(result['ok'] and result['battle']['state'] == 'complete' for result in results)
assert rpc('cc_me', host)['balance'] == 1050
assert rpc('cc_me', join_token)['balance'] == 950
assert rpc('cc_me', host)['stats']['games']['cases']['bets'] == 1
assert sum(rpc('cc_me', token)['balance'] for token in tokens) == 3000

tie_id = str(uuid.uuid4())
rpc('cc_cases_create', host, tie_id, cases, 'private')
rpc('cc_cases_join', join_token, tie_id)
sql('update cc.case_battles set started_at=clock_timestamp()-interval \'30 seconds\', pulls=\'[[0,0],[1,1],[2,2]]\'::jsonb where id=' + quote(tie_id) + ';')
assert rpc('cc_cases_get', host, tie_id)['battle']['payout'] == 50
assert rpc('cc_cases_get', join_token, tie_id)['battle']['payout'] == 50
assert rpc('cc_cases_get', other_token, tie_id)['error'] == 'battle_missing'
assert rpc('cc_me', host)['balance'] == 1050
assert rpc('cc_me', join_token)['balance'] == 950
assert sum(rpc('cc_me', token)['balance'] for token in tokens) == 3000
print('PostgreSQL case battles passed concurrent joins, concurrent settlement, retries, privacy, hidden future pulls, cancellation, expiry, ties, conserved balances and account history.')
