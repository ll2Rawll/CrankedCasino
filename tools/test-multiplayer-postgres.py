"""Validate multiplayer against a disposable database, never a production project.

Load supabase/schema.sql, then: python3 tools/test-multiplayer-postgres.py CONTAINER
"""
import json
import subprocess
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

container = sys.argv[1]


def sql(query):
    result = subprocess.run(
        ['docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1'],
        input=query, text=True, capture_output=True, check=True)
    return result.stdout.strip()


def quote(value):
    if value is None:
        return 'NULL'
    if isinstance(value, (dict, list)):
        value = json.dumps(value)
    return "'" + str(value).replace("'", "''") + "'"


def rpc(name, *args):
    # Use exactly the public API role the browser uses, not the database owner.
    return json.loads(sql('set role anon; select public.' + name + '(' + ','.join(map(quote, args)) + ');'))


def balance(token):
    return Decimal(str(rpc('cc_me', token)['balance']))


suffix = uuid.uuid4().hex[:6]
accounts = [rpc('cc_signup', name + suffix, 'multiplayer-qa-123') for name in ['Host', 'Guest', 'Third']]
assert all(a['ok'] for a in accounts), accounts
host, guest, third = [a['token'] for a in accounts]
empty_flight = {'start': 0, 'flaps': [], 'frames': 0}
empty_rooster = {'moves': [], 'end_ms': 0}
missing = str(uuid.uuid4())
signatures = {
    'cc_duel_create': ['flight', 10], 'cc_duel_join': [missing, 10],
    'cc_duel_finish': [missing, empty_flight], 'cc_duel_get': [missing],
    'cc_duel_list': ['flight'], 'cc_bjm_lobby': [], 'cc_bjm_join': [None],
    'cc_bjm_state': [missing], 'cc_bjm_bet': [missing, 10],
    'cc_bjm_act': [missing, 'stand'], 'cc_bjm_leave': [missing],
}
for name, args in signatures.items():
    assert rpc(name, 'invalid', *args)['error'] == 'auth', name
assert sql("select has_schema_privilege('anon','cc','usage');") == 'f'
assert sql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='cc' and c.relname in ('duels','bjm_tables','bjm_seats') and c.relrowsecurity;") == '3'
for invalid in ['0', '-1', '.001', 'NaN', 'Infinity', '1000000000001']:
    assert rpc('cc_duel_create', host, 'flight', invalid)['error'] == 'bad_bet'
assert rpc('cc_duel_create', host, 'flight', 999999)['error'] == 'funds'
assert rpc('cc_duel_create', host, 'unknown', 10)['error'] == 'bad_game'

for game, empty in [('flight', empty_flight), ('rooster', empty_rooster)]:
    created = rpc('cc_duel_create', host, game, '12.50')
    assert created['ok'] and balance(host) == Decimal('987.50'), created
    duel_id = created['duel']['id']
    seed = created['duel']['seed']
    assert rpc('cc_duel_get', third, duel_id)['error'] == 'duel_missing'
    assert rpc('cc_duel_finish', host, duel_id, empty)['duel']['state'] == 'open'
    public = next(d for d in rpc('cc_duel_list', guest, game)['open'] if d['id'] == duel_id)
    assert public['seed'] is None and public['host_score'] is None
    assert rpc('cc_duel_finish', third, duel_id, empty)['error'] == 'duel_missing'
    assert rpc('cc_duel_join', host, duel_id, 10)['error'] == 'duel_own'
    assert rpc('cc_duel_join', guest, duel_id, 999999)['error'] == 'funds'
    with ThreadPoolExecutor(max_workers=2) as pool:
        joined = list(pool.map(lambda t: rpc('cc_duel_join', t, duel_id, '7.25'), [guest, third]))
    assert sum(r['ok'] for r in joined) == 1, joined
    winner = guest if joined[0]['ok'] else third
    rejected = third if winner == guest else guest
    accepted = next(r for r in joined if r['ok'])
    assert accepted['duel']['seed'] == seed and accepted['duel']['host_score'] is None
    assert balance(rejected) == 1000 and balance(winner) == Decimal('992.75')
    retried = rpc('cc_duel_join', winner, duel_id, '99.99')
    assert retried['duel']['guest_bet'] == 7.25 and balance(winner) == Decimal('992.75')
    with ThreadPoolExecutor(max_workers=3) as pool:
        finished = list(pool.map(lambda _: rpc('cc_duel_finish', winner, duel_id, empty), range(3)))
    assert all(r['duel']['state'] == 'done' and r['duel']['payout'] == 7.25 for r in finished)
    assert balance(host) == 1000 and balance(winner) == 1000
    assert rpc('cc_duel_get', rejected, duel_id)['error'] == 'duel_missing'

# Both winner branches use custom stakes. Inject scores only in this disposable DB;
# replay validation is tested separately below, and the live smoke test uses real runs.
for scores, pays in [((9, 1), (Decimal('25'), Decimal('0'))), ((1, 9), (Decimal('0'), Decimal('14.50')))]:
    before = [balance(t) for t in (host, guest)]
    duel_id = rpc('cc_duel_create', host, 'flight', '12.50')['duel']['id']
    rpc('cc_duel_finish', host, duel_id, empty_flight)
    rpc('cc_duel_join', guest, duel_id, '7.25')
    sql(f"update cc.duels set host_score={scores[0]}, guest_score={scores[1]}, guest_started=clock_timestamp()-interval '31 minutes' where id={quote(duel_id)};")
    # Settle through the normal RPC after injecting a valid terminal state.
    sql('select cc.duel_settle(' + quote(duel_id) + ');')
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda t: rpc('cc_duel_finish', t, duel_id, empty_flight), [host, guest, host, guest]))
    for token, original, stake, pay in zip((host, guest), before, (Decimal('12.50'), Decimal('7.25')), pays):
        assert balance(token) == original - stake + pay
        assert Decimal(str(rpc('cc_duel_get', token, duel_id)['duel']['payout'])) == pay

# Expired challenges refund exactly once; unfinished guests settle as a zero score.
before = balance(host)
duel_id = rpc('cc_duel_create', host, 'flight', '15.55')['duel']['id']
sql("update cc.duels set host_started=clock_timestamp()-interval '31 minutes' where id=" + quote(duel_id) + ';')
assert rpc('cc_duel_get', host, duel_id)['duel']['state'] == 'open'
sql("update cc.duels set opened_at=clock_timestamp()-interval '25 hours' where id=" + quote(duel_id) + ';')
for _ in range(2):
    assert rpc('cc_duel_get', host, duel_id)['duel']['state'] == 'expired'
    assert balance(host) == before
duel_id = rpc('cc_duel_create', host, 'flight', 10)['duel']['id']
rpc('cc_duel_finish', host, duel_id, empty_flight)
rpc('cc_duel_join', guest, duel_id, 5)
sql("update cc.duels set guest_started=clock_timestamp()-interval '31 minutes' where id=" + quote(duel_id) + ';')
assert rpc('cc_duel_get', guest, duel_id)['duel']['state'] == 'done'
assert balance(host) == before
for invalid in [{'start': 99, 'flaps': [], 'frames': 1}, {'start': 0, 'flaps': [2, 1], 'frames': 5}, {'start': 0, 'flaps': [], 'frames': 99999}, None]:
    assert sql('select cc.duel_score(\'flight\',123,' + quote(invalid) + ',1000);') == '0'
assert sql("select cc.duel_score('flight',123,'{\"start\":0,\"flaps\":[],\"frames\":45}',1500) = (cc.fl_replay(123,0,'{}',1000000,45)->>'score')::integer;") == 't'

# Two people share a real table, see the same dealer, act in turn and settle once.
# Keep this fixture independent of seats left by another disposable test suite.
table_id = sql("insert into cc.bjm_tables(name,shoe,cut) values ('QA regression',cc.bjm_new_shoe(),60) returning id;")
assert rpc('cc_bjm_join', host, table_id)['table']['me'] == 0
assert rpc('cc_bjm_join', guest, table_id)['table']['me'] == 1
assert rpc('cc_bjm_bet', third, table_id, 10)['error'] == 'not_seated'
before = balance(host)
assert rpc('cc_bjm_bet', host, table_id, '6.25')['ok']
assert balance(host) == before - Decimal('6.25')
assert rpc('cc_bjm_bet', host, table_id, 99)['table']['seats'][0]['bet'] == 6.25
assert rpc('cc_bjm_leave', host, table_id)['ok']
assert balance(host) == before  # refund before dealing
assert rpc('cc_bjm_join', host, table_id)['table']['me'] == 0
rpc('cc_bjm_bet', host, table_id, '6.25')
r = rpc('cc_bjm_bet', guest, table_id, '4.75')
for _ in range(10):
    table = r['table']
    if table['phase'] == 'done':
        break
    assert table['phase'] == 'playing' and table['dealer'][1] == '??', table
    player = host if table['turn'] == 0 else guest
    other = guest if player == host else host
    assert rpc('cc_bjm_act', other, table_id, 'stand')['error'] == 'not_your_turn'
    r = rpc('cc_bjm_act', player, table_id, 'stand')
assert r['table']['phase'] == 'done'
assert '??' not in r['table']['dealer']
paid = [balance(t) for t in (host, guest)]
for token in (host, guest):
    assert rpc('cc_bjm_state', token, table_id)['table']['phase'] == 'done'
assert [balance(t) for t in (host, guest)] == paid
for token in (host, guest):
    rpc('cc_bjm_leave', token, table_id)
sql("update cc.bjm_tables set deadline=clock_timestamp()-interval '1 second' where id=" + quote(table_id) + ';')
assert rpc('cc_bjm_lobby', host)['ok']
print('PASS: all 11 RPCs authenticate; private tables deny access; both games pass concurrent joins, hidden scores, equal courses, custom bets, settlement retries, payouts, refunds and expiry; shared Blackjack passes two-player betting, hidden dealer, turns and settlement.')
