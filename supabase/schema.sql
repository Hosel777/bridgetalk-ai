create table if not exists public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  plan text not null default 'free_trial'
    check (plan in ('free_trial', 'pro')),
  paddle_customer_id text,
  paddle_subscription_id text,
  minutes_used integer not null default 0 check (minutes_used >= 0),
  minutes_limit integer not null default 15 check (minutes_limit >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.learning_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  vocabulary_gaps jsonb not null default '[]'::jsonb,
  direct_count integer not null default 0 check (direct_count >= 0),
  assisted_count integer not null default 0 check (assisted_count >= 0),
  independence_score integer not null default 0
    check (independence_score between 0 and 100),
  updated_at timestamptz not null default now()
);

create or replace function public.create_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do update
    set email = excluded.email, updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email on auth.users
  for each row execute function public.create_user_profile();

insert into public.user_profiles (id, email)
select id, coalesce(email, '')
from auth.users
on conflict (id) do update
  set email = excluded.email, updated_at = now();

create or replace function public.record_audio_minutes(
  p_user_id uuid,
  p_minutes integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_minutes <= 0 then
    raise exception 'p_minutes must be positive';
  end if;

  update public.user_profiles
  set minutes_used = minutes_used + p_minutes,
      updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'user profile not found';
  end if;
end;
$$;

create or replace function public.activate_pro_for_paddle(
  p_user_id uuid,
  p_email text,
  p_customer_id text,
  p_subscription_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.user_profiles
  set plan = 'pro',
      minutes_limit = 900,
      paddle_customer_id = p_customer_id,
      paddle_subscription_id = p_subscription_id,
      updated_at = now()
  where id = p_user_id
    and (
      (p_email is not null and lower(email) = lower(p_email))
      or (p_email is null and paddle_customer_id = p_customer_id)
    );

  return found;
end;
$$;

alter table public.user_profiles enable row level security;
alter table public.learning_progress enable row level security;

revoke all on public.user_profiles from anon, authenticated;
revoke all on public.learning_progress from anon, authenticated;
grant select on public.user_profiles to authenticated;
grant select on public.learning_progress to authenticated;

drop policy if exists "Users can read their own profile" on public.user_profiles;
create policy "Users can read their own profile"
  on public.user_profiles for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Users can read their own learning progress" on public.learning_progress;
create policy "Users can read their own learning progress"
  on public.learning_progress for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on function public.create_user_profile() from public, anon, authenticated;
revoke all on function public.record_audio_minutes(uuid, integer) from public, anon, authenticated;
revoke all on function public.activate_pro_for_paddle(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_audio_minutes(uuid, integer) to service_role;
grant execute on function public.activate_pro_for_paddle(uuid, text, text, text) to service_role;
