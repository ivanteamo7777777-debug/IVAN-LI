-- Optional AI-generated daily-six drafts.
--
-- The model output is stored only on daily_entries. It is never promoted to
-- daily_tasks by a database trigger or scheduled job. Users must explicitly
-- accept a draft in the application before any task is changed.

alter table public.reminder_settings
  add column if not exists daily_six_auto_draft_enabled boolean not null default false,
  add column if not exists daily_six_auto_draft_mode text not null default 'first_open',
  add column if not exists daily_six_auto_draft_time time not null default '07:30',
  add column if not exists last_daily_six_ai_draft_generated date;

alter table public.reminder_settings
  drop constraint if exists reminder_settings_daily_six_auto_draft_mode_check;

alter table public.reminder_settings
  add constraint reminder_settings_daily_six_auto_draft_mode_check
  check (daily_six_auto_draft_mode in ('first_open', 'scheduled'));

alter table public.daily_entries
  add column if not exists daily_six_ai_draft jsonb,
  add column if not exists daily_six_ai_draft_status text not null default 'idle',
  add column if not exists daily_six_ai_draft_trigger text,
  add column if not exists daily_six_ai_draft_generated_at timestamptz,
  add column if not exists daily_six_ai_draft_applied_at timestamptz,
  add column if not exists daily_six_ai_draft_claim_id uuid,
  add column if not exists daily_six_ai_draft_claimed_at timestamptz,
  add column if not exists daily_six_ai_draft_last_attempt_at timestamptz,
  add column if not exists daily_six_ai_draft_last_error_code text;

alter table public.daily_entries
  drop constraint if exists daily_entries_ai_draft_status_check,
  drop constraint if exists daily_entries_ai_draft_trigger_check,
  drop constraint if exists daily_entries_ai_draft_shape_check;

alter table public.daily_entries
  add constraint daily_entries_ai_draft_status_check
    check (daily_six_ai_draft_status in ('idle', 'generating', 'ready', 'applied', 'failed')),
  add constraint daily_entries_ai_draft_trigger_check
    check (
      daily_six_ai_draft_trigger is null
      or daily_six_ai_draft_trigger in ('first_open', 'scheduled')
    ),
  add constraint daily_entries_ai_draft_shape_check
    check (
      daily_six_ai_draft is null
      or case
        when jsonb_typeof(daily_six_ai_draft) = 'object'
          and jsonb_typeof(daily_six_ai_draft -> 'suggestions') = 'array'
        then jsonb_array_length(daily_six_ai_draft -> 'suggestions') = 6
        else false
      end
    );

create index if not exists reminder_settings_ai_draft_due_idx
  on public.reminder_settings (
    daily_six_auto_draft_mode,
    daily_six_auto_draft_time
  )
  where daily_six_auto_draft_enabled = true
    and deleted_at is null
    and archived_at is null;

-- Claim one user's draft generation atomically. A stale or failed claim may be
-- retried after ten minutes, while an existing draft is never overwritten.
create or replace function public.claim_daily_six_ai_draft(
  p_user_id uuid,
  p_entry_date date,
  p_trigger text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_claim_id uuid := gen_random_uuid();
  claimed_id uuid;
begin
  if p_trigger not in ('first_open', 'scheduled') then
    return null;
  end if;

  if not exists (
    select 1
      from public.reminder_settings settings
     where settings.user_id = p_user_id
       and settings.daily_six_auto_draft_enabled = true
       and settings.daily_six_auto_draft_mode = p_trigger
       and settings.deleted_at is null
       and settings.archived_at is null
  ) then
    return null;
  end if;

  insert into public.daily_entries (user_id, entry_date)
  values (p_user_id, p_entry_date)
  on conflict (user_id, entry_date) do nothing;

  update public.daily_entries entry
     set daily_six_ai_draft_status = 'generating',
         daily_six_ai_draft_trigger = p_trigger,
         daily_six_ai_draft_claim_id = next_claim_id,
         daily_six_ai_draft_claimed_at = timezone('utc', now()),
         daily_six_ai_draft_last_attempt_at = timezone('utc', now()),
         daily_six_ai_draft_last_error_code = null
   where entry.user_id = p_user_id
     and entry.entry_date = p_entry_date
     and entry.deleted_at is null
     and entry.archived_at is null
     and entry.daily_six_ai_draft is null
     and (
       (
         entry.daily_six_ai_draft_status in ('idle', 'failed')
         and (
           entry.daily_six_ai_draft_last_attempt_at is null
           or entry.daily_six_ai_draft_last_attempt_at
             < timezone('utc', now()) - interval '10 minutes'
         )
       )
       or (
         entry.daily_six_ai_draft_status = 'generating'
         and entry.daily_six_ai_draft_claimed_at
           < timezone('utc', now()) - interval '10 minutes'
       )
     )
  returning entry.daily_six_ai_draft_claim_id into claimed_id;

  return claimed_id;
end;
$$;

-- Persist a validated model response and only then mark the setting as
-- generated for the day. Returning the complete row lets the caller update its
-- local cache without waiting for Realtime delivery.
create or replace function public.complete_daily_six_ai_draft(
  p_user_id uuid,
  p_entry_date date,
  p_claim_id uuid,
  p_trigger text,
  p_draft jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  completed_entry public.daily_entries;
begin
  if p_trigger not in ('first_open', 'scheduled') or p_draft is null then
    return null;
  end if;
  if pg_column_size(p_draft) > 32768
    or jsonb_typeof(p_draft) is distinct from 'object'
  then
    return null;
  end if;
  if jsonb_typeof(p_draft -> 'suggestions') is distinct from 'array' then
    return null;
  end if;
  if jsonb_array_length(p_draft -> 'suggestions') <> 6 then
    return null;
  end if;

  update public.daily_entries entry
     set daily_six_ai_draft = p_draft,
         daily_six_ai_draft_status = 'ready',
         daily_six_ai_draft_trigger = p_trigger,
         daily_six_ai_draft_generated_at = timezone('utc', now()),
         daily_six_ai_draft_claim_id = null,
         daily_six_ai_draft_claimed_at = null,
         daily_six_ai_draft_last_error_code = null
   where entry.user_id = p_user_id
     and entry.entry_date = p_entry_date
     and entry.deleted_at is null
     and entry.archived_at is null
     and entry.daily_six_ai_draft is null
     and entry.daily_six_ai_draft_status = 'generating'
     and entry.daily_six_ai_draft_trigger = p_trigger
     and entry.daily_six_ai_draft_claim_id = p_claim_id
  returning entry.* into completed_entry;

  if completed_entry.id is null then
    return null;
  end if;

  update public.reminder_settings settings
     set last_daily_six_ai_draft_generated = p_entry_date
   where settings.user_id = p_user_id;

  return to_jsonb(completed_entry);
end;
$$;

-- Failures retain only a non-sensitive code. They do not advance the last
-- successful date and can be retried by the next Cron tick.
create or replace function public.fail_daily_six_ai_draft(
  p_user_id uuid,
  p_entry_date date,
  p_claim_id uuid,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  update public.daily_entries entry
     set daily_six_ai_draft_status = 'failed',
         daily_six_ai_draft_claim_id = null,
         daily_six_ai_draft_claimed_at = null,
         daily_six_ai_draft_last_error_code = left(
           coalesce(nullif(p_error_code, ''), 'GENERATION_FAILED'),
           64
         )
   where entry.user_id = p_user_id
     and entry.entry_date = p_entry_date
     and entry.deleted_at is null
     and entry.archived_at is null
     and entry.daily_six_ai_draft is null
     and entry.daily_six_ai_draft_status = 'generating'
     and entry.daily_six_ai_draft_claim_id = p_claim_id;

  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

-- Marking a draft as applied records an explicit user-confirmation boundary.
-- This function never writes daily_tasks; the client owns the confirmed task
-- writes and can safely retry this marker with optimistic locking.
create or replace function public.mark_daily_six_ai_draft_applied(
  p_user_id uuid,
  p_entry_date date,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  applied_entry public.daily_entries;
begin
  update public.daily_entries entry
     set daily_six_ai_draft_status = 'applied',
         daily_six_ai_draft_applied_at = timezone('utc', now())
   where entry.user_id = p_user_id
     and entry.entry_date = p_entry_date
     and entry.deleted_at is null
     and entry.archived_at is null
     and entry.daily_six_ai_draft is not null
     and entry.daily_six_ai_draft_status = 'ready'
     and entry.version = p_expected_version
  returning entry.* into applied_entry;

  return case
    when applied_entry.id is null then null
    else to_jsonb(applied_entry)
  end;
end;
$$;

revoke all on function public.claim_daily_six_ai_draft(uuid, date, text)
  from public, anon, authenticated;
revoke all on function public.complete_daily_six_ai_draft(uuid, date, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.fail_daily_six_ai_draft(uuid, date, uuid, text)
  from public, anon, authenticated;
revoke all on function public.mark_daily_six_ai_draft_applied(uuid, date, integer)
  from public, anon, authenticated;

grant execute on function public.claim_daily_six_ai_draft(uuid, date, text)
  to service_role;
grant execute on function public.complete_daily_six_ai_draft(uuid, date, uuid, text, jsonb)
  to service_role;
grant execute on function public.fail_daily_six_ai_draft(uuid, date, uuid, text)
  to service_role;
grant execute on function public.mark_daily_six_ai_draft_applied(uuid, date, integer)
  to service_role;

-- Keep local/CI permissions equivalent to hosted Supabase. Scheduled generation
-- reads only compact planning context and writes only settings/daily_entries.
grant select on table public.directions, public.plans, public.daily_tasks,
  public.reviews to service_role;
grant select, insert, update on table public.daily_entries to service_role;
grant select, update on table public.reminder_settings to service_role;
