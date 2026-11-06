alter table public.profiles
  add column if not exists experience_points integer not null default 0 check (experience_points >= 0);

create or replace function public.add_experience(p_user_id uuid, p_amount integer)
returns integer
language plpgsql
security definer
as $$
declare
  next_xp integer;
begin
  if p_amount = 0 then
    select experience_points into next_xp from public.profiles where id = p_user_id;
    return coalesce(next_xp, 0);
  end if;
  if p_amount < 0 then
    raise exception 'Experience amount must be positive';
  end if;
  update public.profiles
    set experience_points = experience_points + p_amount,
        updated_at = now()
    where id = p_user_id
    returning experience_points into next_xp;
  if next_xp is null then
    raise exception 'Profile not found';
  end if;
  return next_xp;
end;
$$;

create table if not exists public.xp_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null check (amount > 0),
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists xp_events_user_id_created_at_idx on public.xp_events(user_id, created_at desc);

create table if not exists public.shop_offers (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  xp_cost integer not null check (xp_cost > 0),
  credits_granted numeric(12, 2) not null check (credits_granted > 0),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.xp_events enable row level security;
alter table public.shop_offers enable row level security;

revoke all on table public.xp_events from anon, authenticated;
revoke all on table public.shop_offers from anon, authenticated;
revoke all on function public.add_experience(uuid, integer) from public, anon, authenticated;
