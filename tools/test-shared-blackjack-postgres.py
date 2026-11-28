"""Shared Blackjack decisions and overlapping polling, on a disposable Docker DB only."""
import json
import subprocess
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

container = sys.argv[1]
command = ['docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1']


def sql(query):
    r = subprocess.run(command, input=query, text=True, capture_output=True, check=True)
    return r.stdout.strip()


def quote(value):
    return 'NULL' if value is None else "'" + str(value).replace("'", "''") + "'"


def call(name, *args):
    return 'select public.' + name + '(' + ','.join(map(quote, args)) + ');'


def rpc(name, *args):
    return json.loads(sql('set role anon; ' + call(name, *args)))


suffix = uuid.uuid4().hex[:6]
accounts = [rpc('cc_signup', name + suffix, 'table-regression-123') for name in ['BJHost', 'BJGuest']]
assert all(a['ok'] for a in accounts)
host, guest = [a['token'] for a in accounts]
# An isolated table ensures other test players cannot enter this fixture.
table_id = sql("insert into cc.bjm_tables(name) values ('QA decisions') returning id;")
rpc('cc_bjm_join', host, table_id)
rpc('cc_bjm_join', guest, table_id)


def deal(draw_order):
    sql('update cc.bjm_tables set shoe=ARRAY[' + ','.join(map(quote, reversed(draw_order))) + '],cut=0 where id=' + quote(table_id) + ';')
    assert rpc('cc_bjm_bet', host, table_id, 10)['ok']
    r = rpc('cc_bjm_bet', guest, table_id, 10)
    assert r['ok'] and r['table']['phase'] == 'playing'
    return r


try:
    # Host splits 8s, doubles the first hand, hits and stands on the second;
    # guest doubles 11. Dealer draws to 21, paying both pushes exactly once.
    deal(['8S', '5S', '6S', '8H', '6H', '10H', '3D', '2D', '10C', '7C', '10D', '5H'])
    assert rpc('cc_bjm_act', guest, table_id, 'hit')['error'] == 'not_your_turn'
    split = rpc('cc_bjm_act', host, table_id, 'split')
    assert len(split['table']['seats'][0]['hands']) == 2
    doubled = rpc('cc_bjm_act', host, table_id, 'double')
    assert doubled['table']['seats'][0]['hands'][0]['total'] == 21
    assert doubled['table']['seats'][0]['wagered'] == 30
    assert rpc('cc_bjm_act', host, table_id, 'hit')['table']['seats'][0]['hands'][1]['total'] == 17
    assert rpc('cc_bjm_act', host, table_id, 'stand')['table']['turn'] == 1
    done = rpc('cc_bjm_act', guest, table_id, 'double')
    assert done['table']['phase'] == 'done'
    assert [s['payout'] for s in done['table']['seats'][:2]] == [20, 20]
    assert [rpc('cc_me', t)['balance'] for t in (host, guest)] == [990, 1000]
    assert rpc('cc_bjm_act', guest, table_id, 'double')['error'] == 'not_your_turn'
    assert [rpc('cc_me', t)['balance'] for t in (host, guest)] == [990, 1000]
    print('PASS: split, double, hit, stand, dealer draw, pushes, independent bets and repeated action rejection.', flush=True)

    sql("update cc.bjm_tables set deadline=clock_timestamp()-interval '1 second' where id=" + quote(table_id) + ';')
    rpc('cc_bjm_state', host, table_id)
    deal(['10S', '9S', '6S', '7H', '7C', '10D', '5D'])
    # Pause a real guest poll after its seat update. A host stand advances to
    # that same guest while polling is in progress. Table-first locking must
    # serialize this everyday overlap rather than deadlocking the two clients.
    sql("""
      create or replace function cc.qa_slow_poll() returns trigger language plpgsql as $$
      begin
        if current_setting('application_name') = 'qa_shared_poll' then perform pg_sleep(0.8); end if;
        return new;
      end $$;
      create trigger qa_slow_poll after update on cc.bjm_seats for each row execute function cc.qa_slow_poll();
    """)
    poll = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    poll.stdin.write("set application_name='qa_shared_poll'; set statement_timeout='5s'; set role anon; " + call('cc_bjm_state', guest, table_id))
    poll.stdin.close()
    for _ in range(80):
        if sql("select exists(select 1 from pg_stat_activity where application_name='qa_shared_poll' and wait_event='PgSleep');") == 't':
            break
        time.sleep(.025)
    else:
        raise AssertionError('Guest poll did not reach the overlap fixture')
    stood = rpc('cc_bjm_act', host, table_id, 'stand')
    poll.wait(timeout=10)
    stderr = poll.stderr.read()
    assert poll.returncode == 0, stderr
    assert json.loads(poll.stdout.read())['ok']
    assert stood['ok'] and stood['table']['turn'] == 1
    assert rpc('cc_bjm_act', guest, table_id, 'stand')['table']['phase'] == 'done'
    print('PASS: a concurrent guest poll and host stand complete without deadlock or lost turn.')
    new_player = rpc('cc_signup', 'BJTab' + suffix, 'table-regression-123')['token']
    with ThreadPoolExecutor(max_workers=2) as pool:
        joins = list(pool.map(lambda _: rpc('cc_bjm_join', new_player, table_id), range(2)))
    assert all(r['ok'] for r in joins)
    assert joins[0]['table']['me'] == joins[1]['table']['me'] == 2
    assert sum(s is not None for s in joins[1]['table']['seats']) == 3
    rpc('cc_bjm_leave', new_player, table_id)
    sql("update cc.bjm_tables set deadline=clock_timestamp()-interval '1 second' where id=" + quote(table_id) + ';')
    rpc('cc_bjm_state', host, table_id)
    deal(['10S', '9S', '6S', '7H', '7C', '10D', '5D'])
    assert rpc('cc_bjm_leave', host, table_id)['ok']
    assert rpc('cc_bjm_lobby', host)['mine'] is None
    assert rpc('cc_bjm_state', guest, table_id)['table']['turn'] == 1
    assert rpc('cc_bjm_leave', guest, table_id)['ok']
    assert sql('select phase from cc.bjm_tables where id=' + quote(table_id) + ';') == 'done'
    print('PASS: simultaneous joins use one seat; both players leaving mid-hand still settles the dealer and wagers.')
finally:
    sql('drop trigger if exists qa_slow_poll on cc.bjm_seats; drop function if exists cc.qa_slow_poll();')
