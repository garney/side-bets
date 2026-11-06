create table if not exists public.blackjack_round_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  mode text not null check (mode in ('live', 'practice')),
  outcome text not null check (outcome in ('win', 'lose', 'push', 'blackjack', 'bust')),
  created_at timestamptz not null default now()
);

create index if not exists blackjack_round_results_mode_user_idx
  on public.blackjack_round_results (mode, user_id);

alter table public.blackjack_round_results enable row level security;

revoke all on table public.blackjack_round_results from anon, authenticated;
