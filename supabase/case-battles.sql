-- Run after schema.sql. Additive and safe to reapply to an existing casino.
begin;

create table if not exists cc.case_battles (
  id uuid primary key,
  host_id uuid not null references cc.players(id),
  guest_id uuid references cc.players(id),
  visibility text not null check (visibility in ('public', 'private', 'bot')),
  state text not null check (state in ('waiting', 'running', 'complete', 'cancelled')),
  cases text[] not null check (cardinality(cases) = 3),
  pulls jsonb,
  totals integer[],
  receipts jsonb,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp() + interval '10 minutes',
  started_at timestamptz,
  cancel_reason text,
  check (guest_id is null or guest_id <> host_id)
);
create index if not exists case_battles_host on cc.case_battles(host_id, created_at desc);
create index if not exists case_battles_guest on cc.case_battles(guest_id, created_at desc);
create index if not exists case_battles_lobby on cc.case_battles(created_at desc) where state = 'waiting' and visibility = 'public';
alter table cc.case_battles enable row level security;
-- Defaults preserve all existing 50-chip battles, including in-flight rooms.
alter table cc.case_battles add column if not exists host_bet numeric not null default 50 check (cc.valid_bet(host_bet));
alter table cc.case_battles add column if not exists guest_bet numeric not null default 50 check (cc.valid_bet(guest_bet));

create or replace function cc.case_valid(ids text[]) returns boolean
language sql immutable set search_path = '' as $$
  select ids is not null and cardinality(ids) = 3 and array_position(ids, null) is null
    and ids <@ array['after-hours','neon-vault','high-roller','dragonheart','starfall','leviathan']::text[]
$$;

create or replace function cc.case_draw(case_id text) returns integer
language plpgsql volatile set search_path = '' as $$
declare weights integer[]; roll double precision := cc.rand() * 100; i integer;
begin
  weights := case case_id when 'after-hours' then array[50,25,12,8,4,1]
    when 'neon-vault' then array[25,40,20,10,4,1] when 'high-roller' then array[75,5,5,5,7,3]
    when 'dragonheart' then array[75,5,5,5,7,3] when 'starfall' then array[25,40,20,10,4,1]
    when 'leviathan' then array[50,25,12,8,4,1] end;
  if weights is null then raise exception 'Unknown case'; end if;
  for i in 1..6 loop
    roll := roll - weights[i];
    if roll < 0 then return i - 1; end if;
  end loop;
  return 5;
end $$;

create or replace function cc.case_roll(ids text[]) returns jsonb
language plpgsql volatile set search_path = '' as $$
declare result jsonb := '[]'; case_id text;
begin
  foreach case_id in array ids loop
    result := result || jsonb_build_array(jsonb_build_array(cc.case_draw(case_id), cc.case_draw(case_id)));
  end loop;
  return result;
end $$;

-- All operations acquire the battle before account locks, with accounts ordered
-- by ID. The locked state is the idempotency guard for refunds and settlement.
create or replace function cc.case_resolve(battle_id uuid) returns void
language plpgsql volatile set search_path = '' as $$
declare b cc.case_battles; scores integer[] := array[0,0]; values integer[] := array[8,24,48,65,110,220];
  i integer; side integer; pid uuid; stake numeric; pay numeric; receipt jsonb; result_receipts jsonb := '[]';
begin
  select * into b from cc.case_battles where id = battle_id for update;
  if not found then return; end if;
  if b.state = 'waiting' and b.expires_at <= clock_timestamp() then
    perform 1 from cc.players where id = b.host_id for update;
    perform cc.move(b.host_id, b.host_bet);
    update cc.case_battles set state = 'cancelled', cancel_reason = 'expired' where id = b.id;
    return;
  end if;
  if b.state <> 'running' or clock_timestamp() < b.started_at + interval '18.6 seconds' then return; end if;
  perform 1 from cc.players where id in (b.host_id, b.guest_id) order by id for update;
  for i in 0..2 loop
    for side in 0..1 loop
      scores[side+1] := scores[side+1] + values[(b.pulls -> i ->> side)::integer + 1];
    end loop;
  end loop;
  for side in 0..1 loop
    pid := case side when 0 then b.host_id else b.guest_id end;
    if pid is null then result_receipts := result_receipts || '[null]'::jsonb; continue; end if;
    stake := case side when 0 then b.host_bet else b.guest_bet end;
    pay := case when scores[1] = scores[2] then stake when scores[side+1] > scores[2-side] then b.host_bet + b.guest_bet else 0 end;
    perform cc.move(pid, pay);
    receipt := cc.record(pid, 'cases', stake, pay,
      '3 cases · ' || scores[side+1] || ' to ' || scores[2-side] || case when b.visibility = 'bot' then ' · bot battle' else '' end);
    result_receipts := result_receipts || jsonb_build_array(receipt);
  end loop;
  update cc.case_battles set state = 'complete', totals = scores, receipts = result_receipts where id = b.id;
end $$;

create or replace function cc.case_reconcile(pid uuid) returns void
language plpgsql volatile set search_path = '' as $$
declare bid uuid;
begin
  for bid in select id from cc.case_battles where (host_id = pid or guest_id = pid)
    and state in ('waiting','running') order by id loop
    perform cc.case_resolve(bid);
  end loop;
end $$;

create or replace function cc.case_view(b cc.case_battles, viewer uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare seat integer := case when viewer = b.host_id then 0 when viewer = b.guest_id then 1 else -1 end;
  visible_pulls jsonb := '[]'; i integer; host_name text; guest_name text;
begin
  select username into host_name from cc.players where id = b.host_id;
  select username into guest_name from cc.players where id = b.guest_id;
  for i in 0..2 loop
    visible_pulls := visible_pulls || jsonb_build_array(case when b.started_at is not null
      and clock_timestamp() >= b.started_at + i * interval '6.2 seconds' then b.pulls -> i else null end);
  end loop;
  return jsonb_build_object(
    'id', b.id, 'state', b.state, 'visibility', b.visibility, 'cases', b.cases,
    'entry', case when seat = 1 then b.guest_bet else b.host_bet end,
    'entries', jsonb_build_array(b.host_bet, case when b.guest_id is not null or b.visibility = 'bot' then b.guest_bet else null end),
    'pot', b.host_bet + case when b.guest_id is not null or b.visibility = 'bot' then b.guest_bet else 0 end,
    'created', floor(extract(epoch from b.created_at)*1000), 'expires', floor(extract(epoch from b.expires_at)*1000),
    'started', floor(extract(epoch from b.started_at)*1000), 'seat', seat,
    'players', jsonb_build_array(jsonb_build_object('name', host_name, 'bot', false),
      case when guest_name is not null or b.visibility = 'bot' then
        jsonb_build_object('name', coalesce(guest_name,'Rook'), 'bot', b.visibility = 'bot') else null end),
    'pulls', visible_pulls, 'totals', b.totals, 'cancel_reason', b.cancel_reason,
    'payout', case when b.state = 'complete' and seat >= 0 then (b.receipts -> seat ->> 'p')::numeric else null end,
    'receipt', case when b.state = 'complete' and seat >= 0 then b.receipts -> seat else null end);
end $$;

create or replace function cc.case_reply(b cc.case_battles, pid uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('ok', true, 'battle', cc.case_view(b,pid), 'balance', p.balance, 'seq', p.seq,
    'server_now', floor(extract(epoch from clock_timestamp())*1000)) from cc.players p where id = pid
$$;

create or replace function public.cc_cases_create(p_token text, p_request_id uuid, p_cases text[], p_visibility text, p_bet numeric default 50) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare pid uuid := cc.auth(p_token); p cc.players; b cc.case_battles; active uuid;
begin
  if pid is null then return cc.err('auth'); end if;
  if p_request_id is null or not cc.case_valid(p_cases) or p_visibility is null or p_visibility not in ('public','private','bot') then return cc.err('bad_cases'); end if;
  perform cc.case_reconcile(pid);
  select * into p from cc.players where id = pid for update;
  select * into b from cc.case_battles where id = p_request_id;
  if found then
    if b.host_id <> pid then return cc.err('bad_request'); end if;
    return cc.case_reply(b,pid);
  end if;
  select id into active from cc.case_battles where (host_id = pid or guest_id = pid) and state in ('waiting','running') limit 1;
  if found then return cc.err('battle_active', jsonb_build_object('battle_id',active)); end if;
  if not cc.valid_bet(p_bet) then return cc.err('bad_bet'); end if;
  if p.balance < p_bet then return cc.err('funds'); end if;
  insert into cc.case_battles(id,host_id,visibility,state,cases,host_bet,guest_bet,started_at,pulls) values
    (p_request_id,pid,p_visibility,case when p_visibility = 'bot' then 'running' else 'waiting' end,p_cases,p_bet,p_bet,
     case when p_visibility = 'bot' then clock_timestamp() + interval '3 seconds' else null end,
     case when p_visibility = 'bot' then cc.case_roll(p_cases) else null end) returning * into b;
  perform cc.move(pid,-p_bet);
  return cc.case_reply(b,pid);
end $$;

create or replace function public.cc_cases_join(p_token text, p_id uuid, p_bet numeric default 50) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare pid uuid := cc.auth(p_token); b cc.case_battles; balance numeric; active uuid;
begin
  if pid is null then return cc.err('auth'); end if;
  perform cc.case_resolve(p_id);
  select * into b from cc.case_battles where id = p_id for update;
  if not found then return cc.err('battle_missing'); end if;
  if pid in (b.host_id,b.guest_id) then return cc.case_reply(b,pid); end if;
  if b.state <> 'waiting' then return cc.err('battle_full'); end if;
  perform 1 from cc.players where id in (b.host_id,pid) order by id for update;
  select id into active from cc.case_battles where (host_id = pid or guest_id = pid) and state in ('waiting','running') limit 1;
  if found then return cc.err('battle_active',jsonb_build_object('battle_id',active)); end if;
  select p.balance into balance from cc.players p where id = pid;
  if not cc.valid_bet(p_bet) then return cc.err('bad_bet'); end if;
  if balance < p_bet then return cc.err('funds'); end if;
  perform cc.move(pid,-p_bet);
  update cc.case_battles set guest_id = pid, guest_bet = p_bet, state = 'running', started_at = clock_timestamp() + interval '3 seconds',
    pulls = cc.case_roll(cases) where id = b.id returning * into b;
  return cc.case_reply(b,pid);
end $$;

create or replace function public.cc_cases_get(p_token text, p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare pid uuid := cc.auth(p_token); b cc.case_battles;
begin
  if pid is null then return cc.err('auth'); end if;
  select * into b from cc.case_battles where id = p_id;
  if not found or (b.visibility <> 'public' and b.state <> 'waiting' and pid <> b.host_id and pid is distinct from b.guest_id) then return cc.err('battle_missing'); end if;
  perform cc.case_resolve(p_id);
  select * into b from cc.case_battles where id = p_id;
  return cc.case_reply(b,pid);
end $$;

create or replace function public.cc_cases_cancel(p_token text, p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare pid uuid := cc.auth(p_token); b cc.case_battles;
begin
  if pid is null then return cc.err('auth'); end if;
  select * into b from cc.case_battles where id = p_id for update;
  if not found or b.host_id <> pid then return cc.err('battle_missing'); end if;
  if b.state = 'cancelled' then return cc.case_reply(b,pid); end if;
  if b.state <> 'waiting' then return cc.err('battle_started'); end if;
  perform 1 from cc.players where id = pid for update;
  perform cc.move(pid,b.host_bet);
  update cc.case_battles set state = 'cancelled', cancel_reason = 'host' where id = b.id returning * into b;
  return cc.case_reply(b,pid);
end $$;

create or replace function public.cc_cases_list(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare pid uuid := cc.auth(p_token); bid uuid; rooms jsonb; recent jsonb; active uuid; p cc.players;
begin
  if pid is null then return cc.err('auth'); end if;
  perform cc.case_reconcile(pid);
  select jsonb_agg(cc.case_view(b,pid) order by b.created_at desc) into rooms from
    (select * from cc.case_battles where visibility = 'public' and state = 'waiting' and expires_at > clock_timestamp() order by created_at desc limit 30) b;
  select jsonb_agg(cc.case_view(b,pid) order by b.created_at desc) into recent from
    (select * from cc.case_battles where host_id = pid or guest_id = pid order by created_at desc limit 12) b;
  select id into active from cc.case_battles where (host_id = pid or guest_id = pid) and state in ('waiting','running') limit 1;
  select * into p from cc.players where id = pid;
  return jsonb_build_object('ok',true,'rooms',coalesce(rooms,'[]'),'recent',coalesce(recent,'[]'),'active',active,
    'balance',p.balance,'seq',p.seq,'server_now',floor(extract(epoch from clock_timestamp())*1000));
end $$;

-- Remove the old overloads so PostgREST resolves optional wager arguments uniquely.
drop function if exists public.cc_cases_create(text,uuid,text[],text);
drop function if exists public.cc_cases_join(text,uuid);

do $$ declare f text;
begin
  foreach f in array array['cc_cases_create(text,uuid,text[],text,numeric)','cc_cases_join(text,uuid,numeric)',
    'cc_cases_get(text,uuid)','cc_cases_cancel(text,uuid)','cc_cases_list(text)'] loop
    execute format('revoke all on function public.%s from public',f);
    execute format('grant execute on function public.%s to anon, authenticated',f);
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
