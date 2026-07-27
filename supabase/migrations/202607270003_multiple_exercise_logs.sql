-- A day can contain multiple independent exercise sessions.
-- Existing rows keep their ids and remain valid.

alter table public.exercise_logs
drop constraint if exists exercise_logs_user_id_entry_date_key;

comment on table public.exercise_logs is
  'Independent exercise sessions; a user may record multiple sessions per day.';
