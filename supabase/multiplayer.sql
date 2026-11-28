-- Multiplayer: 1v1 challenges for Road Rooster and Night Flight, and shared Blackjack tables.
-- Run after schema.sql. Additive and safe to reapply to an existing casino.
begin;

-- ───────────────────────────── 1v1 challenges ───────────────────────────────
-- Asynchronous: the host stakes a bet and plays at once; the score stays hidden and the
-- challenge is listed. Anyone can accept with their own bet and play the same course. The
-- higher score wins 2× its own bet, the other bet is lost, and a tie refunds both. Runs are
-- replayed on the server like bet runs. A run left unfinished for 30 minutes scores 0, and a
-- challenge nobody accepts within 24 hours is refunded.
create table if not exists cc.duels (
  id uuid primary key default gen_random_uuid(),
  game text not null check (game in ('rooster', 'flight')),
  seed bigint not null,
  state text not null check (state in ('hosting', 'open', 'guesting', 'done', 'expired')),
  host_id uuid not null references cc.players (id) on delete cascade,
  host_bet numeric(20, 2) not null check (cc.valid_bet(host_bet)),
  host_score integer,
  host_started timestamptz not null default clock_timestamp(),
  guest_id uuid references cc.players (id) on delete cascade,
  guest_bet numeric(20, 2) check (guest_bet is null or cc.valid_bet(guest_bet)),
  guest_score integer,
  guest_started timestamptz,
  host_pay numeric(20, 2),
  guest_pay numeric(20, 2),
  host_entry jsonb,
  guest_entry jsonb,
  created_at timestamptz not null default clock_timestamp(),
  opened_at timestamptz,
  settled_at timestamptz,
  check (guest_id is null or guest_id <> host_id)
);
create index if not exists duels_lobby on cc.duels (game, opened_at desc) where state = 'open';
create index if not exists duels_host on cc.duels (host_id, created_at desc);
create index if not exists duels_guest on cc.duels (guest_id, created_at desc);
create index if not exists duels_live on cc.duels (created_at) where state in ('hosting', 'open', 'guesting');
alter table cc.duels enable row level security;

-- A submitted run's score, replayed on the challenge's course. The same checks as bet runs:
-- times run forward and can't outrun the server's clock. A malformed run scores 0.
create or replace function cc.duel_score(v_game text, v_seed bigint, v_run jsonb, v_el bigint) returns integer
language plpgsql immutable set search_path = '' as $$
declare
  v_moves jsonb; v_mv jsonb; v_t bigint; v_m integer; v_prev bigint := 0; v_end bigint;
  v_start integer; v_frames integer; v_flaps integer[] := '{}'; v_f integer; v_fprev integer := -1;
begin
  if v_run is null or jsonb_typeof(v_run) <> 'object' then return 0; end if;
  if v_game = 'rooster' then
    v_moves := v_run -> 'moves';
    begin
      v_end := (v_run ->> 'end_ms')::bigint;
    exception when others then return 0;
    end;
    if v_moves is null or jsonb_typeof(v_moves) <> 'array' or jsonb_array_length(v_moves) > 20000 or v_end is null then return 0; end if;
    for v_mv in select value from jsonb_array_elements(v_moves) loop
      if jsonb_typeof(v_mv) <> 'array' then return 0; end if;
      begin
        v_t := (v_mv ->> 0)::bigint;
        v_m := (v_mv ->> 1)::integer;
      exception when others then return 0;
      end;
      if v_t is null or v_m is null or v_t < v_prev or v_t > v_el + 2000 or v_m not between 0 and 3 then return 0; end if;
      v_prev := v_t;
    end loop;
    if v_end < v_prev or v_end > v_el + 2000 then return 0; end if;
    return (cc.rs_replay(v_seed, v_moves, v_end, 1000000, 0.23::float8, 0.1::float8, 0.05::float8) ->> 'score')::integer;
  end if;
  begin
    v_start := (v_run ->> 'start')::integer;
    v_frames := (v_run ->> 'frames')::integer;
  exception when others then return 0;
  end;
  if v_start is null or v_start not between -8 and 8 or v_frames is null or v_frames < 0
    or v_frames::numeric > v_el::numeric * 30 / 1000 + 90 or jsonb_typeof(v_run -> 'flaps') is distinct from 'array'
    or jsonb_array_length(v_run -> 'flaps') > v_frames + 1 then return 0; end if;
  for v_mv in select value from jsonb_array_elements(v_run -> 'flaps') loop
    if jsonb_typeof(v_mv) <> 'number' then return 0; end if;
    begin
      v_f := (v_mv #>> '{}')::integer;
    exception when others then return 0;
    end;
    if v_f is null or v_f <= v_fprev or v_f >= v_frames then return 0; end if;
    v_flaps := v_flaps || v_f;
    v_fprev := v_f;
  end loop;
  return (cc.fl_replay(v_seed, v_start, v_flaps, 1000000, v_frames) ->> 'score')::integer;
end $$;

-- Both scores are in: the higher one wins 2× its own bet; a tie refunds both.
create or replace function cc.duel_settle(v_id uuid) returns cc.duels
language plpgsql volatile set search_path = '' as $$
declare d cc.duels; v_hp numeric; v_gp numeric; v_hn text; v_gn text; v_unit text; v_he jsonb; v_ge jsonb;
begin
  select * into d from cc.duels where id = v_id for update;
  if d.state <> 'guesting' or d.guest_score is null then return d; end if;
  if d.host_score = d.guest_score then v_hp := d.host_bet; v_gp := d.guest_bet;
  elsif d.host_score > d.guest_score then v_hp := d.host_bet * 2; v_gp := 0;
  else v_hp := 0; v_gp := d.guest_bet * 2;
  end if;
  select username into v_hn from cc.players where id = d.host_id;
  select username into v_gn from cc.players where id = d.guest_id;
  v_unit := case d.game when 'rooster' then ' rows' else ' gates' end;
  perform 1 from cc.players where id in (d.host_id, d.guest_id) order by id for update;
  perform cc.move(d.host_id, v_hp);
  v_he := cc.record(d.host_id, d.game, d.host_bet, v_hp, '1v1 vs ' || v_gn || ' · ' || d.host_score || ' to ' || d.guest_score || v_unit);
  perform cc.move(d.guest_id, v_gp);
  v_ge := cc.record(d.guest_id, d.game, d.guest_bet, v_gp, '1v1 vs ' || v_hn || ' · ' || d.guest_score || ' to ' || d.host_score || v_unit);
  update cc.duels set state = 'done', host_pay = v_hp, guest_pay = v_gp, host_entry = v_he, guest_entry = v_ge, settled_at = clock_timestamp()
   where id = d.id returning * into d;
  return d;
end $$;

-- Time limits, applied whenever a challenge is touched.
create or replace function cc.duel_sweep(v_id uuid) returns cc.duels
language plpgsql volatile set search_path = '' as $$
declare d cc.duels;
begin
  select * into d from cc.duels where id = v_id for update;
  if not found then return null; end if;
  if d.state = 'hosting' and d.host_started < clock_timestamp() - interval '30 minutes' then
    update cc.duels set state = 'open', host_score = 0, opened_at = clock_timestamp() where id = d.id returning * into d;
  elsif d.state = 'guesting' and d.guest_started < clock_timestamp() - interval '30 minutes' then
    update cc.duels set guest_score = 0 where id = d.id;
    d := cc.duel_settle(d.id);
  elsif d.state = 'open' and d.opened_at < clock_timestamp() - interval '24 hours' then
    perform 1 from cc.players where id = d.host_id for update;
    perform cc.move(d.host_id, d.host_bet);
    update cc.duels set state = 'expired', host_pay = d.host_bet, settled_at = clock_timestamp() where id = d.id returning * into d;
  end if;
  return d;
end $$;

-- Starting another run gives up this player's unfinished one (it scores 0).
create or replace function cc.duel_forfeit(v_pid uuid) returns void
language plpgsql volatile set search_path = '' as $$
declare v_id uuid;
begin
  for v_id in select id from cc.duels where (host_id = v_pid and state = 'hosting') or (guest_id = v_pid and state = 'guesting') order by id loop
    perform 1 from cc.duels where id = v_id for update;
    update cc.duels set state = 'open', host_score = 0, opened_at = clock_timestamp() where id = v_id and state = 'hosting';
    update cc.duels set guest_score = 0 where id = v_id and state = 'guesting';
    perform cc.duel_settle(v_id);
  end loop;
end $$;

create or replace function cc.duel_view(d cc.duels, v_viewer uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare v_seat integer := case when v_viewer = d.host_id then 0 when v_viewer = d.guest_id then 1 else -1 end;
  v_hn text; v_gn text; v_done boolean := d.state = 'done';
begin
  select username into v_hn from cc.players where id = d.host_id;
  select username into v_gn from cc.players where id = d.guest_id;
  return jsonb_build_object(
    'id', d.id, 'game', d.game, 'state', d.state, 'seat', v_seat, 'host', v_hn, 'guest', v_gn,
    'host_bet', d.host_bet, 'guest_bet', d.guest_bet,
    -- a score stays hidden from the other player until both are in
    'host_score', case when v_done or v_seat = 0 then d.host_score end,
    'guest_score', case when v_done or v_seat = 1 then d.guest_score end,
    'payout', case v_seat when 0 then d.host_pay when 1 then d.guest_pay end,
    'entry', case v_seat when 0 then d.host_entry when 1 then d.guest_entry end,
    'seed', case when (v_seat = 0 and d.state = 'hosting') or (v_seat = 1 and d.state = 'guesting') then d.seed end,
    'created', floor(extract(epoch from d.created_at) * 1000),
    'opened', floor(extract(epoch from d.opened_at) * 1000),
    'expires', floor(extract(epoch from d.opened_at + interval '24 hours') * 1000),
    'settled', floor(extract(epoch from d.settled_at) * 1000));
end $$;

create or replace function cc.duel_reply(d cc.duels, v_pid uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('ok', true, 'duel', cc.duel_view(d, v_pid), 'balance', p.balance, 'seq', p.seq,
    'server_now', floor(extract(epoch from clock_timestamp()) * 1000)) from cc.players p where p.id = v_pid
$$;

create or replace function public.cc_duel_create(p_token text, p_game text, p_bet numeric) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_pid uuid := cc.auth(p_token); v_p cc.players; d cc.duels; v_n integer;
begin
  if v_pid is null then return cc.err('auth'); end if;
  if p_game is null or p_game not in ('rooster', 'flight') then return cc.err('bad_game'); end if;
  if not cc.valid_bet(p_bet) then return cc.err('bad_bet'); end if;
  select * into v_p from cc.players where id = v_pid for update;
  select count(*) into v_n from cc.duels where host_id = v_pid and state in ('hosting', 'open');
  if v_n >= 5 then return cc.err('duel_limit'); end if;
  if v_p.balance < p_bet then return cc.err('funds'); end if;
  -- Only now (the new run is certain) does an unfinished one end.
  perform cc.duel_forfeit(v_pid);
  insert into cc.duels (game, seed, state, host_id, host_bet)
    values (p_game, 1 + floor(cc.rand() * 2147483645)::bigint, 'hosting', v_pid, p_bet) returning * into d;
  perform cc.move(v_pid, -p_bet);
  return cc.duel_reply(d, v_pid);
end $$;

create or replace function public.cc_duel_join(p_token text, p_id uuid, p_bet numeric) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_pid uuid := cc.auth(p_token); d cc.duels; v_bal numeric;
begin
  if v_pid is null then return cc.err('auth'); end if;
  if not cc.valid_bet(p_bet) then return cc.err('bad_bet'); end if;
  d := cc.duel_sweep(p_id);
  if d.id is null then return cc.err('duel_missing'); end if;
  if d.host_id = v_pid then return cc.err('duel_own'); end if;
  if d.guest_id = v_pid then return cc.duel_reply(d, v_pid); end if;
  if d.state <> 'open' then return cc.err('duel_taken'); end if;
  select balance into v_bal from cc.players where id = v_pid for update;
  if v_bal < p_bet then return cc.err('funds'); end if;
  perform cc.duel_forfeit(v_pid);
  perform cc.move(v_pid, -p_bet);
  update cc.duels set state = 'guesting', guest_id = v_pid, guest_bet = p_bet, guest_started = clock_timestamp()
   where id = d.id returning * into d;
  return cc.duel_reply(d, v_pid);
end $$;

-- Submit a finished run: p_run is {moves, end_ms} for Road Rooster, {start, flaps, frames}
-- for Night Flight. Repeating it after the run counted just returns the challenge.
create or replace function public.cc_duel_finish(p_token text, p_id uuid, p_run jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_pid uuid := cc.auth(p_token); d cc.duels; v_el bigint;
begin
  if v_pid is null then return cc.err('auth'); end if;
  d := cc.duel_sweep(p_id);
  if d.id is null or v_pid not in (d.host_id, coalesce(d.guest_id, d.host_id)) then return cc.err('duel_missing'); end if;
  if d.host_id = v_pid and d.state = 'hosting' then
    v_el := floor(extract(epoch from (clock_timestamp() - d.host_started)) * 1000)::bigint;
    update cc.duels set state = 'open', host_score = cc.duel_score(d.game, d.seed, p_run, v_el), opened_at = clock_timestamp()
     where id = d.id returning * into d;
  elsif d.guest_id = v_pid and d.state = 'guesting' then
    v_el := floor(extract(epoch from (clock_timestamp() - d.guest_started)) * 1000)::bigint;
    update cc.duels set guest_score = cc.duel_score(d.game, d.seed, p_run, v_el) where id = d.id;
    d := cc.duel_settle(d.id);
  end if;
  return cc.duel_reply(d, v_pid);
end $$;

create or replace function public.cc_duel_get(p_token text, p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_pid uuid := cc.auth(p_token); d cc.duels;
begin
  if v_pid is null then return cc.err('auth'); end if;
  d := cc.duel_sweep(p_id);
  if d.id is null or (d.state <> 'open' and v_pid not in (d.host_id, coalesce(d.guest_id, d.host_id))) then return cc.err('duel_missing'); end if;
  return cc.duel_reply(d, v_pid);
end $$;

-- Open challenges for a game (not your own), and your recent ones with their results.
create or replace function public.cc_duel_list(p_token text, p_game text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_pid uuid := cc.auth(p_token); v_open jsonb; v_mine jsonb; v_p cc.players; v_id uuid;
begin
  if v_pid is null then return cc.err('auth'); end if;
  -- Settle a few overdue challenges, anyone's, so refunds never wait for their owners.
  for v_id in select id from cc.duels where state in ('hosting', 'open', 'guesting') and (
      (state = 'open' and opened_at < clock_timestamp() - interval '24 hours')
      or (state = 'hosting' and host_started < clock_timestamp() - interval '30 minutes')
      or (state = 'guesting' and guest_started < clock_timestamp() - interval '30 minutes'))
    order by created_at limit 10 loop
    perform cc.duel_sweep(v_id);
  end loop;
  select jsonb_agg(cc.duel_view(d, v_pid) order by d.opened_at desc) into v_open from
    (select * from cc.duels where game = p_game and state = 'open' and host_id <> v_pid order by opened_at desc limit 30) d;
  select jsonb_agg(cc.duel_view(d, v_pid) order by d.created_at desc) into v_mine from
    (select * from cc.duels where game = p_game and (host_id = v_pid or guest_id = v_pid) order by created_at desc limit 15) d;
  select * into v_p from cc.players where id = v_pid;
  return jsonb_build_object('ok', true, 'open', coalesce(v_open, '[]'), 'mine', coalesce(v_mine, '[]'), 'balance', v_p.balance, 'seq', v_p.seq,
    'server_now', floor(extract(epoch from clock_timestamp()) * 1000));
end $$;

-- ───────────────────────────── Blackjack tables ─────────────────────────────
-- Up to five players share a table and a six-deck shoe and each plays their own hand against
-- one dealer, with the single-player rules and payouts: blackjack 3:2, dealer stands on all
-- 17s and peeks with an ace or ten up, double on two cards, one split (split aces take one
-- card each). Betting closes 15 seconds after the first bet (sooner once everyone is in),
-- each decision has 20 seconds before the hand stands, results show for 7 seconds. Every
-- call moves the table along; a seat that stops polling sits out and leaves between rounds.
create table if not exists cc.bjm_tables (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phase text not null default 'idle' check (phase in ('idle', 'betting', 'playing', 'done')),
  round integer not null default 0,
  shoe text[] not null default '{}',
  cut integer not null default 0,
  dealer text[] not null default '{}',
  revealed boolean not null default false,
  turn integer,
  deadline timestamptz,
  created_at timestamptz not null default clock_timestamp()
);
create table if not exists cc.bjm_seats (
  table_id uuid not null references cc.bjm_tables (id) on delete cascade,
  seat integer not null check (seat between 0 and 4),
  player_id uuid not null unique references cc.players (id) on delete cascade,
  seen_at timestamptz not null default clock_timestamp(),
  leaving boolean not null default false,
  bet numeric(20, 2) not null default 0,
  wagered numeric(20, 2) not null default 0,
  hands jsonb not null default '[]',
  active integer not null default 0,
  result jsonb,
  payout numeric(20, 2),
  entry jsonb,
  primary key (table_id, seat)
);
alter table cc.bjm_tables enable row level security;
alter table cc.bjm_seats enable row level security;

create or replace function cc.bjm_new_shoe() returns text[] language sql volatile set search_path = '' as $$
  select array_agg(c order by cc.rand()) from (
    select r || s as c from unnest(array['A','2','3','4','5','6','7','8','9','10','J','Q','K']) r,
      unnest(array['S','H','D','C']) s, generate_series(1, 6) d) x
$$;

create or replace function cc.bjm_cards(v_hand jsonb) returns text[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(x order by o), '{}') from jsonb_array_elements_text(v_hand -> 'c') with ordinality as e(x, o)
$$;

create or replace function cc.bjm_draw(v_tid uuid) returns text language plpgsql volatile set search_path = '' as $$
declare v_shoe text[]; v_n integer; v_c text;
begin
  select shoe into v_shoe from cc.bjm_tables where id = v_tid;
  v_n := coalesce(array_length(v_shoe, 1), 0);
  if v_n = 0 then
    v_shoe := cc.bjm_new_shoe();
    v_n := array_length(v_shoe, 1);
  end if;
  v_c := v_shoe[v_n];
  update cc.bjm_tables set shoe = v_shoe[1:v_n - 1] where id = v_tid;
  return v_c;
end $$;

create or replace function cc.bjm_settle(v_tid uuid) returns void language plpgsql volatile set search_path = '' as $$
declare
  t cc.bjm_tables; s cc.bjm_seats; v_d integer; v_dbj boolean; v_h jsonb; v_cards text[]; v_v integer; v_b numeric;
  v_pay numeric; v_total numeric; v_res jsonb; v_label text; v_cls text; v_nat boolean; v_entry jsonb; v_info text;
begin
  update cc.bjm_tables set revealed = true, phase = 'done', turn = null, deadline = clock_timestamp() + interval '7 seconds'
   where id = v_tid returning * into t;
  v_d := (cc.bj_total(t.dealer))[1];
  v_dbj := cc.bj_is_bj(t.dealer);
  perform 1 from cc.players where id in (select player_id from cc.bjm_seats where table_id = v_tid and bet > 0) order by id for update;
  for s in select * from cc.bjm_seats where table_id = v_tid and bet > 0 order by seat loop
    v_total := 0;
    v_res := '[]';
    for i in 0 .. jsonb_array_length(s.hands) - 1 loop
      v_h := s.hands -> i;
      v_cards := cc.bjm_cards(v_h);
      v_b := (v_h ->> 'b')::numeric;
      v_v := (cc.bj_total(v_cards))[1];
      v_nat := jsonb_array_length(s.hands) = 1 and cc.bj_is_bj(v_cards);
      v_pay := 0;
      if v_nat and not v_dbj then v_pay := v_b * 2.5; v_label := 'Blackjack'; v_cls := 'bj';
      elsif v_nat and v_dbj then v_pay := v_b; v_label := 'Push'; v_cls := 'push';
      elsif v_v > 21 then v_label := 'Bust'; v_cls := 'loss';
      elsif v_dbj then v_label := 'Dealer blackjack'; v_cls := 'loss';
      elsif v_d > 21 or v_v > v_d then v_pay := v_b * 2; v_label := case when v_d > 21 then 'Dealer busts' else 'Win' end; v_cls := 'win';
      elsif v_v = v_d then v_pay := v_b; v_label := 'Push'; v_cls := 'push';
      else v_label := 'Lose'; v_cls := 'loss';
      end if;
      v_pay := round(v_pay, 2);
      v_total := v_total + v_pay;
      v_res := v_res || jsonb_build_object('label', v_label, 'cls', v_cls, 'pay', v_pay, 'bet', v_b);
    end loop;
    v_total := round(v_total, 2);
    v_info := 'table · ' || case when jsonb_array_length(s.hands) > 1 then 'split · ' else '' end
      || 'dealer ' || case when v_dbj then 'BJ' when v_d > 21 then 'bust' else v_d::text end;
    v_entry := cc.record(s.player_id, 'blackjack', s.wagered, v_total, v_info);
    perform cc.move(s.player_id, v_total);
    update cc.bjm_seats set result = v_res, payout = v_total, entry = v_entry where table_id = v_tid and seat = s.seat;
  end loop;
end $$;

-- The dealer plays (only if a hand is still standing), then every bet settles.
create or replace function cc.bjm_dealer(v_tid uuid) returns void language plpgsql volatile set search_path = '' as $$
declare v_dealer text[]; v_live boolean;
begin
  select dealer into v_dealer from cc.bjm_tables where id = v_tid;
  select exists (select 1 from cc.bjm_seats s, jsonb_array_elements(s.hands) h
    where s.table_id = v_tid and s.bet > 0 and (cc.bj_total(cc.bjm_cards(h)))[1] <= 21
      and not (jsonb_array_length(s.hands) = 1 and cc.bj_is_bj(cc.bjm_cards(h)))) into v_live;
  if v_live then
    while (cc.bj_total(v_dealer))[1] < 17 loop
      v_dealer := v_dealer || cc.bjm_draw(v_tid);
    end loop;
    update cc.bjm_tables set dealer = v_dealer where id = v_tid;
  end if;
  perform cc.bjm_settle(v_tid);
end $$;

-- Hand the turn to the first hand still in play, with a fresh timer; none left, the dealer plays.
create or replace function cc.bjm_advance(v_tid uuid) returns void language plpgsql volatile set search_path = '' as $$
declare s cc.bjm_seats;
begin
  for s in select * from cc.bjm_seats where table_id = v_tid and bet > 0 order by seat loop
    for i in 0 .. jsonb_array_length(s.hands) - 1 loop
      if not coalesce((s.hands -> i ->> 'd')::boolean, false) then
        update cc.bjm_seats set active = i where table_id = v_tid and seat = s.seat;
        update cc.bjm_tables set phase = 'playing', turn = s.seat, deadline = clock_timestamp() + interval '20 seconds' where id = v_tid;
        return;
      end if;
    end loop;
  end loop;
  perform cc.bjm_dealer(v_tid);
end $$;

create or replace function cc.bjm_deal(v_tid uuid) returns void language plpgsql volatile set search_path = '' as $$
declare v_seat integer; v_up text; v_hole text;
begin
  -- one card each, the dealer's up card, a second card each, then the hole card
  for v_seat in select seat from cc.bjm_seats where table_id = v_tid and bet > 0 order by seat loop
    update cc.bjm_seats set active = 0, hands = jsonb_build_array(jsonb_build_object('c', jsonb_build_array(cc.bjm_draw(v_tid)), 'b', bet, 'd', false, 'x', false))
     where table_id = v_tid and seat = v_seat;
  end loop;
  v_up := cc.bjm_draw(v_tid);
  for v_seat in select seat from cc.bjm_seats where table_id = v_tid and bet > 0 order by seat loop
    update cc.bjm_seats set hands = jsonb_set(hands, '{0,c}', (hands -> 0 -> 'c') || to_jsonb(cc.bjm_draw(v_tid)))
     where table_id = v_tid and seat = v_seat;
  end loop;
  v_hole := cc.bjm_draw(v_tid);
  update cc.bjm_tables set dealer = array[v_up, v_hole], revealed = false where id = v_tid;
  -- naturals stand; the dealer peeks under an ace or a ten
  update cc.bjm_seats set hands = jsonb_set(hands, '{0,d}', 'true') where table_id = v_tid and bet > 0 and cc.bj_is_bj(cc.bjm_cards(hands -> 0));
  if cc.bj_val(v_up) >= 10 and cc.bj_is_bj(array[v_up, v_hole]) then
    perform cc.bjm_settle(v_tid);
  else
    perform cc.bjm_advance(v_tid);
  end if;
end $$;

-- The hand in turn stands (the player chose to, ran out of time, or left).
create or replace function cc.bjm_stand(v_tid uuid) returns void language plpgsql volatile set search_path = '' as $$
declare t cc.bjm_tables;
begin
  select * into t from cc.bjm_tables where id = v_tid;
  update cc.bjm_seats set hands = jsonb_set(hands, array[active::text, 'd'], 'true') where table_id = v_tid and seat = t.turn;
  perform cc.bjm_advance(v_tid);
end $$;

-- Clear the table for the next round: leavers and quiet seats go, the shoe reshuffles past the cut.
create or replace function cc.bjm_reset(v_tid uuid) returns void language plpgsql volatile set search_path = '' as $$
begin
  delete from cc.bjm_seats where table_id = v_tid and (leaving or seen_at < clock_timestamp() - interval '40 seconds');
  update cc.bjm_seats set bet = 0, wagered = 0, hands = '[]', active = 0, result = null, payout = null, entry = null where table_id = v_tid;
  update cc.bjm_tables set phase = 'idle', round = round + 1, dealer = '{}', revealed = false, turn = null, deadline = null,
    shoe = case when coalesce(array_length(shoe, 1), 0) < cut then cc.bjm_new_shoe() else shoe end,
    cut = case when coalesce(array_length(shoe, 1), 0) < cut then floor(312 * (0.2 + cc.randint(1000) / 10000.0))::integer else cut end
   where id = v_tid;
end $$;

-- Move a table along to now: close betting, time out turns, finish rounds.
create or replace function cc.bjm_tick(v_tid uuid) returns cc.bjm_tables language plpgsql volatile set search_path = '' as $$
declare t cc.bjm_tables; v_n integer; v_in integer; v_away boolean;
begin
  for v_guard in 1 .. 40 loop
    select * into t from cc.bjm_tables where id = v_tid for update;
    if not found then return null; end if;
    if t.phase = 'idle' then
      delete from cc.bjm_seats where table_id = v_tid and (leaving or seen_at < clock_timestamp() - interval '40 seconds');
      exit;
    elsif t.phase = 'betting' then
      delete from cc.bjm_seats where table_id = v_tid and bet = 0 and (leaving or seen_at < clock_timestamp() - interval '40 seconds');
      select count(*), count(*) filter (where bet > 0) into v_n, v_in from cc.bjm_seats where table_id = v_tid and not leaving;
      if v_in = 0 and not exists (select 1 from cc.bjm_seats where table_id = v_tid and bet > 0) then
        update cc.bjm_tables set phase = 'idle', deadline = null where id = v_tid;
        exit;
      end if;
      if clock_timestamp() >= t.deadline or v_in = v_n then
        perform cc.bjm_deal(v_tid);
        continue;
      end if;
      exit;
    elsif t.phase = 'playing' then
      select leaving or seen_at < clock_timestamp() - interval '15 seconds' into v_away from cc.bjm_seats where table_id = v_tid and seat = t.turn;
      if v_away is null then
        perform cc.bjm_advance(v_tid);
        continue;
      end if;
      if clock_timestamp() >= t.deadline or v_away then
        perform cc.bjm_stand(v_tid);
        continue;
      end if;
      exit;
    else
      if clock_timestamp() >= t.deadline then
        perform cc.bjm_reset(v_tid);
        continue;
      end if;
      exit;
    end if;
  end loop;
  select * into t from cc.bjm_tables where id = v_tid;
  return t;
end $$;

-- What a player at (or looking at) the table sees: the hole card stays hidden until the dealer plays.
create or replace function cc.bjm_view(v_tid uuid, v_viewer uuid) returns jsonb language plpgsql stable set search_path = '' as $$
declare
  t cc.bjm_tables; v_seats jsonb := '[]'; s record; v_hands jsonb; v_h jsonb; v_cards text[]; v_tot integer[];
  v_can jsonb := jsonb_build_object('hit', false, 'stand', false, 'double', false, 'split', false);
  v_bal numeric; v_me integer; v_dealer jsonb; v_left integer;
begin
  select * into t from cc.bjm_tables where id = v_tid;
  if not found then return null; end if;
  select balance into v_bal from cc.players where id = v_viewer;
  for v_i in 0 .. 4 loop
    select st.*, p.username into s from cc.bjm_seats st join cc.players p on p.id = st.player_id where st.table_id = v_tid and st.seat = v_i;
    if not found then
      v_seats := v_seats || 'null'::jsonb;
      continue;
    end if;
    v_hands := '[]';
    for v_j in 0 .. jsonb_array_length(s.hands) - 1 loop
      v_h := s.hands -> v_j;
      v_cards := cc.bjm_cards(v_h);
      v_tot := cc.bj_total(v_cards);
      v_hands := v_hands || jsonb_build_object('cards', to_jsonb(v_cards), 'total', v_tot[1], 'soft', v_tot[2] = 1,
        'bet', (v_h ->> 'b')::numeric, 'done', coalesce((v_h ->> 'd')::boolean, false), 'doubled', coalesce((v_h ->> 'x')::boolean, false));
    end loop;
    if s.player_id = v_viewer then
      v_me := v_i;
      if t.phase = 'playing' and t.turn = v_i then
        v_h := s.hands -> s.active;
        v_cards := cc.bjm_cards(v_h);
        v_tot := cc.bj_total(v_cards);
        v_can := jsonb_build_object('hit', v_tot[1] < 21, 'stand', true,
          'double', array_length(v_cards, 1) = 2 and v_tot[1] < 21 and v_bal >= (v_h ->> 'b')::numeric,
          'split', jsonb_array_length(s.hands) = 1 and array_length(v_cards, 1) = 2 and cc.bj_val(v_cards[1]) = cc.bj_val(v_cards[2])
            and v_bal >= (v_h ->> 'b')::numeric);
      end if;
    end if;
    v_seats := v_seats || jsonb_build_object('seat', v_i, 'name', s.username, 'me', s.player_id = v_viewer, 'bet', s.bet, 'wagered', s.wagered,
      'hands', v_hands, 'active', s.active, 'result', s.result, 'payout', s.payout,
      'entry', case when s.player_id = v_viewer then s.entry end, 'leaving', s.leaving,
      'away', s.seen_at < clock_timestamp() - interval '15 seconds');
  end loop;
  v_dealer := case when t.phase in ('idle', 'betting') or coalesce(array_length(t.dealer, 1), 0) = 0 then '[]'::jsonb
    when t.revealed then to_jsonb(t.dealer) else jsonb_build_array(t.dealer[1], '??') end;
  v_left := coalesce(array_length(t.shoe, 1), 0);
  return jsonb_build_object('id', t.id, 'name', t.name, 'phase', t.phase, 'round', t.round, 'turn', t.turn,
    'deadline', floor(extract(epoch from t.deadline) * 1000), 'dealer', v_dealer,
    'dealer_total', case when jsonb_array_length(v_dealer) = 0 then null when t.revealed then (cc.bj_total(t.dealer))[1] else cc.bj_val(t.dealer[1]) end,
    'seats', v_seats, 'me', v_me, 'can', v_can, 'decks_left', round(v_left / 52.0, 1));
end $$;

create or replace function cc.bjm_reply(v_tid uuid, v_pid uuid) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('ok', true, 'table', cc.bjm_view(v_tid, v_pid), 'balance', p.balance, 'seq', p.seq,
    'server_now', floor(extract(epoch from clock_timestamp()) * 1000)) from cc.players p where p.id = v_pid
$$;

-- Tables with seats, and the one you sit at. Empty tables close.
create or replace function public.cc_bjm_lobby(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_pid uuid := cc.auth(p_token); v_list jsonb; v_mine uuid; v_id uuid; v_p cc.players;
begin
  if v_pid is null then return cc.err('auth'); end if;
  for v_id in select id from cc.bjm_tables order by created_at limit 30 loop
    perform cc.bjm_tick(v_id);
  end loop;
  delete from cc.bjm_tables t where not exists (select 1 from cc.bjm_seats where table_id = t.id) and t.created_at < clock_timestamp() - interval '1 minute';
  select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'phase', t.phase,
    'players', (select count(*) from cc.bjm_seats where table_id = t.id),
    'names', (select coalesce(jsonb_agg(p.username order by s.seat), '[]') from cc.bjm_seats s join cc.players p on p.id = s.player_id where s.table_id = t.id))
    order by t.created_at) into v_list from cc.bjm_tables t;
  select table_id into v_mine from cc.bjm_seats where player_id = v_pid;
  select * into v_p from cc.players where id = v_pid;
  return jsonb_build_object('ok', true, 'tables', coalesce(v_list, '[]'), 'mine', v_mine, 'balance', v_p.balance, 'seq', v_p.seq,
    'server_now', floor(extract(epoch from clock_timestamp()) * 1000));
end $$;

-- Sit down: at p_table, or (null) at the busiest table with a free seat, or a new table.
create or replace function public.cc_bjm_join(p_token text, p_table uuid default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_pid uuid := cc.auth(p_token); s cc.bjm_seats; v_tid uuid; v_seat integer; v_n integer;
  v_names text[] := array['Velvet', 'Midnight', 'Neon', 'Ace High', 'Gold Rush', 'Jade', 'Ruby', 'Lucky Seven'];
begin
  if v_pid is null then return cc.err('auth'); end if;
  select * into s from cc.bjm_seats where player_id = v_pid;
  if found then
    if p_table is null or s.table_id = p_table then
      update cc.bjm_seats set seen_at = clock_timestamp(), leaving = false where player_id = v_pid;
      perform cc.bjm_tick(s.table_id);
      return cc.bjm_reply(s.table_id, v_pid);
    end if;
    if s.bet > 0 then return cc.err('table_active', jsonb_build_object('table_id', s.table_id)); end if;
    delete from cc.bjm_seats where player_id = v_pid;
  end if;
  if p_table is null then
    select t.id into v_tid from cc.bjm_tables t
     where (select count(*) from cc.bjm_seats where table_id = t.id) < 5
     order by (select count(*) from cc.bjm_seats where table_id = t.id) desc, t.created_at limit 1;
    if v_tid is null then
      select count(*) into v_n from cc.bjm_tables;
      if v_n >= 40 then return cc.err('tables_full'); end if;
      insert into cc.bjm_tables (name, shoe, cut) values (v_names[1 + v_n % 8] || ' ' || (1 + v_n), cc.bjm_new_shoe(),
        floor(312 * (0.2 + cc.randint(1000) / 10000.0))::integer) returning id into v_tid;
    end if;
  else
    v_tid := p_table;
  end if;
  perform 1 from cc.bjm_tables where id = v_tid for update;
  if not found then return cc.err('table_missing'); end if;
  select min(g) into v_seat from generate_series(0, 4) g where g not in (select seat from cc.bjm_seats where table_id = v_tid);
  if v_seat is null then return cc.err('table_full'); end if;
  insert into cc.bjm_seats (table_id, seat, player_id) values (v_tid, v_seat, v_pid);
  perform cc.bjm_tick(v_tid);
  return cc.bjm_reply(v_tid, v_pid);
end $$;

-- Poll: keeps your seat and moves the table along.
create or replace function public.cc_bjm_state(p_token text, p_table uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_pid uuid := cc.auth(p_token); t cc.bjm_tables;
begin
  if v_pid is null then return cc.err('auth'); end if;
  update cc.bjm_seats set seen_at = clock_timestamp() where player_id = v_pid and table_id = p_table;
  t := cc.bjm_tick(p_table);
  if t.id is null then return cc.err('table_missing'); end if;
  return cc.bjm_reply(p_table, v_pid);
end $$;

create or replace function public.cc_bjm_bet(p_token text, p_table uuid, p_bet numeric) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_pid uuid := cc.auth(p_token); t cc.bjm_tables; s cc.bjm_seats; v_bal numeric;
begin
  if v_pid is null then return cc.err('auth'); end if;
  update cc.bjm_seats set seen_at = clock_timestamp() where player_id = v_pid and table_id = p_table;
  t := cc.bjm_tick(p_table);
  if t.id is null then return cc.err('table_missing'); end if;
  select * into s from cc.bjm_seats where table_id = p_table and player_id = v_pid;
  if not found then return cc.err('not_seated'); end if;
  -- A bet already in this round (a retried call) just returns the table; results still
  -- showing from the last round mean waiting for the next.
  if t.phase = 'done' then return cc.err('round_active'); end if;
  if s.bet > 0 then return cc.bjm_reply(p_table, v_pid); end if;
  if t.phase <> 'idle' and t.phase <> 'betting' then return cc.err('round_active'); end if;
  if not cc.valid_bet(p_bet) then return cc.err('bad_bet'); end if;
  select balance into v_bal from cc.players where id = v_pid for update;
  if v_bal < p_bet then return cc.err('funds'); end if;
  perform cc.move(v_pid, -p_bet);
  update cc.bjm_seats set bet = p_bet, wagered = p_bet, leaving = false where table_id = p_table and player_id = v_pid;
  if t.phase = 'idle' then
    update cc.bjm_tables set phase = 'betting', deadline = clock_timestamp() + interval '15 seconds' where id = p_table;
  end if;
  perform cc.bjm_tick(p_table);
  return cc.bjm_reply(p_table, v_pid);
end $$;

create or replace function public.cc_bjm_act(p_token text, p_table uuid, p_action text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_pid uuid := cc.auth(p_token); t cc.bjm_tables; s cc.bjm_seats; v_h jsonb; v_cards text[]; v_b numeric; v_tot integer;
  v_bal numeric; v_c text; v_c2 text; v_aces boolean; v_path text[];
begin
  if v_pid is null then return cc.err('auth'); end if;
  update cc.bjm_seats set seen_at = clock_timestamp() where player_id = v_pid and table_id = p_table;
  t := cc.bjm_tick(p_table);
  if t.id is null then return cc.err('table_missing'); end if;
  select * into s from cc.bjm_seats where table_id = p_table and player_id = v_pid;
  if not found then return cc.err('not_seated'); end if;
  if t.phase <> 'playing' or t.turn is distinct from s.seat then return cc.err('not_your_turn') || jsonb_build_object('table', cc.bjm_view(p_table, v_pid)); end if;
  v_h := s.hands -> s.active;
  v_cards := cc.bjm_cards(v_h);
  v_b := (v_h ->> 'b')::numeric;
  v_tot := (cc.bj_total(v_cards))[1];
  v_path := array[s.active::text];
  if p_action = 'hit' then
    if v_tot >= 21 then return cc.err('bad_action'); end if;
    v_cards := v_cards || cc.bjm_draw(p_table);
    update cc.bjm_seats set hands = jsonb_set(jsonb_set(hands, v_path || 'c'::text, to_jsonb(v_cards)), v_path || 'd'::text,
      to_jsonb((cc.bj_total(v_cards))[1] >= 21)) where table_id = p_table and seat = s.seat;
  elsif p_action = 'stand' then
    update cc.bjm_seats set hands = jsonb_set(hands, v_path || 'd'::text, 'true') where table_id = p_table and seat = s.seat;
  elsif p_action = 'double' then
    select balance into v_bal from cc.players where id = v_pid for update;
    if array_length(v_cards, 1) <> 2 or v_tot >= 21 or v_bal < v_b then return cc.err(case when v_bal < v_b then 'funds' else 'bad_action' end); end if;
    perform cc.move(v_pid, -v_b);
    v_cards := v_cards || cc.bjm_draw(p_table);
    update cc.bjm_seats set wagered = wagered + v_b,
      hands = jsonb_set(hands, v_path, jsonb_build_object('c', to_jsonb(v_cards), 'b', v_b * 2, 'd', true, 'x', true))
     where table_id = p_table and seat = s.seat;
  elsif p_action = 'split' then
    select balance into v_bal from cc.players where id = v_pid for update;
    if jsonb_array_length(s.hands) <> 1 or array_length(v_cards, 1) <> 2 or cc.bj_val(v_cards[1]) <> cc.bj_val(v_cards[2]) or v_bal < v_b then
      return cc.err(case when v_bal < v_b then 'funds' else 'bad_action' end);
    end if;
    perform cc.move(v_pid, -v_b);
    v_aces := left(v_cards[1], length(v_cards[1]) - 1) = 'A';
    v_c := cc.bjm_draw(p_table);
    v_c2 := cc.bjm_draw(p_table);
    update cc.bjm_seats set wagered = wagered + v_b, active = 0, hands = jsonb_build_array(
      jsonb_build_object('c', jsonb_build_array(v_cards[1], v_c), 'b', v_b, 'x', false, 'd', v_aces or (cc.bj_total(array[v_cards[1], v_c]))[1] = 21),
      jsonb_build_object('c', jsonb_build_array(v_cards[2], v_c2), 'b', v_b, 'x', false, 'd', v_aces or (cc.bj_total(array[v_cards[2], v_c2]))[1] = 21))
     where table_id = p_table and seat = s.seat;
  else
    return cc.err('bad_action');
  end if;
  perform cc.bjm_advance(p_table);
  perform cc.bjm_tick(p_table);
  return cc.bjm_reply(p_table, v_pid);
end $$;

-- Stand up. Before the cards come out a placed bet is returned; mid-hand the hand plays out
-- (its turns stand) and pays as usual, and the seat frees up after the round.
create or replace function public.cc_bjm_leave(p_token text, p_table uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_pid uuid := cc.auth(p_token); t cc.bjm_tables; s cc.bjm_seats; v_p cc.players;
begin
  if v_pid is null then return cc.err('auth'); end if;
  t := cc.bjm_tick(p_table);
  select * into s from cc.bjm_seats where table_id = p_table and player_id = v_pid;
  if found then
    if s.bet = 0 or t.phase = 'idle' then
      delete from cc.bjm_seats where table_id = p_table and player_id = v_pid;
    elsif t.phase = 'betting' then
      perform 1 from cc.players where id = v_pid for update;
      perform cc.move(v_pid, s.bet);
      delete from cc.bjm_seats where table_id = p_table and player_id = v_pid;
    else
      update cc.bjm_seats set leaving = true where table_id = p_table and player_id = v_pid;
    end if;
    perform cc.bjm_tick(p_table);
  end if;
  delete from cc.bjm_tables x where x.id = p_table and not exists (select 1 from cc.bjm_seats where table_id = p_table);
  select * into v_p from cc.players where id = v_pid;
  return jsonb_build_object('ok', true, 'balance', v_p.balance, 'seq', v_p.seq);
end $$;

do $$ declare f text;
begin
  foreach f in array array['cc_duel_create(text,text,numeric)', 'cc_duel_join(text,uuid,numeric)', 'cc_duel_finish(text,uuid,jsonb)',
    'cc_duel_get(text,uuid)', 'cc_duel_list(text,text)', 'cc_bjm_lobby(text)', 'cc_bjm_join(text,uuid)', 'cc_bjm_state(text,uuid)',
    'cc_bjm_bet(text,uuid,numeric)', 'cc_bjm_act(text,uuid,text)', 'cc_bjm_leave(text,uuid)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
