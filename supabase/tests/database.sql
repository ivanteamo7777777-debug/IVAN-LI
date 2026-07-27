begin;
create extension if not exists pgtap with schema extensions;

select plan(19);

select has_table('public', 'daily_tasks', 'daily_tasks exists');
select has_table('public', 'exercise_logs', 'exercise_logs is independent');
select has_table('public', 'meal_logs', 'meal_logs is independent');
select col_is_pk('public', 'daily_tasks', 'id', 'daily_tasks has a primary key');
select col_has_check('public', 'daily_tasks', 'slot_index', 'slot_index has a range check');
select col_is_unique(
  'public',
  'daily_tasks',
  array['user_id', 'entry_date', 'slot_index'],
  'each user has one record per date and slot'
);
select col_is_unique(
  'public',
  'exercise_logs',
  array['user_id', 'entry_date'],
  'exercise is one independent daily record'
);
select col_is_unique(
  'public',
  'meal_logs',
  array['user_id', 'entry_date', 'meal_type'],
  'meal slots are independent from daily tasks'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.directions'::regclass),
  'directions has RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.plans'::regclass),
  'plans has RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.daily_tasks'::regclass),
  'daily_tasks has RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.exercise_logs'::regclass),
  'exercise_logs has RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.meal_logs'::regclass),
  'meal_logs has RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.accumulation_entries'::regclass),
  'accumulation_entries has RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.reviews'::regclass),
  'reviews has RLS'
);

select results_eq(
  $$ select count(*)::integer from pg_policies where schemaname = 'public' and tablename = 'daily_tasks' $$,
  array[4],
  'daily_tasks has owner select/insert/update/delete policies'
);
select results_eq(
  $$ select count(*)::integer from pg_policies where schemaname = 'public' and tablename = 'plans' $$,
  array[4],
  'plans has owner select/insert/update/delete policies'
);
select results_eq(
  $$ select count(*)::integer from pg_policies where schemaname = 'public' and tablename = 'reviews' $$,
  array[4],
  'reviews has owner select/insert/update/delete policies'
);
select results_eq(
  $$ select count(*)::integer from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'owner % private files' $$,
  array[4],
  'Storage has owner-only CRUD policies'
);

select * from finish();
rollback;
