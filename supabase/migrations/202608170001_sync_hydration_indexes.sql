-- Keep local-first hydration keyset scans predictable as personal history grows.
-- These indexes intentionally include soft-deleted rows because synchronization
-- must receive tombstones as well as active records.

create index if not exists directions_sync_hydration_idx
  on public.directions (user_id, updated_at, id);
create index if not exists plans_sync_hydration_idx
  on public.plans (user_id, updated_at, id);
create index if not exists daily_entries_sync_hydration_idx
  on public.daily_entries (user_id, updated_at, id);
create index if not exists daily_tasks_sync_hydration_idx
  on public.daily_tasks (user_id, updated_at, id);
create index if not exists exercise_logs_sync_hydration_idx
  on public.exercise_logs (user_id, updated_at, id);
create index if not exists meal_logs_sync_hydration_idx
  on public.meal_logs (user_id, updated_at, id);
create index if not exists accumulation_entries_sync_hydration_idx
  on public.accumulation_entries (user_id, updated_at, id);
create index if not exists reviews_sync_hydration_idx
  on public.reviews (user_id, updated_at, id);
create index if not exists reminder_settings_sync_hydration_idx
  on public.reminder_settings (user_id, updated_at, id);
create index if not exists push_subscriptions_sync_hydration_idx
  on public.push_subscriptions (user_id, updated_at, id);
