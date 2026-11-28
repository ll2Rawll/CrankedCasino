-- Shared Blackjack: consistent table-before-seat locking and concurrent join safety.
-- Apply to an existing casino after multiplayer.sql. No balances or game rules change.
begin;

create or replace function public.cc_bjm_lobby(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_pid uuid := cc.auth(p_token); v_list jsonb; v_mine uuid; v_id uuid; v_p cc.players;
begin
  if v_pid is null then return cc.err('auth'); end if;
  -- All table locks use the same order as a player switching tables.
  for v_id in select id from cc.bjm_tables order by id loop
    perform cc.bjm_tick(v_id);
  end loop;
  delete from cc.bjm_tables t where not exists (select 1 from cc.bjm_seats where table_id = t.id) and t.created_at < clock_timestamp() - interval '1 minute';
  select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'phase', t.phase,
    'players', (select count(*) from cc.bjm_seats where table_id = t.id),
    'names', (select coalesce(jsonb_agg(p.username order by s.seat), '[]') from cc.bjm_seats s join cc.players p on p.id = s.player_id where s.table_id = t.id))
    order by t.created_at) into v_list from cc.bjm_tables t;
  -- A departing hand still settles, but the lobby must not auto-rejoin it.
  select table_id into v_mine from cc.bjm_seats where player_id = v_pid and not leaving;
  select * into v_p from cc.players where id = v_pid;
  return jsonb_build_object('ok', true, 'tables', coalesce(v_list, '[]'), 'mine', v_mine, 'balance', v_p.balance, 'seq', v_p.seq,
    'server_now', floor(extract(epoch from clock_timestamp()) * 1000));
end $$;

create or replace function public.cc_bjm_join(p_token text, p_table uuid default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_pid uuid := cc.auth(p_token); s cc.bjm_seats; v_tid uuid; v_seat integer; v_n integer;
  v_names text[] := array['Velvet', 'Midnight', 'Neon', 'Ace High', 'Gold Rush', 'Jade', 'Ruby', 'Lucky Seven'];
begin
  if v_pid is null then return cc.err('auth'); end if;
  -- Joining from two tabs must reserve one seat, not race the unique constraint.
  perform pg_advisory_xact_lock(hashtextextended('cc:bjm-seat:' || v_pid::text, 0));
  select * into s from cc.bjm_seats where player_id = v_pid;
  if found then
    -- Always lock tables before seats; lock both in order when switching.
    perform 1 from cc.bjm_tables where id = s.table_id or id = p_table order by id for update;
    select * into s from cc.bjm_seats where player_id = v_pid;
  end if;
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

create or replace function public.cc_bjm_state(p_token text, p_table uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_pid uuid := cc.auth(p_token); t cc.bjm_tables;
begin
  if v_pid is null then return cc.err('auth'); end if;
  perform 1 from cc.bjm_tables where id = p_table for update;
  if not found then return cc.err('table_missing'); end if;
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
  perform 1 from cc.bjm_tables where id = p_table for update;
  if not found then return cc.err('table_missing'); end if;
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
  perform 1 from cc.bjm_tables where id = p_table for update;
  if not found then return cc.err('table_missing'); end if;
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

create or replace function public.cc_bjm_leave(p_token text, p_table uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_pid uuid := cc.auth(p_token); t cc.bjm_tables; s cc.bjm_seats; v_p cc.players;
begin
  if v_pid is null then return cc.err('auth'); end if;
  perform pg_advisory_xact_lock(hashtextextended('cc:bjm-seat:' || v_pid::text, 0));
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

notify pgrst, 'reload schema';
commit;
