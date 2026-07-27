-- 守中日课｜个人每日管理库
-- Initial production schema: constraints, indexes, triggers, RLS, Storage and Realtime.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at_and_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = timezone('utc', now());
  new.version = old.version + 1;
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text not null default '',
  time_zone text not null default 'Asia/Shanghai',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  version integer not null default 1 check (version > 0)
);

create table public.directions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in (
    'mission', 'vision', 'value', 'life_direction', 'long_term_theme',
    'desired_state', 'not_doing'
  )),
  title text not null check (char_length(title) between 1 and 160),
  content text not null default '',
  sort_order integer not null default 0,
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  version integer not null default 1 check (version > 0)
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_type text not null check (plan_type in ('annual', 'monthly', 'weekly')),
  title text not null check (char_length(title) between 1 and 200),
  objective text not null default '',
  period_start date not null,
  period_end date not null,
  completion_standard text not null default '',
  status text not null default 'draft' check (
    status in ('draft', 'active', 'paused', 'completed', 'archived')
  ),
  parent_id uuid references public.plans(id) on delete restrict,
  direction_id uuid references public.directions(id) on delete restrict,
  progress integer not null default 0 check (progress between 0 and 100),
  notes text not null default '',
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  version integer not null default 1 check (version > 0),
  constraint plans_period_valid check (period_end >= period_start),
  constraint plans_relationship_shape check (
    (plan_type = 'annual' and parent_id is null and direction_id is not null)
    or
    (plan_type in ('monthly', 'weekly') and parent_id is not null and direction_id is null)
  )
);

create or replace function public.validate_plan_hierarchy()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  parent_record public.plans;
  direction_owner uuid;
begin
  if new.plan_type = 'annual' then
    select user_id into direction_owner
    from public.directions
    where id = new.direction_id and deleted_at is null;
    if direction_owner is distinct from new.user_id then
      raise exception 'annual plan direction must belong to the same user';
    end if;
    return new;
  end if;

  select * into parent_record
  from public.plans
  where id = new.parent_id and deleted_at is null;

  if parent_record.id is null or parent_record.user_id is distinct from new.user_id then
    raise exception 'parent plan must belong to the same user';
  end if;

  if new.plan_type = 'monthly' and parent_record.plan_type <> 'annual' then
    raise exception 'monthly plan parent must be annual';
  end if;
  if new.plan_type = 'weekly' and parent_record.plan_type <> 'monthly' then
    raise exception 'weekly plan parent must be monthly';
  end if;
  return new;
end;
$$;

create trigger validate_plans_before_write
before insert or update of plan_type, parent_id, direction_id, user_id
on public.plans
for each row execute function public.validate_plan_hierarchy();

create table public.daily_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null,
  note text not null default '',
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  version integer not null default 1 check (version > 0),
  unique (user_id, entry_date)
);

create table public.daily_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null,
  slot_index smallint not null check (slot_index between 1 and 6),
  title text not null default '' check (char_length(title) <= 200),
  importance text not null default '',
  completion_standard text not null default '',
  first_action text not null default '',
  weekly_plan_id uuid references public.plans(id) on delete set null,
  status text not null default 'not_started' check (
    status in ('not_started', 'in_progress', 'completed', 'not_completed', 'not_scheduled')
  ),
  result text not null default '',
  completed_at timestamptz,
  notes text not null default '',
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  version integer not null default 1 check (version > 0),
  constraint daily_tasks_user_date_slot_unique unique (user_id, entry_date, slot_index)
);

create or replace function public.validate_weekly_plan_link()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  linked_plan public.plans;
begin
  if new.weekly_plan_id is null then
    return new;
  end if;
  select * into linked_plan from public.plans where id = new.weekly_plan_id;
  if linked_plan.id is null
    or linked_plan.user_id is distinct from new.user_id
    or linked_plan.plan_type <> 'weekly'
  then
    raise exception 'daily task may only link to a weekly plan owned by the user';
  end if;
  return new;
end;
$$;

create trigger validate_daily_task_weekly_plan
before insert or update of weekly_plan_id, user_id
on public.daily_tasks
for each row execute function public.validate_weekly_plan_link();

create table public.exercise_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null,
  planned boolean not null default false,
  activity text not null default '',
  planned_minutes integer check (planned_minutes is null or planned_minutes >= 0),
  actual_minutes integer check (actual_minutes is null or actual_minutes >= 0),
  intensity text check (intensity is null or intensity in ('light', 'moderate', 'high')),
  status text not null default 'not_started' check (
    status in ('not_started', 'completed', 'skipped')
  ),
  body_feeling text not null default '',
  notes text not null default '',
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  version integer not null default 1 check (version > 0),
  unique (user_id, entry_date)
);

create table public.meal_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null,
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack')),
  content text not null default '',
  photo_paths text[] not null default '{}',
  hydration_ml integer not null default 0 check (hydration_ml >= 0),
  overall_feeling text not null default '',
  notes text not null default '',
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  version integer not null default 1 check (version > 0),
  unique (user_id, entry_date, meal_type)
);

create table public.accumulation_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  content text not null default '',
  entry_date date not null,
  tags text[] not null default '{}',
  source_task_id uuid references public.daily_tasks(id) on delete set null,
  source_plan_id uuid references public.plans(id) on delete set null,
  attachment_paths text[] not null default '{}',
  reusable_conclusion text not null default '',
  next_use text not null default '',
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  version integer not null default 1 check (version > 0)
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  review_type text not null check (review_type in ('daily', 'weekly', 'monthly', 'annual')),
  period_start date not null,
  period_end date not null,
  content jsonb not null default '{}'::jsonb,
  ai_draft jsonb,
  saved_from_draft boolean not null default false,
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  version integer not null default 1 check (version > 0),
  constraint reviews_period_valid check (period_end >= period_start),
  unique (user_id, review_type, period_start, period_end)
);

create table public.reminder_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  time_zone text not null default 'Asia/Shanghai',
  daily_six_enabled boolean not null default false,
  daily_six_time time not null default '08:00',
  exercise_enabled boolean not null default false,
  exercise_time time not null default '18:00',
  review_enabled boolean not null default false,
  review_time time not null default '21:30',
  last_daily_six_sent date,
  last_exercise_sent date,
  last_review_sent date,
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  version integer not null default 1 check (version > 0)
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  version integer not null default 1 check (version > 0),
  unique (user_id, endpoint)
);

create table public.sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  table_name text not null,
  record_id uuid not null,
  local_data jsonb not null,
  remote_data jsonb not null,
  resolution text not null default 'pending' check (
    resolution in ('pending', 'local', 'remote')
  ),
  resolved_at timestamptz,
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  version integer not null default 1 check (version > 0)
);

-- Lookup, period and synchronization indexes.
create index directions_user_sort_idx on public.directions (user_id, sort_order) where deleted_at is null;
create index plans_user_type_period_idx on public.plans (user_id, plan_type, period_start, period_end) where deleted_at is null;
create index plans_parent_idx on public.plans (parent_id) where deleted_at is null;
create index plans_direction_idx on public.plans (direction_id) where deleted_at is null;
create index daily_tasks_user_date_idx on public.daily_tasks (user_id, entry_date) where deleted_at is null;
create index daily_tasks_weekly_plan_idx on public.daily_tasks (weekly_plan_id) where deleted_at is null;
create index exercise_logs_user_date_idx on public.exercise_logs (user_id, entry_date desc) where deleted_at is null;
create index meal_logs_user_date_idx on public.meal_logs (user_id, entry_date desc) where deleted_at is null;
create index accumulation_user_date_idx on public.accumulation_entries (user_id, entry_date desc) where deleted_at is null;
create index accumulation_tags_idx on public.accumulation_entries using gin (tags);
create index reviews_user_period_idx on public.reviews (user_id, review_type, period_start desc) where deleted_at is null;
create index sync_conflicts_pending_idx on public.sync_conflicts (user_id, resolution) where resolution = 'pending';

-- Apply deterministic update/version behavior to every mutable user table.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'directions', 'plans', 'daily_entries', 'daily_tasks',
    'exercise_logs', 'meal_logs', 'accumulation_entries', 'reviews',
    'reminder_settings', 'push_subscriptions', 'sync_conflicts'
  ]
  loop
    execute format(
      'create trigger set_%I_updated_at_version before update on public.%I for each row execute function public.set_updated_at_and_version()',
      table_name,
      table_name
    );
  end loop;
end;
$$;

-- New-user bootstrap. These are structural defaults, not demo records.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''));

  insert into public.directions (user_id, kind, title, content, sort_order)
  values
    (
      new.id,
      'mission',
      'Mission',
      '帮助我把被即时事务牵引、零散混乱的想法与行动，转化为与长期方向一致、每天可执行、能够持续积累并不断校准的成长轨迹。',
      0
    ),
    (
      new.id,
      'vision',
      'Vision 01',
      '每天打开管理库，我能立即看见今天真正重要的六件事、每件事的完成标准和第一步行动，不再依靠大脑反复提醒，也不再纠结先做什么。',
      1
    ),
    (
      new.id,
      'value',
      'Value',
      '长期真实积累，优先于即时完成感。',
      2
    );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- RLS: every public user-data table is owner-only.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'directions', 'plans', 'daily_entries', 'daily_tasks',
    'exercise_logs', 'meal_logs', 'accumulation_entries', 'reviews',
    'reminder_settings', 'push_subscriptions', 'sync_conflicts'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format(
      'create policy "owner select" on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      table_name
    );
    execute format(
      'create policy "owner insert" on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)',
      table_name
    );
    execute format(
      'create policy "owner update" on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      table_name
    );
    execute format(
      'create policy "owner delete" on public.%I for delete to authenticated using ((select auth.uid()) = user_id)',
      table_name
    );
    execute format(
      'grant select, insert, update, delete on public.%I to authenticated',
      table_name
    );
    execute format('revoke all on public.%I from anon', table_name);
  end loop;
end;
$$;

-- Private file buckets. The first path segment must be the authenticated user id.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'meal-photos',
    'meal-photos',
    false,
    10485760,
    array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
  ),
  (
    'attachments',
    'attachments',
    false,
    26214400,
    null
  )
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "owner reads private files"
on storage.objects for select to authenticated
using (
  bucket_id in ('meal-photos', 'attachments')
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "owner uploads private files"
on storage.objects for insert to authenticated
with check (
  bucket_id in ('meal-photos', 'attachments')
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "owner updates private files"
on storage.objects for update to authenticated
using (
  bucket_id in ('meal-photos', 'attachments')
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id in ('meal-photos', 'attachments')
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "owner deletes private files"
on storage.objects for delete to authenticated
using (
  bucket_id in ('meal-photos', 'attachments')
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- Realtime is used only with RLS-scoped browser sessions.
alter table public.directions replica identity full;
alter table public.plans replica identity full;
alter table public.daily_entries replica identity full;
alter table public.daily_tasks replica identity full;
alter table public.exercise_logs replica identity full;
alter table public.meal_logs replica identity full;
alter table public.accumulation_entries replica identity full;
alter table public.reviews replica identity full;
alter table public.reminder_settings replica identity full;

alter publication supabase_realtime add table
  public.directions,
  public.plans,
  public.daily_entries,
  public.daily_tasks,
  public.exercise_logs,
  public.meal_logs,
  public.accumulation_entries,
  public.reviews,
  public.reminder_settings;

-- Authenticated self-service account deletion. Service-role credentials stay server-side.
create or replace function public.delete_user_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'authentication required';
  end if;
  delete from storage.objects
  where bucket_id in ('meal-photos', 'attachments')
    and (storage.foldername(name))[1] = caller::text;
  delete from auth.users where id = caller;
end;
$$;

revoke all on function public.delete_user_account() from public;
grant execute on function public.delete_user_account() to authenticated;
