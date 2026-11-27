-- ─────────────────────────────────────────────────────────────────────────────
--  CrankedCasino · Supabase schema
--  Paste this whole file into Supabase → SQL Editor → New query → Run.
--  Safe to run again: everything is "create or replace" / "if not exists".
-- ─────────────────────────────────────────────────────────────────────────────

-- One row per GitHub player. `state` holds the full save (stats, history, …).
create table if not exists public.players (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null default 'player',
  avatar_url  text,
  balance     numeric(18, 2) not null default 1000 check (balance >= 0 and balance <= 1000000000000),
  biggest_win numeric(18, 2) not null default 0 check (biggest_win >= 0),
  bets        integer not null default 0 check (bets >= 0),
  state       jsonb not null default '{}'::jsonb check (pg_column_size(state) < 65536),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists players_balance_idx on public.players (balance desc);

-- Row level security: players can only read and write their own row.
alter table public.players enable row level security;

drop policy if exists "players_select_own" on public.players;
create policy "players_select_own" on public.players
  for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "players_insert_own" on public.players;
create policy "players_insert_own" on public.players
  for insert to authenticated with check ((select auth.uid()) = id);

drop policy if exists "players_update_own" on public.players;
create policy "players_update_own" on public.players
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- Username + avatar always come from the GitHub identity, never from the browser.
create or replace function public.players_fill_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb;
begin
  select u.raw_user_meta_data into meta from auth.users u where u.id = new.id;
  new.username   := coalesce(meta ->> 'user_name', meta ->> 'preferred_username', meta ->> 'name', 'player');
  new.avatar_url := meta ->> 'avatar_url';
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists players_fill_identity on public.players;
create trigger players_fill_identity
  before insert or update on public.players
  for each row execute function public.players_fill_identity();

-- Public leaderboard: exposes only username, avatar and numbers.
create or replace function public.leaderboard(lim integer default 25)
returns table (username text, avatar_url text, balance numeric, biggest_win numeric, bets integer, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.username, p.avatar_url, p.balance, p.biggest_win, p.bets, p.updated_at
  from public.players p
  order by p.balance desc, p.updated_at asc
  limit greatest(1, least(coalesce(lim, 25), 100));
$$;

revoke all on function public.leaderboard(integer) from public;
grant execute on function public.leaderboard(integer) to anon, authenticated;
