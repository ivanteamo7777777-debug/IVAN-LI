begin;
create extension if not exists pgtap with schema extensions;

select plan(25);

select has_column(
  'public',
  'reminder_settings',
  'daily_six_auto_draft_enabled',
  'automatic draft setting exists'
);
select has_column(
  'public',
  'daily_entries',
  'daily_six_ai_draft',
  'daily entry stores the AI draft'
);
select has_column(
  'public',
  'daily_entries',
  'daily_six_ai_draft_status',
  'daily entry stores draft state'
);
select has_column(
  'public',
  'daily_entries',
  'daily_six_ai_draft_applied_at',
  'daily entry records explicit application'
);
select has_function(
  'public',
  'claim_daily_six_ai_draft',
  array['uuid', 'date', 'text'],
  'atomic claim RPC exists'
);
select has_function(
  'public',
  'complete_daily_six_ai_draft',
  array['uuid', 'date', 'uuid', 'text', 'jsonb'],
  'atomic completion RPC exists'
);
select has_function(
  'public',
  'fail_daily_six_ai_draft',
  array['uuid', 'date', 'uuid', 'text'],
  'failure marker RPC exists'
);
select has_function(
  'public',
  'mark_daily_six_ai_draft_applied',
  array['uuid', 'date', 'integer'],
  'applied marker RPC exists'
);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '91000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'auto-draft-db-test-1@example.invalid',
    '',
    timezone('utc', now()),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    timezone('utc', now()),
    timezone('utc', now()),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '91000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'auto-draft-db-test-2@example.invalid',
    '',
    timezone('utc', now()),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    timezone('utc', now()),
    timezone('utc', now()),
    '',
    '',
    '',
    ''
  );

insert into public.reminder_settings (user_id)
values
  ('91000000-0000-0000-0000-000000000001'),
  ('91000000-0000-0000-0000-000000000002');

select is(
  (
    select daily_six_auto_draft_enabled
      from public.reminder_settings
     where user_id = '91000000-0000-0000-0000-000000000001'
  ),
  false,
  'automatic drafts default to disabled'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_daily_six_ai_draft(uuid,date,text)',
    'execute'
  ),
  'authenticated users cannot invoke the service claim RPC directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.claim_daily_six_ai_draft(uuid,date,text)',
    'execute'
  ),
  'service role can invoke the claim RPC'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.complete_daily_six_ai_draft(uuid,date,uuid,text,jsonb)',
    'execute'
  ),
  'authenticated users cannot complete a draft directly'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.fail_daily_six_ai_draft(uuid,date,uuid,text)',
    'execute'
  ),
  'authenticated users cannot change a generation failure directly'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.mark_daily_six_ai_draft_applied(uuid,date,integer)',
    'execute'
  ),
  'authenticated users cannot bypass the confirmed-apply route'
);

update public.reminder_settings
   set daily_six_auto_draft_enabled = true,
       daily_six_auto_draft_mode = 'scheduled',
       daily_six_auto_draft_time = '08:00'
 where user_id = '91000000-0000-0000-0000-000000000001';

set local role service_role;
create temporary table auto_draft_claims (id uuid);
insert into auto_draft_claims (id)
select public.claim_daily_six_ai_draft(
  '91000000-0000-0000-0000-000000000001',
  '2026-08-18',
  'scheduled'
);

select ok(
  (select id is not null from auto_draft_claims),
  'first claim succeeds'
);
select is(
  (
    select daily_six_ai_draft_status
      from public.daily_entries
     where user_id = '91000000-0000-0000-0000-000000000001'
       and entry_date = '2026-08-18'
  ),
  'generating',
  'claim records an in-progress state'
);

select ok(
  public.complete_daily_six_ai_draft(
    '91000000-0000-0000-0000-000000000001',
    '2026-08-18',
    (select id from auto_draft_claims),
    'scheduled',
    jsonb_build_object(
      'suggestions',
      (
        select jsonb_agg(
          jsonb_build_object(
            'title', '建议 ' || item,
            'importance', '',
            'completion_standard', '',
            'first_action', '',
            'weekly_plan_id', null
          )
        )
        from generate_series(1, 6) item
      )
    )
  ) is not null,
  'validated draft completes successfully'
);
select is(
  (
    select daily_six_ai_draft_status
      from public.daily_entries
     where user_id = '91000000-0000-0000-0000-000000000001'
       and entry_date = '2026-08-18'
  ),
  'ready',
  'successful output is a draft, not a task write'
);
select is(
  (
    select last_daily_six_ai_draft_generated
      from public.reminder_settings
     where user_id = '91000000-0000-0000-0000-000000000001'
  ),
  '2026-08-18'::date,
  'last-success date advances only after completion'
);
select is(
  (
    select count(*)::integer
      from public.daily_tasks
     where user_id = '91000000-0000-0000-0000-000000000001'
       and entry_date = '2026-08-18'
  ),
  0,
  'automatic completion never writes daily tasks'
);
select is(
  public.claim_daily_six_ai_draft(
    '91000000-0000-0000-0000-000000000001',
    '2026-08-18',
    'scheduled'
  ),
  null::uuid,
  'an existing draft cannot be claimed again'
);
select ok(
  public.mark_daily_six_ai_draft_applied(
    '91000000-0000-0000-0000-000000000001',
    '2026-08-18',
    (
      select version
        from public.daily_entries
       where user_id = '91000000-0000-0000-0000-000000000001'
         and entry_date = '2026-08-18'
    )
  ) is not null,
  'the confirmed draft can be marked applied with its current version'
);
select is(
  (
    select daily_six_ai_draft_status
      from public.daily_entries
     where user_id = '91000000-0000-0000-0000-000000000001'
       and entry_date = '2026-08-18'
  ),
  'applied',
  'applied state prevents repeated confirmation after reload'
);

set local role authenticated;
set local "request.jwt.claim.sub" =
  '91000000-0000-0000-0000-000000000002';
set local "request.jwt.claim.role" = 'authenticated';
select is(
  (
    select count(*)::integer
      from public.daily_entries
     where user_id = '91000000-0000-0000-0000-000000000001'
  ),
  0,
  'another user cannot read the draft'
);

set local "request.jwt.claim.sub" =
  '91000000-0000-0000-0000-000000000001';
select is(
  (
    select count(*)::integer
      from public.daily_entries
     where user_id = '91000000-0000-0000-0000-000000000001'
  ),
  1,
  'the owner can read the draft through existing RLS'
);

select * from finish();
rollback;
