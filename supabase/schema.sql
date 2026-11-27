-- ─────────────────────────────────────────────────────────────────────────────
--  CrankedCasino · casino server (Supabase / Postgres 15+)
--
--  Paste this whole file into Supabase → SQL Editor → New query → Run.
--  Safe to run again: it upgrades in place and never deletes players.
--
--  Every account, balance change and game result lives in here. Players can't
--  edit their chips, reset by clearing their browser, or redeem a promo twice.
--  The website only calls the public.cc_* functions at the bottom.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto with schema extensions;

-- Private schema: not exposed through the Supabase API, so tables can only be
-- touched by the functions below.
create schema if not exists cc;
revoke all on schema cc from public;

-- ───────────────────────────── settings ─────────────────────────────────────
-- Tweak these any time in Table Editor → cc.settings (no redeploy needed).
create table if not exists cc.settings (key text primary key, value numeric not null, note text);
insert into cc.settings (key, value, note) values
  ('start_balance', 1000, 'Chips every new player starts with'),
  ('ad_reward', 250, 'Chips for watching one rewarded ad'),
  ('ad_cooldown_seconds', 120, 'Wait between rewarded ads'),
  ('ad_daily_cap', 20, 'Rewarded ads per player per day (UTC)'),
  ('signups_per_ip_per_day', 4, 'New accounts allowed per network per day'),
  ('login_attempts', 8, 'Wrong passwords before a short lockout'),
  ('lockout_minutes', 10, 'Lockout length after too many wrong passwords')
on conflict (key) do nothing;

-- ───────────────────────────── tables ───────────────────────────────────────
create table if not exists cc.players (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  username_key text not null unique,
  pass_hash text not null,
  balance numeric(20, 2) not null default 0 check (balance >= 0),
  seq bigint not null default 0,
  stats jsonb not null default '{}'::jsonb,
  biggest_win numeric(20, 2) not null default 0,
  bets integer not null default 0,
  ad_day date,
  ad_count integer not null default 0,
  ad_last timestamptz,
  failed_logins integer not null default 0,
  locked_until timestamptz,
  signup_ip text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists players_rank_idx on cc.players (balance desc, updated_at asc);
create index if not exists players_ip_idx on cc.players (signup_ip, created_at);

create table if not exists cc.sessions (
  token_hash bytea primary key,
  player_id uuid not null references cc.players (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_used timestamptz not null default now()
);
create index if not exists sessions_player_idx on cc.sessions (player_id);

create table if not exists cc.bets (
  id bigint generated always as identity primary key,
  player_id uuid not null references cc.players (id) on delete cascade,
  game text not null,
  wager numeric(20, 2) not null,
  payout numeric(20, 2) not null,
  info text,
  created_at timestamptz not null default now()
);
create index if not exists bets_player_idx on cc.bets (player_id, id desc);

create table if not exists cc.promo_codes (code text primary key, chips numeric(20, 2) not null check (chips > 0), active boolean not null default true, note text);
insert into cc.promo_codes (code, chips, note) values ('MAXWIN', 1000, 'MaxWin bonus') on conflict (code) do nothing;
create table if not exists cc.promo_redemptions (
  player_id uuid not null references cc.players (id) on delete cascade,
  code text not null references cc.promo_codes (code),
  created_at timestamptz not null default now(),
  primary key (player_id, code)
);

create table if not exists cc.mines_rounds (
  player_id uuid primary key references cc.players (id) on delete cascade,
  bet numeric(20, 2) not null,
  mines integer not null,
  cells integer[] not null,
  revealed integer[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists cc.crash_rounds (
  player_id uuid primary key references cc.players (id) on delete cascade,
  bet numeric(20, 2) not null,
  auto numeric(12, 2),
  crash_point numeric(12, 2) not null,
  started_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists cc.rooster_runs (
  player_id uuid primary key references cc.players (id) on delete cascade,
  bet numeric(20, 2) not null,
  seed bigint not null,
  started_at timestamptz not null default clock_timestamp()
);

create table if not exists cc.bj_shoes (
  player_id uuid primary key references cc.players (id) on delete cascade,
  cards text[] not null,
  cut integer not null
);
create table if not exists cc.bj_rounds (
  player_id uuid primary key references cc.players (id) on delete cascade,
  base numeric(20, 2) not null,
  wagered numeric(20, 2) not null,
  dealer text[] not null,
  h1 text[] not null,
  h2 text[] not null default '{}',
  b1 numeric(20, 2) not null,
  b2 numeric(20, 2) not null default 0,
  d1 boolean not null default false,
  d2 boolean not null default false,
  x1 boolean not null default false,
  x2 boolean not null default false,
  nhands integer not null default 1,
  active integer not null default 1,
  insurance numeric(20, 2) not null default 0,
  phase text not null,
  revealed boolean not null default false,
  created_at timestamptz not null default now()
);

alter table cc.settings enable row level security;
alter table cc.players enable row level security;
alter table cc.sessions enable row level security;
alter table cc.bets enable row level security;
alter table cc.promo_codes enable row level security;
alter table cc.promo_redemptions enable row level security;
alter table cc.mines_rounds enable row level security;
alter table cc.crash_rounds enable row level security;
alter table cc.bj_shoes enable row level security;
alter table cc.rooster_runs enable row level security;
alter table cc.bj_rounds enable row level security;

-- ───────────────────────────── helpers ──────────────────────────────────────
create or replace function cc.rand() returns double precision language sql volatile set search_path = '' as $$
  select ('x' || encode(extensions.gen_random_bytes(7), 'hex'))::bit(56)::bigint / 72057594037927936.0::double precision
$$;

create or replace function cc.randint(n integer) returns integer language sql volatile set search_path = '' as $$
  select least(n - 1, floor(cc.rand() * n)::integer)
$$;

create or replace function cc.cfg(k text) returns numeric language sql stable set search_path = '' as $$
  select value from cc.settings where key = k
$$;

create or replace function cc.err(code text, extra jsonb default '{}'::jsonb) returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('ok', false, 'error', code) || extra
$$;

create or replace function cc.valid_bet(b numeric) returns boolean language sql immutable set search_path = '' as $$
  select b is not null and b >= 0.01 and b <= 1000000000000 and b = round(b, 2)
$$;

create or replace function cc.client_ip() returns text language plpgsql stable set search_path = '' as $$
declare h jsonb;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return null;
  end;
  if h is null then return null; end if;
  return nullif(btrim(split_part(coalesce(h ->> 'cf-connecting-ip', h ->> 'x-real-ip', h ->> 'x-forwarded-for', ''), ',', 1)), '');
end $$;

create or replace function cc.auth(p_token text) returns uuid language plpgsql volatile set search_path = '' as $$
declare v uuid;
begin
  if p_token is null or length(p_token) < 32 then return null; end if;
  update cc.sessions set last_used = now()
   where token_hash = extensions.digest(p_token, 'sha256') and last_used < now() - interval '1 hour';
  select player_id into v from cc.sessions where token_hash = extensions.digest(p_token, 'sha256');
  return v;
end $$;

create or replace function cc.new_session(pid uuid) returns text language plpgsql volatile set search_path = '' as $$
declare t text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  insert into cc.sessions (token_hash, player_id) values (extensions.digest(t, 'sha256'), pid);
  delete from cc.sessions where player_id = pid and token_hash not in (
    select token_hash from cc.sessions where player_id = pid order by last_used desc limit 10);
  return t;
end $$;

-- Change a balance and bump the version number the website uses to order updates.
create or replace function cc.move(pid uuid, delta numeric) returns cc.players language plpgsql volatile set search_path = '' as $$
declare p cc.players;
begin
  update cc.players set balance = balance + delta, seq = seq + 1, updated_at = now() where id = pid returning * into p;
  return p;
end $$;

-- Record a settled bet: history row + lifetime and per-game stats.
create or replace function cc.record(pid uuid, game text, wager numeric, payout numeric, info text) returns jsonb
language plpgsql volatile set search_path = '' as $$
declare
  st jsonb;
  g jsonb;
  mult numeric := case when wager > 0 then round(payout / wager, 4) else 0 end;
  profit numeric := payout - wager;
  won integer := case when payout > wager then 1 else 0 end;
  t timestamptz := now();
begin
  select stats into st from cc.players where id = pid;
  st := coalesce(st, '{}'::jsonb);
  g := coalesce(st -> 'games' -> game, '{}'::jsonb);
  g := jsonb_build_object(
    'bets', coalesce((g ->> 'bets')::integer, 0) + 1,
    'wins', coalesce((g ->> 'wins')::integer, 0) + won,
    'wagered', round(coalesce((g ->> 'wagered')::numeric, 0) + wager, 2),
    'profit', round(coalesce((g ->> 'profit')::numeric, 0) + profit, 2),
    'bestMulti', greatest(coalesce((g ->> 'bestMulti')::numeric, 0), round(mult, 2)),
    'biggestWin', greatest(coalesce((g ->> 'biggestWin')::numeric, 0), payout));
  st := jsonb_build_object(
    'bets', coalesce((st ->> 'bets')::integer, 0) + 1,
    'wins', coalesce((st ->> 'wins')::integer, 0) + won,
    'wagered', round(coalesce((st ->> 'wagered')::numeric, 0) + wager, 2),
    'profit', round(coalesce((st ->> 'profit')::numeric, 0) + profit, 2),
    'bestMulti', greatest(coalesce((st ->> 'bestMulti')::numeric, 0), round(mult, 2)),
    'biggestWin', greatest(coalesce((st ->> 'biggestWin')::numeric, 0), payout),
    'games', coalesce(st -> 'games', '{}'::jsonb) || jsonb_build_object(game, g));
  update cc.players
     set stats = st, bets = bets + 1, biggest_win = greatest(biggest_win, payout)
   where id = pid;
  insert into cc.bets (player_id, game, wager, payout, info, created_at) values (pid, game, wager, payout, info, t);
  delete from cc.bets where player_id = pid and id < (
    select min(id) from (select id from cc.bets where player_id = pid order by id desc limit 60) recent);
  return jsonb_build_object('g', game, 'a', wager, 'm', mult, 'p', payout, 't', floor(extract(epoch from t) * 1000), 'info', info);
end $$;

create or replace function cc.ads_state(p cc.players) returns jsonb language plpgsql stable set search_path = '' as $$
declare
  used integer := case when p.ad_day = (now() at time zone 'utc')::date then p.ad_count else 0 end;
  wait integer := 0;
begin
  if p.ad_last is not null then
    wait := greatest(0, ceil(cc.cfg('ad_cooldown_seconds') - extract(epoch from (now() - p.ad_last)))::integer);
  end if;
  return jsonb_build_object('reward', cc.cfg('ad_reward'), 'left', greatest(0, cc.cfg('ad_daily_cap')::integer - used), 'wait', wait, 'cooldown', cc.cfg('ad_cooldown_seconds'));
end $$;

-- ───────────────────────────── crash engine ─────────────────────────────────
-- Multiplier after t ms = e^(0.00009·t). Crash point = 0.99 / (1 − U), floored.
create or replace function cc.crash_resolve(pid uuid) returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  r cc.crash_rounds;
  el double precision;
  k constant double precision := 0.00009;
  pay numeric;
  entry jsonb;
  p cc.players;
begin
  select * into r from cc.crash_rounds where player_id = pid for update;
  if not found then return jsonb_build_object('state', 'none'); end if;
  el := extract(epoch from (clock_timestamp() - r.started_at)) * 1000;
  if r.auto is not null and r.auto <= r.crash_point and el >= ln(r.auto::double precision) / k then
    pay := round(r.bet * r.auto, 2);
    entry := cc.record(pid, 'crash', r.bet, pay, 'auto @ ' || to_char(r.auto, 'FM999990.00') || '×');
    p := cc.move(pid, pay);
    delete from cc.crash_rounds where player_id = pid;
    return jsonb_build_object('state', 'cashed', 'mult', r.auto, 'payout', pay, 'crash_point', r.crash_point, 'balance', p.balance, 'seq', p.seq, 'entry', entry);
  end if;
  if el >= ln(r.crash_point::double precision) / k then
    entry := cc.record(pid, 'crash', r.bet, 0, 'crashed @ ' || to_char(r.crash_point, 'FM999990.00') || '×');
    select * into p from cc.players where id = pid;
    delete from cc.crash_rounds where player_id = pid;
    return jsonb_build_object('state', 'crashed', 'crash_point', r.crash_point, 'payout', 0, 'balance', p.balance, 'seq', p.seq, 'entry', entry);
  end if;
  return jsonb_build_object('state', case when el < 0 then 'waiting' else 'running' end, 'elapsed', el,
    'wager', r.bet, 'auto', r.auto, 'started_at', floor(extract(epoch from r.started_at) * 1000));
end $$;

-- ───────────────────────────── blackjack engine ─────────────────────────────
create or replace function cc.bj_val(c text) returns integer language sql immutable set search_path = '' as $$
  select case left(c, length(c) - 1) when 'A' then 11 when 'K' then 10 when 'Q' then 10 when 'J' then 10 else left(c, length(c) - 1)::integer end
$$;

-- Best total and whether an ace still counts as 11: returns {total, soft(0/1)}.
create or replace function cc.bj_total(cards text[]) returns integer[] language plpgsql immutable set search_path = '' as $$
declare t integer := 0; a integer := 0; c text;
begin
  foreach c in array coalesce(cards, '{}') loop
    t := t + cc.bj_val(c);
    if left(c, length(c) - 1) = 'A' then a := a + 1; end if;
  end loop;
  while t > 21 and a > 0 loop t := t - 10; a := a - 1; end loop;
  return array[t, case when a > 0 then 1 else 0 end];
end $$;

create or replace function cc.bj_is_bj(cards text[]) returns boolean language sql immutable set search_path = '' as $$
  select coalesce(array_length(cards, 1), 0) = 2 and (cc.bj_total(cards))[1] = 21
$$;

create or replace function cc.bj_shuffle(pid uuid) returns void language plpgsql volatile set search_path = '' as $$
declare deck text[];
begin
  select array_agg(c order by cc.rand()) into deck from (
    select r || s as c from unnest(array['A','2','3','4','5','6','7','8','9','10','J','Q','K']) r,
                            unnest(array['S','H','D','C']) s, generate_series(1, 6) d) x;
  insert into cc.bj_shoes (player_id, cards, cut) values (pid, deck, floor(312 * (0.2 + cc.randint(1000) / 10000.0))::integer)
  on conflict (player_id) do update set cards = excluded.cards, cut = excluded.cut;
end $$;

create or replace function cc.bj_draw(pid uuid) returns text language plpgsql volatile set search_path = '' as $$
declare arr text[]; n integer; c text;
begin
  select cards into arr from cc.bj_shoes where player_id = pid for update;
  n := coalesce(array_length(arr, 1), 0);
  if n = 0 then
    perform cc.bj_shuffle(pid);
    select cards into arr from cc.bj_shoes where player_id = pid;
    n := array_length(arr, 1);
  end if;
  c := arr[n];
  update cc.bj_shoes set cards = arr[1:n - 1] where player_id = pid;
  return c;
end $$;

-- What the player is allowed to see and do.
create or replace function cc.bj_view(r cc.bj_rounds, ev jsonb, extra jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  hands jsonb := '[]'::jsonb;
  dealer jsonb;
  t1 integer[] := cc.bj_total(r.h1);
  t2 integer[] := cc.bj_total(r.h2);
  cur text[];
  cur_bet numeric;
  ct integer;
  bal numeric;
  can jsonb := jsonb_build_object('hit', false, 'stand', false, 'double', false, 'split', false);
  left_cards integer;
begin
  select balance into bal from cc.players where id = r.player_id;
  select coalesce(array_length(cards, 1), 0) into left_cards from cc.bj_shoes where player_id = r.player_id;
  hands := hands || jsonb_build_object('cards', to_jsonb(r.h1), 'bet', r.b1, 'total', t1[1], 'soft', t1[2] = 1, 'done', r.d1, 'doubled', r.x1);
  if r.nhands = 2 then
    hands := hands || jsonb_build_object('cards', to_jsonb(r.h2), 'bet', r.b2, 'total', t2[1], 'soft', t2[2] = 1, 'done', r.d2, 'doubled', r.x2);
  end if;
  if r.revealed then dealer := to_jsonb(r.dealer); else dealer := jsonb_build_array(r.dealer[1], '??'); end if;
  if r.phase = 'player' then
    cur := case when r.active = 1 then r.h1 else r.h2 end;
    cur_bet := case when r.active = 1 then r.b1 else r.b2 end;
    ct := (cc.bj_total(cur))[1];
    can := jsonb_build_object(
      'hit', ct < 21,
      'stand', true,
      'double', array_length(cur, 1) = 2 and ct < 21 and bal >= cur_bet,
      'split', r.nhands = 1 and array_length(cur, 1) = 2 and cc.bj_val(cur[1]) = cc.bj_val(cur[2]) and bal >= cur_bet);
  end if;
  return jsonb_build_object(
    'ok', true, 'phase', r.phase, 'dealer', dealer,
    'dealer_total', case when r.revealed then (cc.bj_total(r.dealer))[1] else cc.bj_val(r.dealer[1]) end,
    'hands', hands, 'active', r.active, 'base', r.base, 'wagered', r.wagered, 'insurance', r.insurance, 'can', can,
    'events', coalesce(ev, '[]'::jsonb), 'decks_left', round(left_cards / 52.0, 1)) || extra;
end $$;

create or replace function cc.bj_settle(pid uuid, ev jsonb) returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  r cc.bj_rounds;
  d integer;
  dbj boolean;
  total numeric := 0;
  results jsonb := '[]'::jsonb;
  i integer;
  cards text[];
  bet numeric;
  v integer;
  is_nat boolean;
  pay numeric;
  label text;
  cls text;
  entry jsonb;
  p cc.players;
  info text;
begin
  select * into r from cc.bj_rounds where player_id = pid for update;
  if not r.revealed then
    ev := ev || jsonb_build_array(jsonb_build_object('t', 'reveal', 'c', r.dealer[2]));
    r.revealed := true;
  end if;
  d := (cc.bj_total(r.dealer))[1];
  dbj := cc.bj_is_bj(r.dealer);
  for i in 1..r.nhands loop
    cards := case when i = 1 then r.h1 else r.h2 end;
    bet := case when i = 1 then r.b1 else r.b2 end;
    v := (cc.bj_total(cards))[1];
    is_nat := r.nhands = 1 and cc.bj_is_bj(cards);
    pay := 0;
    if is_nat and not dbj then pay := bet * 2.5; label := 'Blackjack +' || to_char(bet * 1.5, 'FM999999999990.00'); cls := 'bj';
    elsif is_nat and dbj then pay := bet; label := 'Push'; cls := 'push';
    elsif v > 21 then label := 'Bust'; cls := 'loss';
    elsif dbj then label := 'Lose'; cls := 'loss';
    elsif d > 21 or v > d then
      pay := bet * 2; cls := 'win';
      label := case when d > 21 then 'Dealer busts +' else 'Win +' end || to_char(bet, 'FM999999999990.00');
    elsif v = d then pay := bet; label := 'Push'; cls := 'push';
    else label := 'Lose'; cls := 'loss';
    end if;
    pay := round(pay, 2);
    total := total + pay;
    results := results || jsonb_build_object('label', label, 'cls', cls, 'pay', pay, 'bet', bet);
  end loop;
  if r.insurance > 0 and dbj then total := total + r.insurance * 3; end if;
  total := round(total, 2);
  info := case when r.nhands > 1 then 'split · ' else '' end || 'dealer ' || case when dbj then 'BJ' when d > 21 then 'bust' else d::text end;
  entry := cc.record(pid, 'blackjack', r.wagered, total, info);
  p := cc.move(pid, total);
  r.phase := 'done';
  delete from cc.bj_rounds where player_id = pid;
  return cc.bj_view(r, ev, jsonb_build_object('results', results, 'payout', total, 'wagered', r.wagered,
    'dealer_bj', dbj, 'insurance_paid', r.insurance > 0 and dbj, 'balance', p.balance, 'seq', p.seq, 'entry', entry));
end $$;

-- Dealer peek (ace or ten up) and naturals, after the insurance question.
create or replace function cc.bj_after_insurance(pid uuid, ev jsonb) returns jsonb language plpgsql volatile set search_path = '' as $$
declare r cc.bj_rounds; up integer;
begin
  select * into r from cc.bj_rounds where player_id = pid for update;
  up := cc.bj_val(r.dealer[1]);
  if up >= 10 then
    ev := ev || jsonb_build_array(jsonb_build_object('t', 'peek'));
    if cc.bj_is_bj(r.dealer) then return cc.bj_settle(pid, ev); end if;
  end if;
  if cc.bj_is_bj(r.h1) then return cc.bj_settle(pid, ev); end if;
  update cc.bj_rounds set phase = 'player' where player_id = pid returning * into r;
  return cc.bj_view(r, ev, jsonb_build_object('balance', (select balance from cc.players where id = pid), 'seq', (select seq from cc.players where id = pid)));
end $$;

create or replace function cc.bj_dealer_turn(pid uuid, ev jsonb) returns jsonb language plpgsql volatile set search_path = '' as $$
declare r cc.bj_rounds; c text;
begin
  select * into r from cc.bj_rounds where player_id = pid for update;
  ev := ev || jsonb_build_array(jsonb_build_object('t', 'reveal', 'c', r.dealer[2]));
  update cc.bj_rounds set revealed = true, phase = 'dealer' where player_id = pid returning * into r;
  if (cc.bj_total(r.h1))[1] <= 21 or (r.nhands = 2 and (cc.bj_total(r.h2))[1] <= 21) then
    while (cc.bj_total(r.dealer))[1] < 17 loop
      c := cc.bj_draw(pid);
      update cc.bj_rounds set dealer = dealer || c where player_id = pid returning * into r;
      ev := ev || jsonb_build_array(jsonb_build_object('t', 'd', 'c', c));
    end loop;
  end if;
  return cc.bj_settle(pid, ev);
end $$;

-- ───────────────────────────── game tables ──────────────────────────────────
create or replace function cc.plinko_table(risk text, nrows integer) returns jsonb language sql immutable set search_path = '' as $$
  select ('{
  "low": {"8":[5.6,2.8,1.3,0.8,0.5,0.8,1.3,2.8,5.6],"9":[6.8,3.4,1.8,0.9,0.6,0.6,0.9,1.8,3.4,6.8],"10":[7.4,4.2,2.3,1.2,0.7,0.5,0.7,1.2,2.3,4.2,7.4],"11":[8.4,4.7,2.7,1.4,0.9,0.6,0.6,0.9,1.4,2.7,4.7,8.4],"12":[9,5.5,3.1,1.9,1.1,0.7,0.5,0.7,1.1,1.9,3.1,5.5,9],"13":[11,6.2,3.7,2.4,1.3,0.8,0.6,0.6,0.8,1.3,2.4,3.7,6.2,11],"14":[12,7.5,4.2,2.6,1.7,1,0.7,0.5,0.7,1,1.7,2.6,4.2,7.5,12],"15":[14,8.8,5.3,3.2,1.9,1.2,0.8,0.6,0.6,0.8,1.2,1.9,3.2,5.3,8.8,14],"16":[16,9.6,6,3.6,2.3,1.4,1,0.7,0.5,0.7,1,1.4,2.3,3.6,6,9.6,16]},
  "medium": {"8":[13,3.7,1.3,0.6,0.4,0.6,1.3,3.7,13],"9":[17,5.6,1.9,0.8,0.4,0.4,0.8,1.9,5.6,17],"10":[22,7.1,2.8,1.1,0.5,0.4,0.5,1.1,2.8,7.1,22],"11":[29,10,3.8,1.5,0.7,0.4,0.4,0.7,1.5,3.8,10,29],"12":[38,13,4.9,2.2,0.9,0.5,0.4,0.5,0.9,2.2,4.9,13,38],"13":[49,18,7.1,2.9,1.3,0.6,0.4,0.4,0.6,1.3,2.9,7.1,18,49],"14":[64,24,9.2,3.8,1.7,0.8,0.5,0.4,0.5,0.8,1.7,3.8,9.2,24,64],"15":[84,32,12,5.2,2.3,1.1,0.6,0.4,0.4,0.6,1.1,2.3,5.2,12,32,84],"16":[110,43,17,7.4,3.3,1.5,0.8,0.4,0.3,0.4,0.8,1.5,3.3,7.4,17,43,110]},
  "high": {"8":[29,4.7,1.1,0.4,0.2,0.4,1.1,4.7,29],"9":[45,8.1,1.9,0.5,0.2,0.2,0.5,1.9,8.1,45],"10":[70,12,2.9,0.8,0.3,0.2,0.3,0.8,2.9,12,70],"11":[110,20,4.4,1.3,0.4,0.2,0.2,0.4,1.3,4.4,20,110],"12":[170,31,7,1.8,0.6,0.3,0.2,0.3,0.6,1.8,7,31,170],"13":[270,48,11,2.8,0.9,0.4,0.2,0.2,0.4,0.9,2.8,11,48,270],"14":[410,75,16,4.2,1.4,0.5,0.3,0.2,0.3,0.5,1.4,4.2,16,75,410],"15":[640,120,25,6.7,2,0.7,0.4,0.2,0.2,0.4,0.7,2,6.7,25,120,640],"16":[1000,180,39,9.8,2.9,1,0.5,0.3,0.2,0.3,0.5,1,2.9,9.8,39,180,1000]}
  }'::jsonb) -> risk -> nrows::text
$$;

create or replace function cc.roulette_mult(k text, n integer) returns integer language sql immutable set search_path = '' as $$
  select case
    when k like 'n:%' then case when substr(k, 3)::integer = n then 36 else 0 end
    when k = 'red' then case when n = any (array[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]) then 2 else 0 end
    when k = 'black' then case when n > 0 and not n = any (array[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]) then 2 else 0 end
    when k = 'odd' then case when n % 2 = 1 then 2 else 0 end
    when k = 'even' then case when n > 0 and n % 2 = 0 then 2 else 0 end
    when k = 'low' then case when n between 1 and 18 then 2 else 0 end
    when k = 'high' then case when n between 19 and 36 then 2 else 0 end
    when k like 'dozen:%' then case when n > 0 and (n - 1) / 12 + 1 = substr(k, 7)::integer then 3 else 0 end
    when k = 'col:1' then case when n > 0 and n % 3 = 1 then 3 else 0 end
    when k = 'col:2' then case when n > 0 and n % 3 = 2 then 3 else 0 end
    when k = 'col:3' then case when n > 0 and n % 3 = 0 then 3 else 0 end
    else 0 end
$$;

-- Slots: 9 symbols (0 cherry … 6 seven, 7 wild, 8 scatter), 5 reels × 3 rows, 10 lines.
create or replace function cc.slot_grid() returns integer[] language plpgsql volatile set search_path = '' as $$
declare
  w numeric[] := array[19, 18, 16, 12, 9, 6, 4, 4.2, 2.5];
  g integer[] := '{}';
  r numeric;
  s integer;
begin
  for i in 1..15 loop
    r := cc.rand() * 90.7;
    s := 8;
    for j in 1..9 loop
      r := r - w[j];
      if r < 0 then s := j - 1; exit; end if;
    end loop;
    g := g || s;
  end loop;
  return g;
end $$;

-- Returns {total, fs} for one grid (cell index = reel*3 + row + 1).
create or replace function cc.slot_eval(g integer[], bet numeric, mult integer) returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  lines integer[] := array[
    [1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2],
    [0,0,1,2,2],[2,2,1,0,0],[1,0,0,0,1],[1,2,2,2,1],[1,0,1,2,1]];
  pays integer[] := array[[6,20,50],[7,20,60],[8,25,80],[12,40,125],[20,60,200],[30,100,400],[50,200,750],[80,300,1500]];
  total numeric := 0;
  syms integer[];
  tg integer;
  cnt integer;
  wr integer;
  s integer;
  pt integer;
  pw integer;
  sc integer := 0;
  n integer;
begin
  for li in 1..10 loop
    syms := array[g[0 * 3 + lines[li][1] + 1], g[1 * 3 + lines[li][2] + 1], g[2 * 3 + lines[li][3] + 1], g[3 * 3 + lines[li][4] + 1], g[4 * 3 + lines[li][5] + 1]];
    tg := -1; cnt := 0;
    for i in 1..5 loop
      s := syms[i];
      exit when s = 8;
      if s = 7 then cnt := cnt + 1; continue; end if;
      if tg < 0 then tg := s; cnt := cnt + 1; continue; end if;
      if s = tg then cnt := cnt + 1; continue; end if;
      exit;
    end loop;
    wr := 0;
    while wr < 5 and syms[wr + 1] = 7 loop wr := wr + 1; end loop;
    pt := case when tg >= 0 and cnt >= 3 then pays[tg + 1][cnt - 2] else 0 end;
    pw := case when wr >= 3 then pays[8][wr - 2] else 0 end;
    if greatest(pt, pw) > 0 then total := total + round(greatest(pt, pw) * (bet / 10) * mult, 2); end if;
  end loop;
  for i in 1..15 loop if g[i] = 8 then sc := sc + 1; end if; end loop;
  n := least(sc, 5);
  if n >= 3 then total := total + round((case n when 3 then 2 when 4 then 10 else 50 end) * bet * mult, 2); end if;
  return jsonb_build_object('total', round(total, 2), 'fs', case when n = 3 then 8 when n = 4 then 12 when n >= 5 then 20 else 0 end);
end $$;

-- ═════════════════════════════ public API ═══════════════════════════════════
-- Everything below is what the website calls. All take the player's session
-- token and return JSON: { ok: true, ... } or { ok: false, error: "code" }.

create or replace function public.cc_signup(p_username text, p_password text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_name text := btrim(coalesce(p_username, ''));
  ip text := cc.client_ip();
  pid uuid;
  tok text;
begin
  if v_name !~ '^[A-Za-z0-9_]{3,16}$' then return cc.err('bad_username'); end if;
  if length(coalesce(p_password, '')) < 6 or length(p_password) > 72 then return cc.err('bad_password'); end if;
  if exists (select 1 from cc.players where username_key = lower(v_name)) then return cc.err('taken'); end if;
  if ip is not null and (select count(*) from cc.players where signup_ip = ip and created_at > now() - interval '1 day') >= cc.cfg('signups_per_ip_per_day') then
    return cc.err('too_many_signups');
  end if;
  begin
    insert into cc.players (username, username_key, pass_hash, balance, signup_ip)
    values (v_name, lower(v_name), extensions.crypt(p_password, extensions.gen_salt('bf', 8)), cc.cfg('start_balance'), ip)
    returning id into pid;
  exception when unique_violation then
    return cc.err('taken');
  end;
  tok := cc.new_session(pid);
  return jsonb_build_object('ok', true, 'token', tok, 'me', public.cc_me(tok));
end $$;

create or replace function public.cc_login(p_username text, p_password text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare p cc.players; tok text;
begin
  select * into p from cc.players where username_key = lower(btrim(coalesce(p_username, ''))) for update;
  if not found then
    perform extensions.crypt('timing', extensions.gen_salt('bf', 8));
    return cc.err('bad_login');
  end if;
  if p.locked_until is not null and p.locked_until > now() then
    return cc.err('locked', jsonb_build_object('wait', ceil(extract(epoch from (p.locked_until - now())))));
  end if;
  if extensions.crypt(coalesce(p_password, ''), p.pass_hash) <> p.pass_hash then
    if p.failed_logins + 1 >= cc.cfg('login_attempts') then
      update cc.players set failed_logins = 0, locked_until = now() + make_interval(mins => cc.cfg('lockout_minutes')::integer) where id = p.id;
    else
      update cc.players set failed_logins = failed_logins + 1 where id = p.id;
    end if;
    return cc.err('bad_login');
  end if;
  update cc.players set failed_logins = 0, locked_until = null where id = p.id;
  tok := cc.new_session(p.id);
  return jsonb_build_object('ok', true, 'token', tok, 'me', public.cc_me(tok));
end $$;

create or replace function public.cc_logout(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  delete from cc.sessions where token_hash = extensions.digest(coalesce(p_token, ''), 'sha256');
  return jsonb_build_object('ok', true);
end $$;

-- Full profile: balance, stats, recent bets, promos, ads and any unfinished round.
create or replace function public.cc_me(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  pid uuid := cc.auth(p_token);
  p cc.players;
  v_crash jsonb;
  v_mines jsonb;
  v_bj jsonb;
  v_rooster jsonb;
  br cc.bj_rounds;
begin
  if pid is null then return cc.err('auth'); end if;
  v_crash := cc.crash_resolve(pid);
  -- A run can't be resumed after a reload; one left open for 10 minutes counts as lost.
  if exists (select 1 from cc.rooster_runs where player_id = pid and started_at < now() - interval '10 minutes') then
    perform cc.rr_settle(pid, false, 0, 'abandoned');
  end if;
  select jsonb_build_object('bet', bet, 'started', floor(extract(epoch from started_at) * 1000)) into v_rooster from cc.rooster_runs where player_id = pid;
  select * into p from cc.players where id = pid;
  select jsonb_build_object('bet', bet, 'mines', mines, 'revealed', to_jsonb(revealed)) into v_mines from cc.mines_rounds where player_id = pid;
  select * into br from cc.bj_rounds where player_id = pid;
  if found then v_bj := cc.bj_view(br, '[]'::jsonb); end if;
  return jsonb_build_object(
    'ok', true,
    'username', p.username,
    'balance', p.balance,
    'seq', p.seq,
    'stats', p.stats,
    'created', floor(extract(epoch from p.created_at) * 1000),
    'history', coalesce((select jsonb_agg(jsonb_build_object('g', game, 'a', wager, 'p', payout,
        'm', case when wager > 0 then round(payout / wager, 4) else 0 end, 't', floor(extract(epoch from created_at) * 1000), 'info', info) order by id desc)
      from (select * from cc.bets where player_id = pid order by id desc limit 40) b), '[]'::jsonb),
    'promos', coalesce((select jsonb_agg(code order by created_at) from cc.promo_redemptions where player_id = pid), '[]'::jsonb),
    'ads', cc.ads_state(p),
    'rounds', jsonb_build_object(
      'mines', v_mines,
      'crash', case when v_crash ->> 'state' in ('running', 'waiting') then v_crash else null end,
      'blackjack', v_bj,
      'rooster', v_rooster));
end $$;

create or replace function public.cc_redeem(p_token text, p_code text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  pid uuid := cc.auth(p_token);
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  pc cc.promo_codes;
  p cc.players;
begin
  if pid is null then return cc.err('auth'); end if;
  if v_code = '' then return cc.err('empty'); end if;
  select * into pc from cc.promo_codes where promo_codes.code = v_code and active;
  if not found then return cc.err('invalid', jsonb_build_object('code', v_code)); end if;
  perform 1 from cc.players where id = pid for update;
  begin
    insert into cc.promo_redemptions (player_id, code) values (pid, pc.code);
  exception when unique_violation then
    return cc.err('used', jsonb_build_object('code', v_code));
  end;
  p := cc.move(pid, pc.chips);
  return jsonb_build_object('ok', true, 'code', pc.code, 'chips', pc.chips, 'balance', p.balance, 'seq', p.seq);
end $$;

create or replace function public.cc_ad_reward(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  pid uuid := cc.auth(p_token);
  p cc.players;
  today date := (now() at time zone 'utc')::date;
  used integer;
  reward numeric := cc.cfg('ad_reward');
begin
  if pid is null then return cc.err('auth'); end if;
  select * into p from cc.players where id = pid for update;
  used := case when p.ad_day = today then p.ad_count else 0 end;
  if used >= cc.cfg('ad_daily_cap') then return cc.err('daily_cap', jsonb_build_object('ads', cc.ads_state(p))); end if;
  if p.ad_last is not null and now() - p.ad_last < make_interval(secs => cc.cfg('ad_cooldown_seconds')) then
    return cc.err('cooldown', jsonb_build_object('ads', cc.ads_state(p)));
  end if;
  update cc.players set ad_day = today, ad_count = used + 1, ad_last = now() where id = pid;
  p := cc.move(pid, reward);
  return jsonb_build_object('ok', true, 'chips', reward, 'balance', p.balance, 'seq', p.seq, 'ads', cc.ads_state(p));
end $$;

create or replace function public.cc_leaderboard(p_limit integer default 50) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(row_to_json(x) order by x.rank), '[]'::jsonb) from (
    select row_number() over (order by balance desc, updated_at asc) as rank, username, balance, biggest_win, bets
    from cc.players order by balance desc, updated_at asc
    limit greatest(1, least(coalesce(p_limit, 50), 100))) x
$$;

create or replace function public.cc_rank(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare pid uuid := cc.auth(p_token); p cc.players;
begin
  if pid is null then return cc.err('auth'); end if;
  select * into p from cc.players where id = pid;
  return jsonb_build_object('ok', true,
    'rank', 1 + (select count(*) from cc.players where balance > p.balance or (balance = p.balance and updated_at < p.updated_at)),
    'players', (select count(*) from cc.players));
end $$;

-- ── Plinko: one drop ──
create or replace function public.cc_plinko(p_token text, p_bet numeric, p_risk text, p_rows integer) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  pid uuid := cc.auth(p_token);
  p cc.players;
  path integer[] := '{}';
  k integer := 0;
  b integer;
  mult numeric;
  pay numeric;
  entry jsonb;
begin
  if pid is null then return cc.err('auth'); end if;
  if p_risk is null or p_risk not in ('low', 'medium', 'high') or p_rows is null or p_rows < 8 or p_rows > 16 then return cc.err('bad_args'); end if;
  if not cc.valid_bet(p_bet) then return cc.err('bad_bet'); end if;
  select * into p from cc.players where id = pid for update;
  if p.balance < p_bet then return cc.err('funds'); end if;
  for i in 1..p_rows loop
    b := case when cc.rand() < 0.5 then 0 else 1 end;
    path := path || b;
    k := k + b;
  end loop;
  mult := (cc.plinko_table(p_risk, p_rows) ->> k)::numeric;
  pay := round(p_bet * mult, 2);
  entry := cc.record(pid, 'plinko', p_bet, pay, p_risk || ' · ' || p_rows || ' rows');
  p := cc.move(pid, pay - p_bet);
  return jsonb_build_object('ok', true, 'path', to_jsonb(path), 'k', k, 'mult', mult, 'payout', pay, 'balance', p.balance, 'seq', p.seq, 'entry', entry);
end $$;

-- ── Roulette: p_bets = {"red": 5, "n:17": 10, "dozen:2": 5, ...} ──
create or replace function public.cc_roulette(p_token text, p_bets jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  pid uuid := cc.auth(p_token);
  p cc.players;
  k text;
  v text;
  amt numeric;
  total numeric := 0;
  cnt integer := 0;
  n integer;
  pay numeric := 0;
  entry jsonb;
begin
  if pid is null then return cc.err('auth'); end if;
  if p_bets is null or jsonb_typeof(p_bets) <> 'object' then return cc.err('bad_args'); end if;
  for k, v in select key, value from jsonb_each_text(p_bets) loop
    if k !~ '^(n:([0-9]|[12][0-9]|3[0-6])|red|black|odd|even|low|high|dozen:[123]|col:[123])$' then return cc.err('bad_args'); end if;
    begin
      amt := v::numeric;
    exception when others then
      return cc.err('bad_bet');
    end;
    if not cc.valid_bet(amt) then return cc.err('bad_bet'); end if;
    total := total + amt;
    cnt := cnt + 1;
  end loop;
  if cnt = 0 or cnt > 60 then return cc.err('bad_args'); end if;
  select * into p from cc.players where id = pid for update;
  if p.balance < total then return cc.err('funds'); end if;
  n := cc.randint(37);
  for k, v in select key, value from jsonb_each_text(p_bets) loop
    pay := pay + v::numeric * cc.roulette_mult(k, n);
  end loop;
  pay := round(pay, 2);
  entry := cc.record(pid, 'roulette', total, pay, n || ' ' || case when n = 0 then 'green' when cc.roulette_mult('red', n) > 0 then 'red' else 'black' end);
  p := cc.move(pid, pay - total);
  return jsonb_build_object('ok', true, 'number', n, 'payout', pay, 'wager', total, 'balance', p.balance, 'seq', p.seq, 'entry', entry);
end $$;

-- ── Slots: one paid spin plus any free spins it triggers ──
create or replace function public.cc_slots(p_token text, p_bet numeric) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  pid uuid := cc.auth(p_token);
  p cc.players;
  g integer[];
  ev jsonb;
  base numeric;
  total numeric;
  queue integer;
  fs jsonb := '[]'::jsonb;
  fg integer[];
  fe jsonb;
  spins integer := 0;
  entry jsonb;
begin
  if pid is null then return cc.err('auth'); end if;
  if not cc.valid_bet(p_bet) then return cc.err('bad_bet'); end if;
  select * into p from cc.players where id = pid for update;
  if p.balance < p_bet then return cc.err('funds'); end if;
  g := cc.slot_grid();
  ev := cc.slot_eval(g, p_bet, 1);
  base := (ev ->> 'total')::numeric;
  total := base;
  queue := (ev ->> 'fs')::integer;
  while queue > 0 and spins < 300 loop
    queue := queue - 1;
    spins := spins + 1;
    fg := cc.slot_grid();
    fe := cc.slot_eval(fg, p_bet, 2);
    total := total + (fe ->> 'total')::numeric;
    queue := queue + (fe ->> 'fs')::integer;
    fs := fs || jsonb_build_object('grid', to_jsonb(fg), 'total', (fe ->> 'total')::numeric, 'fs', (fe ->> 'fs')::integer);
  end loop;
  total := round(total, 2);
  entry := cc.record(pid, 'slots', p_bet, total, case when spins > 0 then spins || ' free spins' else '' end);
  p := cc.move(pid, total - p_bet);
  return jsonb_build_object('ok', true, 'grid', to_jsonb(g), 'base', base, 'fs_award', (ev ->> 'fs')::integer, 'fs', fs,
    'total', total, 'balance', p.balance, 'seq', p.seq, 'entry', entry);
end $$;

-- ── Mines ──
create or replace function cc.mines_mult(m integer, k integer) returns numeric language plpgsql immutable set search_path = '' as $$
declare r double precision := 0.99;
begin
  for i in 0..k - 1 loop r := r * (25 - i)::double precision / (25 - m - i); end loop;
  return r::numeric;
end $$;

create or replace function public.cc_mines_start(p_token text, p_bet numeric, p_mines integer) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare pid uuid := cc.auth(p_token); p cc.players; cells integer[];
begin
  if pid is null then return cc.err('auth'); end if;
  if p_mines is null or p_mines < 1 or p_mines > 24 then return cc.err('bad_args'); end if;
  if not cc.valid_bet(p_bet) then return cc.err('bad_bet'); end if;
  select * into p from cc.players where id = pid for update;
  if exists (select 1 from cc.mines_rounds where player_id = pid) then return cc.err('round_active'); end if;
  if p.balance < p_bet then return cc.err('funds'); end if;
  select array_agg(x) into cells from (select x from generate_series(0, 24) x order by cc.rand() limit p_mines) s;
  insert into cc.mines_rounds (player_id, bet, mines, cells) values (pid, p_bet, p_mines, cells);
  p := cc.move(pid, -p_bet);
  return jsonb_build_object('ok', true, 'bet', p_bet, 'mines', p_mines, 'next', round(cc.mines_mult(p_mines, 1), 4), 'balance', p.balance, 'seq', p.seq);
end $$;

create or replace function cc.mines_finish(pid uuid, won boolean) returns jsonb language plpgsql volatile set search_path = '' as $$
declare r cc.mines_rounds; k integer; mult numeric; pay numeric := 0; entry jsonb; p cc.players;
begin
  select * into r from cc.mines_rounds where player_id = pid for update;
  k := coalesce(array_length(r.revealed, 1), 0);
  mult := case when won then cc.mines_mult(r.mines, k) else 0 end;
  if won then pay := round(r.bet * mult, 2); end if;
  entry := cc.record(pid, 'mines', r.bet, pay, r.mines || case when r.mines = 1 then ' mine' else ' mines' end);
  p := cc.move(pid, pay);
  delete from cc.mines_rounds where player_id = pid;
  return jsonb_build_object('ok', true, 'mult', round(mult, 4), 'payout', pay, 'cells', to_jsonb(r.cells), 'revealed', to_jsonb(r.revealed),
    'balance', p.balance, 'seq', p.seq, 'entry', entry);
end $$;

create or replace function public.cc_mines_reveal(p_token text, p_tile integer) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare pid uuid := cc.auth(p_token); r cc.mines_rounds; k integer;
begin
  if pid is null then return cc.err('auth'); end if;
  select * into r from cc.mines_rounds where player_id = pid for update;
  if not found then return cc.err('no_round'); end if;
  if p_tile is null or p_tile < 0 or p_tile > 24 or p_tile = any (r.revealed) then return cc.err('bad_args'); end if;
  if p_tile = any (r.cells) then
    return cc.mines_finish(pid, false) || jsonb_build_object('mine', true, 'tile', p_tile);
  end if;
  update cc.mines_rounds set revealed = revealed || p_tile where player_id = pid returning * into r;
  k := array_length(r.revealed, 1);
  if k >= 25 - r.mines then
    return cc.mines_finish(pid, true) || jsonb_build_object('mine', false, 'tile', p_tile, 'cleared', true);
  end if;
  return jsonb_build_object('ok', true, 'mine', false, 'tile', p_tile, 'k', k,
    'mult', round(cc.mines_mult(r.mines, k), 4), 'next', round(cc.mines_mult(r.mines, k + 1), 4));
end $$;

create or replace function public.cc_mines_cashout(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare pid uuid := cc.auth(p_token); r cc.mines_rounds;
begin
  if pid is null then return cc.err('auth'); end if;
  select * into r from cc.mines_rounds where player_id = pid for update;
  if not found then return cc.err('no_round'); end if;
  if coalesce(array_length(r.revealed, 1), 0) = 0 then return cc.err('no_gems'); end if;
  return cc.mines_finish(pid, true);
end $$;

-- ── Crash ──
drop function if exists public.cc_crash_cashout(text);
create or replace function public.cc_crash_start(p_token text, p_bet numeric, p_auto numeric default null, p_delay_ms integer default 0) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  pid uuid := cc.auth(p_token);
  p cc.players;
  st jsonb;
  cp numeric;
  starts timestamptz;
begin
  if pid is null then return cc.err('auth'); end if;
  if not cc.valid_bet(p_bet) then return cc.err('bad_bet'); end if;
  if p_auto is not null and (p_auto < 1.01 or p_auto > 10000 or p_auto <> round(p_auto, 2)) then return cc.err('bad_args'); end if;
  select * into p from cc.players where id = pid for update;
  st := cc.crash_resolve(pid);
  if st ->> 'state' in ('running', 'waiting') then return cc.err('round_active'); end if;
  select * into p from cc.players where id = pid;
  if p.balance < p_bet then return cc.err('funds'); end if;
  cp := least(10000, greatest(1, floor(0.99 / (1 - cc.rand()) * 100) / 100))::numeric;
  starts := clock_timestamp() + make_interval(secs => least(6000, greatest(0, coalesce(p_delay_ms, 0))) / 1000.0);
  insert into cc.crash_rounds (player_id, bet, auto, crash_point, started_at) values (pid, p_bet, p_auto, cp, starts);
  p := cc.move(pid, -p_bet);
  return jsonb_build_object('ok', true, 'state', 'waiting', 'bet', p_bet, 'auto', p_auto,
    'started_at', floor(extract(epoch from starts) * 1000), 'server_now', floor(extract(epoch from clock_timestamp()) * 1000),
    'balance', p.balance, 'seq', p.seq);
end $$;

-- p_at = the multiplier the player saw when they tapped (never pays more than the server's own clock).
create or replace function public.cc_crash_cashout(p_token text, p_at numeric default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  pid uuid := cc.auth(p_token);
  st jsonb;
  r cc.crash_rounds;
  el double precision;
  m numeric;
  pay numeric;
  entry jsonb;
  p cc.players;
begin
  if pid is null then return cc.err('auth'); end if;
  perform 1 from cc.players where id = pid for update;
  st := cc.crash_resolve(pid);
  if st ->> 'state' = 'none' then return cc.err('no_round'); end if;
  if st ->> 'state' in ('cashed', 'crashed') then return jsonb_build_object('ok', true) || st; end if;
  select * into r from cc.crash_rounds where player_id = pid for update;
  el := extract(epoch from (clock_timestamp() - r.started_at)) * 1000;
  if el < 0 then
    -- still counting down: cancel and refund
    p := cc.move(pid, r.bet);
    delete from cc.crash_rounds where player_id = pid;
    return jsonb_build_object('ok', true, 'state', 'cancelled', 'balance', p.balance, 'seq', p.seq);
  end if;
  m := floor(exp(0.00009 * el) * 100) / 100;
  if p_at is not null and p_at >= 1 then m := least(m, floor(p_at * 100) / 100); end if;
  m := greatest(1, m);
  pay := round(r.bet * m, 2);
  entry := cc.record(pid, 'crash', r.bet, pay, 'cashed @ ' || to_char(m, 'FM999990.00') || '×');
  p := cc.move(pid, pay);
  delete from cc.crash_rounds where player_id = pid;
  return jsonb_build_object('ok', true, 'state', 'cashed', 'mult', m, 'payout', pay, 'crash_point', r.crash_point,
    'balance', p.balance, 'seq', p.seq, 'entry', entry);
end $$;

create or replace function public.cc_crash_poll(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare pid uuid := cc.auth(p_token);
begin
  if pid is null then return cc.err('auth'); end if;
  perform 1 from cc.players where id = pid for update;
  return jsonb_build_object('ok', true, 'server_now', floor(extract(epoch from clock_timestamp()) * 1000)) || cc.crash_resolve(pid);
end $$;

-- ── Blackjack ──
create or replace function public.cc_bj_deal(p_token text, p_bet numeric) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  pid uuid := cc.auth(p_token);
  p cc.players;
  r cc.bj_rounds;
  ev jsonb := '[]'::jsonb;
  c1 text; c2 text; d1 text; d2 text;
  shoe_left integer;
  shoe_cut integer;
begin
  if pid is null then return cc.err('auth'); end if;
  if not cc.valid_bet(p_bet) then return cc.err('bad_bet'); end if;
  select * into p from cc.players where id = pid for update;
  select * into r from cc.bj_rounds where player_id = pid;
  if found then return cc.err('round_active', jsonb_build_object('round', cc.bj_view(r, '[]'::jsonb))); end if;
  if p.balance < p_bet then return cc.err('funds'); end if;
  p := cc.move(pid, -p_bet);
  select coalesce(array_length(cards, 1), 0), cut into shoe_left, shoe_cut from cc.bj_shoes where player_id = pid;
  if not found or shoe_left <= shoe_cut then
    perform cc.bj_shuffle(pid);
    ev := ev || jsonb_build_array(jsonb_build_object('t', 'shuffle'));
  end if;
  c1 := cc.bj_draw(pid); d1 := cc.bj_draw(pid); c2 := cc.bj_draw(pid); d2 := cc.bj_draw(pid);
  ev := ev || jsonb_build_array(
    jsonb_build_object('t', 'p', 'h', 1, 'c', c1), jsonb_build_object('t', 'd', 'c', d1),
    jsonb_build_object('t', 'p', 'h', 1, 'c', c2), jsonb_build_object('t', 'd', 'c', '??'));
  insert into cc.bj_rounds (player_id, base, wagered, dealer, h1, b1, phase)
  values (pid, p_bet, p_bet, array[d1, d2], array[c1, c2], p_bet, 'dealing') returning * into r;
  if left(d1, length(d1) - 1) = 'A' and p.balance >= round(p_bet / 2, 2) and round(p_bet / 2, 2) >= 0.01 then
    update cc.bj_rounds set phase = 'insurance' where player_id = pid returning * into r;
    return cc.bj_view(r, ev, jsonb_build_object('balance', p.balance, 'seq', p.seq));
  end if;
  return cc.bj_after_insurance(pid, ev);
end $$;

create or replace function public.cc_bj_act(p_token text, p_action text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  pid uuid := cc.auth(p_token);
  p cc.players;
  r cc.bj_rounds;
  v jsonb;
  ev jsonb := '[]'::jsonb;
  ins numeric;
  c text;
  moved text;
  cur text[];
  t integer;
  h integer;
  nxt integer;
begin
  if pid is null then return cc.err('auth'); end if;
  select * into p from cc.players where id = pid for update;
  select * into r from cc.bj_rounds where player_id = pid for update;
  if not found then return cc.err('no_round'); end if;

  if r.phase = 'insurance' then
    if p_action = 'insure' then
      ins := round(r.base / 2, 2);
      if p.balance >= ins then
        p := cc.move(pid, -ins);
        update cc.bj_rounds set insurance = ins, wagered = wagered + ins where player_id = pid;
      end if;
    elsif p_action <> 'noinsure' then
      return cc.err('bad_action');
    end if;
    update cc.bj_rounds set phase = 'peek' where player_id = pid;
    return cc.bj_after_insurance(pid, ev);
  end if;

  if r.phase <> 'player' then return cc.err('bad_action'); end if;
  v := cc.bj_view(r, '[]'::jsonb);
  if not coalesce((v -> 'can' ->> p_action)::boolean, false) then return cc.err('bad_action'); end if;
  h := r.active;

  if p_action = 'hit' then
    c := cc.bj_draw(pid);
    if h = 1 then update cc.bj_rounds set h1 = h1 || c where player_id = pid returning * into r;
    else update cc.bj_rounds set h2 = h2 || c where player_id = pid returning * into r; end if;
    ev := ev || jsonb_build_array(jsonb_build_object('t', 'p', 'h', h, 'c', c));
    t := (cc.bj_total(case when h = 1 then r.h1 else r.h2 end))[1];
    if t >= 21 then
      if h = 1 then update cc.bj_rounds set d1 = true where player_id = pid; else update cc.bj_rounds set d2 = true where player_id = pid; end if;
    end if;
  elsif p_action = 'stand' then
    if h = 1 then update cc.bj_rounds set d1 = true where player_id = pid; else update cc.bj_rounds set d2 = true where player_id = pid; end if;
  elsif p_action = 'double' then
    p := cc.move(pid, -(case when h = 1 then r.b1 else r.b2 end));
    c := cc.bj_draw(pid);
    if h = 1 then update cc.bj_rounds set wagered = wagered + b1, b1 = b1 * 2, x1 = true, d1 = true, h1 = h1 || c where player_id = pid;
    else update cc.bj_rounds set wagered = wagered + b2, b2 = b2 * 2, x2 = true, d2 = true, h2 = h2 || c where player_id = pid; end if;
    ev := ev || jsonb_build_array(jsonb_build_object('t', 'p', 'h', h, 'c', c, 'x', true));
  elsif p_action = 'split' then
    p := cc.move(pid, -r.b1);
    moved := r.h1[2];
    update cc.bj_rounds set wagered = wagered + b1, h1 = array[h1[1]], h2 = array[moved], b2 = b1, nhands = 2 where player_id = pid;
    ev := ev || jsonb_build_array(jsonb_build_object('t', 'split', 'c', moved));
    c := cc.bj_draw(pid);
    update cc.bj_rounds set h1 = h1 || c where player_id = pid;
    ev := ev || jsonb_build_array(jsonb_build_object('t', 'p', 'h', 1, 'c', c));
    c := cc.bj_draw(pid);
    update cc.bj_rounds set h2 = h2 || c where player_id = pid returning * into r;
    ev := ev || jsonb_build_array(jsonb_build_object('t', 'p', 'h', 2, 'c', c));
    if left(moved, length(moved) - 1) = 'A' then
      update cc.bj_rounds set d1 = true, d2 = true where player_id = pid;
    else
      update cc.bj_rounds set d1 = (cc.bj_total(h1))[1] = 21, d2 = (cc.bj_total(h2))[1] = 21 where player_id = pid;
    end if;
  end if;

  select * into r from cc.bj_rounds where player_id = pid;
  if (r.active = 1 and r.d1) or (r.active = 2 and r.d2) then
    nxt := case when not r.d1 then 1 when r.nhands = 2 and not r.d2 then 2 else 0 end;
    if nxt = 0 then return cc.bj_dealer_turn(pid, ev); end if;
    update cc.bj_rounds set active = nxt where player_id = pid returning * into r;
  end if;
  select * into p from cc.players where id = pid;
  return cc.bj_view(r, ev, jsonb_build_object('balance', p.balance, 'seq', p.seq));
end $$;

-- ── Road Rooster: a skill game. Hop across a highway dodging cars, buses and trains.
-- The server picks a seed; the seed lays out every lane; the browser sends its moves
-- and the server replays them before paying. These functions mirror js/math.js
-- operation for operation in double precision, so both sides agree exactly.
do $$ begin
  create type cc.rr_lane as (kind text, dir integer, len float8, v float8, p float8, phase float8, blocked integer[]);
exception when duplicate_object then null;
end $$;

create or replace function cc.rr_rand(seed bigint, r integer, slot integer) returns float8 language plpgsql immutable set search_path = '' as $$
declare x bigint := (seed * 31 + r::bigint * 7919 + slot::bigint * 104729 + 12345) % 2147483647;
begin
  if x <= 0 then x := x + 2147483646; end if;
  for i in 1..3 loop x := (x * 48271) % 2147483647; end loop;
  return x::float8 / 2147483647::float8;
end $$;

create or replace function cc.rr_lane(seed bigint, r integer) returns cc.rr_lane language plpgsql immutable set search_path = '' as $$
declare L cc.rr_lane; f float8; q float8; b integer[] := '{}';
begin
  L.blocked := '{}';
  if r <= 0 then L.kind := 'start'; return L; end if;
  if r >= 75 then L.kind := 'finish'; return L; end if;
  f := least(1::float8, r::float8 / 60::float8);
  q := cc.rr_rand(seed, r, 0);
  L.kind := case when r <= 2 then 'road' when q < 0.2::float8 then 'safe' when r >= 6 and q < 0.28::float8 then 'train' when q < 0.45::float8 then 'bus' else 'road' end;
  L.dir := case when cc.rr_rand(seed, r, 1) < 0.5::float8 then 1 else -1 end;
  if L.kind = 'safe' then
    for c in 0..6 loop
      if coalesce(array_length(b, 1), 0) < 3 and cc.rr_rand(seed, r, 10 + c) < 0.22::float8 then b := b || c; end if;
    end loop;
    L.blocked := b;
    return L;
  end if;
  if L.kind = 'train' then
    L.len := 14::float8;
    L.v := 16::float8 + 6::float8 * cc.rr_rand(seed, r, 3);
    L.p := L.v * (6::float8 + 5::float8 * cc.rr_rand(seed, r, 4));
  elsif L.kind = 'bus' then
    L.len := 2.6::float8 + 0.6::float8 * cc.rr_rand(seed, r, 2);
    L.v := (1.1::float8 + 1.2::float8 * cc.rr_rand(seed, r, 3)) * (1::float8 + 0.7::float8 * f);
    L.p := L.len + (3.6::float8 - 1.0::float8 * f) + 3.0::float8 * cc.rr_rand(seed, r, 4);
  else
    L.len := 1.0::float8 + 0.35::float8 * cc.rr_rand(seed, r, 2);
    L.v := (1.5::float8 + 2.0::float8 * cc.rr_rand(seed, r, 3)) * (1::float8 + 0.9::float8 * f);
    L.p := L.len + (3.2::float8 - 1.0::float8 * f) + 2.6::float8 * cc.rr_rand(seed, r, 4);
  end if;
  L.phase := cc.rr_rand(seed, r, 5) * L.p;
  return L;
end $$;

-- First time in [t0, t1] a vehicle touches a rooster in column c (half-width hb), or -1.
create or replace function cc.rr_hit(L cc.rr_lane, c integer, t0 float8, t1 float8, hb float8) returns float8 language plpgsql immutable set search_path = '' as $$
declare a float8; lw float8; x0 float8; u0 float8; dt float8;
begin
  if L.v is null then return -1; end if;
  a := case when L.dir = 1 then c::float8 + 0.5::float8 - hb else c::float8 + 0.5::float8 - hb - L.len end;
  lw := 2::float8 * hb + L.len;
  x0 := L.phase + L.dir::float8 * L.v * t0;
  u0 := (x0 - a) - L.p * floor((x0 - a) / L.p);
  if u0 < lw then return t0; end if;
  dt := t1 - t0;
  if L.dir = 1 then
    if u0 + L.v * dt >= L.p then return t0 + (L.p - u0) / L.v; end if;
  elsif u0 - L.v * dt < lw then
    return t0 + (u0 - lw) / L.v;
  end if;
  return -1;
end $$;

-- Replay [[ms, move], ...] (0 forward, 1 back, 2 left, 3 right) up to end_ms.
create or replace function cc.rr_replay(seed bigint, moves jsonb, end_ms bigint, hb float8, margin float8) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  cur integer := 0; col integer := 3; best integer := 0; tprev float8 := 0; t float8; m integer;
  L cc.rr_lane; NL cc.rr_lane; thit float8; th float8; cause text; nr integer; nc integer;
  n integer := coalesce(jsonb_array_length(moves), 0);
begin
  for i in 0..n loop
    t := case when i < n then (moves -> i ->> 0)::float8 / 1000::float8 else end_ms::float8 / 1000::float8 end;
    -- did anything get us while we stood on this tile?
    L := cc.rr_lane(seed, cur);
    thit := cc.rr_hit(L, col, tprev, t, hb);
    cause := L.kind;
    if cur < 75 then
      th := greatest(tprev, 4::float8 + (-0.4::float8 + sqrt(0.16::float8 + 0.016::float8 * (cur::float8 + margin))) / 0.008::float8);
      if th <= t and (thit < 0 or th < thit) then thit := th; cause := 'hawk'; end if;
    end if;
    if thit >= 0 then
      return jsonb_build_object('alive', false, 'score', best, 'row', cur, 'death_ms', round(thit * 1000), 'cause', cause);
    end if;
    exit when i = n;
    m := (moves -> i ->> 1)::integer;
    nr := cur; nc := col;
    if m = 0 then nr := nr + 1; elsif m = 1 then nr := nr - 1; elsif m = 2 then nc := nc - 1; elsif m = 3 then nc := nc + 1; end if;
    if nr >= 0 and nr <= 75 and nc >= 0 and nc < 7 then
      NL := cc.rr_lane(seed, nr);
      if not (nc = any (NL.blocked)) then cur := nr; col := nc; best := greatest(best, cur); end if;
    end if;
    tprev := t;
    if cur >= 75 then return jsonb_build_object('alive', true, 'score', best, 'row', cur, 'finished', true); end if;
  end loop;
  return jsonb_build_object('alive', true, 'score', best, 'row', cur);
end $$;

-- Payout multiplier for the furthest row: row/10 up to row 10, then ×1.07 per row (exact).
create or replace function cc.rr_mult(k integer) returns numeric language sql immutable set search_path = '' as $$
  select case when k <= 0 then 0::numeric when k <= 10 then round(k::numeric / 10, 2)
    else round(div(power(107::numeric, k - 10) * 100, power(100::numeric, k - 10)) / 100, 2) end
$$;

create or replace function cc.rr_settle(pid uuid, won boolean, score integer, info text) returns jsonb language plpgsql volatile set search_path = '' as $$
declare r cc.rooster_runs; mult numeric; pay numeric; entry jsonb; p cc.players;
begin
  select * into r from cc.rooster_runs where player_id = pid for update;
  if not found then return null; end if;
  mult := case when won then cc.rr_mult(score) else 0 end;
  pay := round(r.bet * mult, 2);
  entry := cc.record(pid, 'rooster', r.bet, pay, info);
  p := cc.move(pid, pay);
  delete from cc.rooster_runs where player_id = pid;
  return jsonb_build_object('ok', true, 'mult', mult, 'payout', pay, 'score', score, 'balance', p.balance, 'seq', p.seq, 'entry', entry);
end $$;

create or replace function public.cc_rooster_start(p_token text, p_bet numeric) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare pid uuid := cc.auth(p_token); p cc.players; s bigint;
begin
  if pid is null then return cc.err('auth'); end if;
  if not cc.valid_bet(p_bet) then return cc.err('bad_bet'); end if;
  select * into p from cc.players where id = pid for update;
  -- An unfinished run is forfeited.
  perform cc.rr_settle(pid, false, 0, 'abandoned');
  select * into p from cc.players where id = pid;
  if p.balance < p_bet then return cc.err('funds'); end if;
  s := 1 + floor(cc.rand() * 2147483645)::bigint;
  insert into cc.rooster_runs (player_id, bet, seed, started_at) values (pid, p_bet, s, clock_timestamp());
  p := cc.move(pid, -p_bet);
  return jsonb_build_object('ok', true, 'seed', s, 'bet', p_bet, 'balance', p.balance, 'seq', p.seq);
end $$;

-- End a run. p_cashout = true banks the furthest row reached (if the replay agrees you're alive).
create or replace function public.cc_rooster_end(p_token text, p_moves jsonb, p_end_ms integer, p_cashout boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  pid uuid := cc.auth(p_token); r cc.rooster_runs; el bigint; prev bigint := 0; mv jsonb; t bigint; m integer; res jsonb; score integer; out jsonb;
begin
  if pid is null then return cc.err('auth'); end if;
  perform 1 from cc.players where id = pid for update;
  select * into r from cc.rooster_runs where player_id = pid for update;
  if not found then return cc.err('no_round'); end if;
  el := floor(extract(epoch from (clock_timestamp() - r.started_at)) * 1000)::bigint;
  if p_moves is null or jsonb_typeof(p_moves) <> 'array' or jsonb_array_length(p_moves) > 4000 or p_end_ms is null then
    return cc.rr_settle(pid, false, 0, 'invalid run') || jsonb_build_object('alive', false, 'cause', 'invalid');
  end if;
  -- Times must run forward and can't be later than the server's own clock (plus slack).
  for mv in select value from jsonb_array_elements(p_moves) loop
    begin
      t := (mv ->> 0)::bigint;
      m := (mv ->> 1)::integer;
    exception when others then
      return cc.rr_settle(pid, false, 0, 'invalid run') || jsonb_build_object('alive', false, 'cause', 'invalid');
    end;
    if jsonb_typeof(mv) <> 'array' or t is null or m is null or t < prev or t > el + 2000 or m not between 0 and 3 then
      return cc.rr_settle(pid, false, 0, 'invalid run') || jsonb_build_object('alive', false, 'cause', 'invalid');
    end if;
    prev := t;
  end loop;
  if p_end_ms < prev or p_end_ms > el + 2000 then
    return cc.rr_settle(pid, false, 0, 'invalid run') || jsonb_build_object('alive', false, 'cause', 'invalid');
  end if;
  res := cc.rr_replay(r.seed, p_moves, p_end_ms, 0.27::float8, 1.1::float8);
  score := (res ->> 'score')::integer;
  if (res ->> 'alive')::boolean and (p_cashout or (res ->> 'finished') is not null) and score >= 1 then
    out := cc.rr_settle(pid, true, score, case when (res ->> 'finished') is not null then 'golden egg! row 75' else 'cashed at row ' || score end);
  else
    out := cc.rr_settle(pid, false, score, 'row ' || score || ' · ' || case coalesce(res ->> 'cause', '') when 'hawk' then 'caught by the hawk' when 'train' then 'hit by a train' when 'bus' then 'hit by a bus' when 'road' then 'hit by a car' else 'run ended' end);
  end if;
  return out || jsonb_build_object('alive', (res ->> 'alive')::boolean, 'cause', res ->> 'cause', 'death_ms', res -> 'death_ms', 'finished', (res ->> 'finished') is not null);
end $$;

-- ───────────────────────────── permissions ──────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'cc_signup(text,text)', 'cc_login(text,text)', 'cc_logout(text)', 'cc_me(text)', 'cc_redeem(text,text)',
    'cc_ad_reward(text)', 'cc_leaderboard(integer)', 'cc_rank(text)', 'cc_plinko(text,numeric,text,integer)',
    'cc_roulette(text,jsonb)', 'cc_slots(text,numeric)', 'cc_mines_start(text,numeric,integer)', 'cc_mines_reveal(text,integer)',
    'cc_mines_cashout(text)', 'cc_crash_start(text,numeric,numeric,integer)', 'cc_crash_cashout(text,numeric)', 'cc_crash_poll(text)',
    'cc_bj_deal(text,numeric)', 'cc_bj_act(text,text)',
    'cc_rooster_start(text,numeric)', 'cc_rooster_end(text,jsonb,integer,boolean)']
  loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;
