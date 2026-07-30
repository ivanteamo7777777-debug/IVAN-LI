begin;
create extension if not exists pgtap with schema extensions;

select plan(69);

select has_column(
  'public',
  'plans',
  'importance',
  'plans has importance'
);
select has_column(
  'public',
  'plans',
  'first_action',
  'plans has first_action'
);
select has_function(
  'public',
  'mcp_update_daily_task',
  array['date', 'integer', 'integer', 'jsonb'],
  'single daily-task RPC exists'
);
select has_function(
  'public',
  'mcp_batch_update_daily_tasks',
  array['date', 'jsonb', 'boolean'],
  'atomic daily-task batch RPC exists'
);
select has_function(
  'public',
  'mcp_create_plan',
  array[
    'uuid',
    'text',
    'text',
    'date',
    'date',
    'text',
    'text',
    'text',
    'text',
    'text',
    'uuid',
    'uuid',
    'text'
  ],
  'plan create RPC exists'
);
select has_function(
  'public',
  'mcp_update_plan',
  array['uuid', 'integer', 'jsonb'],
  'plan update RPC exists'
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
    '90000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'mcp-db-test-1@example.invalid',
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
    '90000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'mcp-db-test-2@example.invalid',
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

set local role authenticated;
set local "request.jwt.claim.sub" =
  '90000000-0000-0000-0000-000000000001';
set local "request.jwt.claim.role" = 'authenticated';

select is(
  (
    public.mcp_create_plan(
      '10000000-0000-0000-0000-000000000001',
      'annual',
      '年度计划',
      '2026-01-01',
      '2026-12-31',
      'active',
      '',
      '年度目标',
      '',
      '',
      null,
      (
        select id
        from public.directions
        where user_id = auth.uid()
          and deleted_at is null
        order by sort_order
        limit 1
      ),
      ''
    ) ->> 'status'
  )::text,
  'ok'::text,
  'annual plan can be created'
);

select is(
  (
    public.mcp_create_plan(
      '10000000-0000-0000-0000-000000000002',
      'monthly',
      '七月计划',
      '2026-07-01',
      '2026-07-31',
      'active',
      '',
      '月度目标',
      '',
      '',
      '10000000-0000-0000-0000-000000000001',
      null,
      ''
    ) ->> 'status'
  )::text,
  'ok'::text,
  'monthly plan can be linked to annual plan'
);

select is(
  (
    public.mcp_create_plan(
      '10000000-0000-0000-0000-000000000003',
      'weekly',
      '本周计划',
      '2026-07-27',
      '2026-08-02',
      'active',
      '',
      '本周目标',
      '',
      '',
      '10000000-0000-0000-0000-000000000002',
      null,
      ''
    ) ->> 'status'
  )::text,
  'ok'::text,
  'weekly plan can be linked to monthly plan'
);

select is(
  (
    public.mcp_create_plan(
      '10000000-0000-0000-0000-000000000010',
      'annual',
      '独立年度计划',
      '2026-01-01',
      '2026-12-31',
      'active',
      '',
      '',
      '',
      '',
      null,
      null,
      ''
    ) ->> 'status'
  )::text,
  'ok'::text,
  'an annual plan can be created without a direction'
);

select is(
  (
    public.mcp_create_plan(
      '10000000-0000-0000-0000-000000000011',
      'monthly',
      '独立月计划',
      '2026-08-01',
      '2026-08-31',
      'active',
      '',
      '',
      '',
      '',
      null,
      null,
      ''
    ) ->> 'status'
  )::text,
  'ok'::text,
  'a monthly plan can be created without a parent'
);

select is(
  (
    public.mcp_create_plan(
      '10000000-0000-0000-0000-000000000012',
      'weekly',
      '独立周计划',
      '2026-08-03',
      '2026-08-09',
      'active',
      '',
      '',
      '',
      '',
      null,
      null,
      ''
    ) ->> 'status'
  )::text,
  'ok'::text,
  'a weekly plan can be created without a parent'
);

select is(
  (
    select count(*)::integer
    from public.plans
    where id in (
      '10000000-0000-0000-0000-000000000010',
      '10000000-0000-0000-0000-000000000011',
      '10000000-0000-0000-0000-000000000012'
    )
      and parent_id is null
      and direction_id is null
  ),
  3,
  'independent annual, monthly and weekly plans persist without relationships'
);

select is(
  jsonb_array_length(
    public.mcp_plan_upstream_path(
      '10000000-0000-0000-0000-000000000012',
      auth.uid()
    )
  ),
  1,
  'an independent weekly plan path only contains itself'
);

select is(
  (
    public.mcp_create_plan(
      '10000000-0000-0000-0000-000000000013',
      'weekly',
      '可解除关联的周计划',
      '2026-08-10',
      '2026-08-16',
      'active',
      '',
      '',
      '',
      '',
      '10000000-0000-0000-0000-000000000002',
      null,
      ''
    ) ->> 'status'
  )::text,
  'ok'::text,
  'a weekly plan can start with a valid parent'
);

select is(
  (
    public.mcp_update_plan(
      '10000000-0000-0000-0000-000000000013',
      1,
      '{"parent_plan_id":null}'::jsonb
    ) ->> 'status'
  )::text,
  'ok'::text,
  'a weekly plan can remove its parent'
);

select ok(
  (
    select parent_id is null and version = 2
    from public.plans
    where id = '10000000-0000-0000-0000-000000000013'
  ),
  'removing a parent persists null and increments the version'
);

select is(
  jsonb_array_length(
    public.mcp_plan_upstream_path(
      '10000000-0000-0000-0000-000000000013',
      auth.uid()
    )
  ),
  1,
  'a detached weekly plan path only contains itself'
);

select is(
  (
    public.mcp_update_plan(
      '10000000-0000-0000-0000-000000000013',
      2,
      jsonb_build_object(
        'parent_plan_id',
        '10000000-0000-0000-0000-000000000002'
      )
    ) ->> 'status'
  )::text,
  'ok'::text,
  'a detached weekly plan can select a valid parent again'
);

select ok(
  (
    select
      parent_id = '10000000-0000-0000-0000-000000000002'
      and version = 3
    from public.plans
    where id = '10000000-0000-0000-0000-000000000013'
  ),
  'reattaching a parent persists the relationship and increments the version'
);

select is(
  (
    public.mcp_update_plan(
      '10000000-0000-0000-0000-000000000013',
      2,
      '{"parent_plan_id":null}'::jsonb
    ) ->> 'code'
  )::text,
  'VERSION_CONFLICT'::text,
  'a stale request cannot detach a plan'
);

select is(
  (
    select parent_id::text
    from public.plans
    where id = '10000000-0000-0000-0000-000000000013'
  ),
  '10000000-0000-0000-0000-000000000002'::text,
  'a failed stale detach keeps the existing parent'
);

select is(
  (
    public.mcp_update_plan(
      '10000000-0000-0000-0000-000000000010',
      1,
      '{"notes":"保持独立"}'::jsonb
    ) ->> 'status'
  )::text,
  'ok'::text,
  'an independent annual plan can be updated'
);

reset role;
set local role service_role;

select lives_ok(
  $$
    insert into public.plans (
      id,
      user_id,
      plan_type,
      title,
      period_start,
      period_end,
      parent_id,
      direction_id
    )
    values (
      '10000000-0000-0000-0000-000000000014',
      '90000000-0000-0000-0000-000000000001',
      'monthly',
      '服务端独立月计划',
      '2026-09-01',
      '2026-09-30',
      null,
      null
    )
  $$,
  'service_role can write an independent plan through the hierarchy trigger'
);

select throws_ok(
  $$
    insert into public.plans (
      id,
      user_id,
      plan_type,
      title,
      period_start,
      period_end,
      parent_id,
      direction_id
    )
    values (
      '10000000-0000-0000-0000-000000000015',
      '90000000-0000-0000-0000-000000000001',
      'weekly',
      '服务端非法周计划',
      '2026-09-07',
      '2026-09-13',
      '10000000-0000-0000-0000-000000000003',
      null
    )
  $$,
  '23514',
  '周计划只能关联年计划或月计划。',
  'service_role receives the intended hierarchy error instead of a permission error'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" =
  '90000000-0000-0000-0000-000000000001';
set local "request.jwt.claim.role" = 'authenticated';

select is(
  (
    public.mcp_create_plan(
      '10000000-0000-0000-0000-000000000003',
      'weekly',
      '本周计划',
      '2026-07-27',
      '2026-08-02',
      'active',
      '',
      '本周目标',
      '',
      '',
      '10000000-0000-0000-0000-000000000002',
      null,
      ''
    ) ->> 'status'
  )::text,
  'ok'::text,
  'replaying the same plan UUID succeeds without a duplicate'
);

select is(
  (
    public.mcp_create_plan(
      '10000000-0000-0000-0000-000000000003',
      'weekly',
      '本周计划',
      '2026-07-27',
      '2026-08-02',
      'active',
      '',
      '本周目标',
      '',
      '',
      '10000000-0000-0000-0000-000000000002',
      null,
      ''
    ) #>> '{data,idempotent_replay}'
  )::text,
  'true'::text,
  'an idempotent replay is labelled explicitly'
);

select is(
  (
    select count(*)::integer
    from public.plans
    where id = '10000000-0000-0000-0000-000000000003'
  ),
  1,
  'an idempotent replay leaves exactly one row'
);

select is(
  (
    public.mcp_create_plan(
      '10000000-0000-0000-0000-000000000005',
      'weekly',
      '直连年度周计划',
      '2026-07-27',
      '2026-08-02',
      'active',
      '',
      '',
      '',
      '',
      '10000000-0000-0000-0000-000000000001',
      null,
      ''
    ) ->> 'status'
  )::text,
  'ok'::text,
  'a weekly plan can link directly to an annual plan'
);

select ok(
  (
    select
      parent_id = '10000000-0000-0000-0000-000000000001'
      and version = 1
    from public.plans
    where id = '10000000-0000-0000-0000-000000000005'
  ),
  'the direct annual parent persists without creating a monthly plan'
);

select is(
  jsonb_array_length(
    public.mcp_plan_upstream_path(
      '10000000-0000-0000-0000-000000000005',
      auth.uid()
    )
  ),
  3,
  'a directly linked weekly plan path contains direction, annual and weekly'
);

select is(
  (
    public.mcp_update_plan(
      '10000000-0000-0000-0000-000000000013',
      3,
      jsonb_build_object(
        'parent_plan_id',
        '10000000-0000-0000-0000-000000000001'
      )
    ) ->> 'status'
  )::text,
  'ok'::text,
  'an existing weekly plan can be reparented directly to an annual plan'
);

select ok(
  (
    select
      parent_id = '10000000-0000-0000-0000-000000000001'
      and version = 4
    from public.plans
    where id = '10000000-0000-0000-0000-000000000013'
  ),
  'reparenting to an annual plan persists and increments the version'
);

select is(
  (
    public.mcp_update_plan(
      '10000000-0000-0000-0000-000000000002',
      1,
      jsonb_build_object(
        'parent_plan_id',
        '10000000-0000-0000-0000-000000000002'
      )
    ) ->> 'code'
  )::text,
  'CYCLE_DETECTED'::text,
  'a plan cannot point to itself'
);

select is(
  (
    public.mcp_update_plan(
      '10000000-0000-0000-0000-000000000002',
      1,
      jsonb_build_object(
        'parent_plan_id',
        '10000000-0000-0000-0000-000000000003'
      )
    ) ->> 'code'
  )::text,
  'CYCLE_DETECTED'::text,
  'a plan cannot point to one of its descendants'
);

select is(
  (
    public.mcp_update_plan(
      '10000000-0000-0000-0000-000000000003',
      1,
      '{"title":"本周计划-已修改"}'::jsonb
    ) ->> 'status'
  )::text,
  'ok'::text,
  'a plan can be updated with its current version'
);

select is(
  (
    select version
    from public.plans
    where id = '10000000-0000-0000-0000-000000000003'
  ),
  2,
  'the existing trigger increments plan version exactly once'
);

select is(
  (
    public.mcp_update_plan(
      '10000000-0000-0000-0000-000000000003',
      1,
      '{"notes":"stale write"}'::jsonb
    ) ->> 'code'
  )::text,
  'VERSION_CONFLICT'::text,
  'a stale plan version is rejected'
);

insert into public.daily_tasks (
  user_id,
  entry_date,
  slot_index
)
select
  auth.uid(),
  '2026-07-28'::date,
  slot_index::smallint
from generate_series(1, 6) as slots(slot_index);

select is(
  (
    public.mcp_update_daily_task(
      '2026-07-28',
      1,
      1,
      '{"title":"任务 1"}'::jsonb
    ) ->> 'status'
  )::text,
  'ok'::text,
  'slot 1 updates successfully'
);
select is(
  (
    public.mcp_update_daily_task(
      '2026-07-28',
      2,
      1,
      '{"title":"任务 2"}'::jsonb
    ) ->> 'status'
  )::text,
  'ok'::text,
  'slot 2 updates successfully'
);
select is(
  (
    public.mcp_update_daily_task(
      '2026-07-28',
      3,
      1,
      '{"title":"任务 3"}'::jsonb
    ) ->> 'status'
  )::text,
  'ok'::text,
  'slot 3 updates successfully'
);
select is(
  (
    public.mcp_update_daily_task(
      '2026-07-28',
      4,
      1,
      '{"title":"任务 4"}'::jsonb
    ) ->> 'status'
  )::text,
  'ok'::text,
  'slot 4 updates successfully'
);
select is(
  (
    public.mcp_update_daily_task(
      '2026-07-28',
      5,
      1,
      '{"title":"任务 5"}'::jsonb
    ) ->> 'status'
  )::text,
  'ok'::text,
  'slot 5 updates successfully'
);
select is(
  (
    public.mcp_update_daily_task(
      '2026-07-28',
      6,
      1,
      '{"title":"任务 6"}'::jsonb
    ) ->> 'status'
  )::text,
  'ok'::text,
  'slot 6 updates successfully'
);

select is(
  (
    select count(*)::integer
    from public.daily_tasks
    where user_id = auth.uid()
      and entry_date = '2026-07-28'
      and version = 2
  ),
  6,
  'six sequential updates preserve six independent rows'
);

select is(
  (
    select title
    from public.daily_tasks
    where user_id = auth.uid()
      and entry_date = '2026-07-28'
      and slot_index = 6
  )::text,
  '任务 6'::text,
  'the sixth slot contains its own value'
);

select is(
  (
    public.mcp_update_daily_task(
      '2026-07-28',
      1,
      1,
      '{"notes":"stale write"}'::jsonb
    ) ->> 'code'
  )::text,
  'VERSION_CONFLICT'::text,
  'a stale daily-task version is rejected'
);

select is(
  (
    public.mcp_update_daily_task(
      '2026-07-28',
      7,
      1,
      '{"title":"invalid"}'::jsonb
    ) ->> 'code'
  )::text,
  'INVALID_ARGUMENT'::text,
  'slot 7 is rejected'
);

select is(
  (
    public.mcp_update_daily_task(
      '2026-07-28',
      1,
      2,
      '{"title":"仅修改任务 1"}'::jsonb
    ) ->> 'status'
  )::text,
  'ok'::text,
  'one slot can be changed independently'
);

select is(
  (
    select title
    from public.daily_tasks
    where user_id = auth.uid()
      and entry_date = '2026-07-28'
      and slot_index = 2
  )::text,
  '任务 2'::text,
  'changing slot 1 does not overwrite slot 2'
);

select is(
  (
    public.mcp_batch_update_daily_tasks(
      '2026-07-28',
      jsonb_build_array(
        jsonb_build_object(
          'slot_index',
          1,
          'expected_version',
          3,
          'patch',
          jsonb_build_object('title', '本应回滚')
        ),
        jsonb_build_object(
          'slot_index',
          2,
          'expected_version',
          999,
          'patch',
          jsonb_build_object('title', '版本冲突')
        )
      ),
      true
    ) ->> 'code'
  )::text,
  'BATCH_UPDATE_FAILED'::text,
  'one stale item fails an atomic batch'
);

select ok(
  (
    select title = '仅修改任务 1' and version = 3
    from public.daily_tasks
    where user_id = auth.uid()
      and entry_date = '2026-07-28'
      and slot_index = 1
  ),
  'a failed atomic batch rolls an earlier item back'
);

select is(
  (
    public.mcp_batch_update_daily_tasks(
      '2026-07-28',
      jsonb_build_array(
        jsonb_build_object(
          'slot_index', 1,
          'expected_version', 3,
          'patch', jsonb_build_object(
            'title', '批量任务 1',
            'weekly_plan_id',
              '10000000-0000-0000-0000-000000000003'
          )
        ),
        jsonb_build_object(
          'slot_index', 2,
          'expected_version', 2,
          'patch', jsonb_build_object(
            'title', '批量任务 2',
            'weekly_plan_id',
              '10000000-0000-0000-0000-000000000003'
          )
        ),
        jsonb_build_object(
          'slot_index', 3,
          'expected_version', 2,
          'patch', jsonb_build_object(
            'title', '批量任务 3',
            'weekly_plan_id',
              '10000000-0000-0000-0000-000000000003'
          )
        ),
        jsonb_build_object(
          'slot_index', 4,
          'expected_version', 2,
          'patch', jsonb_build_object(
            'title', '批量任务 4',
            'weekly_plan_id',
              '10000000-0000-0000-0000-000000000003'
          )
        ),
        jsonb_build_object(
          'slot_index', 5,
          'expected_version', 2,
          'patch', jsonb_build_object(
            'title', '批量任务 5',
            'weekly_plan_id',
              '10000000-0000-0000-0000-000000000003'
          )
        ),
        jsonb_build_object(
          'slot_index', 6,
          'expected_version', 2,
          'patch', jsonb_build_object(
            'title', '批量任务 6',
            'weekly_plan_id',
              '10000000-0000-0000-0000-000000000003'
          )
        )
      ),
      true
    ) ->> 'status'
  )::text,
  'ok'::text,
  'all six slots can be committed in one atomic batch'
);

select is(
  jsonb_array_length(
    public.mcp_batch_update_daily_tasks(
      '2026-07-28',
      jsonb_build_array(
        jsonb_build_object(
          'slot_index', 1,
          'expected_version', 4,
          'patch', jsonb_build_object('notes', 'second batch')
        ),
        jsonb_build_object(
          'slot_index', 2,
          'expected_version', 3,
          'patch', jsonb_build_object('notes', 'second batch')
        ),
        jsonb_build_object(
          'slot_index', 3,
          'expected_version', 3,
          'patch', jsonb_build_object('notes', 'second batch')
        ),
        jsonb_build_object(
          'slot_index', 4,
          'expected_version', 3,
          'patch', jsonb_build_object('notes', 'second batch')
        ),
        jsonb_build_object(
          'slot_index', 5,
          'expected_version', 3,
          'patch', jsonb_build_object('notes', 'second batch')
        ),
        jsonb_build_object(
          'slot_index', 6,
          'expected_version', 3,
          'patch', jsonb_build_object('notes', 'second batch')
        )
      ),
      true
    ) #> '{data,tasks}'
  ),
  6,
  'an atomic batch returns all six complete task records'
);

select is(
  (
    select count(*)::integer
    from public.daily_tasks
    where user_id = auth.uid()
      and entry_date = '2026-07-28'
      and weekly_plan_id =
        '10000000-0000-0000-0000-000000000003'
  ),
  6,
  'batch linking preserves the weekly plan on all six tasks'
);

select is(
  (
    public.mcp_batch_update_daily_tasks(
      '2026-07-28',
      jsonb_build_array(
        jsonb_build_object(
          'slot_index', 1,
          'expected_version', 5,
          'patch', jsonb_build_object('title', '部分成功任务 1')
        ),
        jsonb_build_object(
          'slot_index', 2,
          'expected_version', 999,
          'patch', jsonb_build_object('title', '不应写入任务 2')
        )
      ),
      false
    ) ->> 'code'
  )::text,
  'PARTIAL_FAILURE'::text,
  'a non-atomic batch reports partial failure as an error'
);

select is(
  (
    select title
    from public.daily_tasks
    where user_id = auth.uid()
      and entry_date = '2026-07-28'
      and slot_index = 1
  )::text,
  '部分成功任务 1'::text,
  'a non-atomic batch preserves its successful item'
);

select is(
  (
    select title
    from public.daily_tasks
    where user_id = auth.uid()
      and entry_date = '2026-07-28'
      and slot_index = 2
  )::text,
  '批量任务 2'::text,
  'a non-atomic batch leaves its failed item unchanged'
);

select ok(
  jsonb_array_length(
    public.mcp_plan_upstream_path(
      '10000000-0000-0000-0000-000000000003',
      auth.uid()
    )
  ) >= 4,
  'the linked weekly plan exposes direction, annual, monthly and weekly path'
);

select ok(
  (
    public.mcp_update_daily_task(
      '2026-07-28',
      6,
      4,
      '{"notes":"complete result check"}'::jsonb
    ) -> 'data'
  ) ?& array['id', 'version', 'updated_at', 'upstream_path'],
  'a successful daily-task write returns the complete latest record'
);

select is(
  (
    public.mcp_create_plan(
      '10000000-0000-0000-0000-000000000004',
      'weekly',
      '已归档周计划',
      '2026-08-03',
      '2026-08-09',
      'archived',
      '',
      '',
      '',
      '',
      '10000000-0000-0000-0000-000000000002',
      null,
      ''
    ) ->> 'status'
  )::text,
  'ok'::text,
  'an archived weekly plan can be retained as history'
);

select is(
  (
    public.mcp_update_daily_task(
      '2026-07-28',
      6,
      5,
      jsonb_build_object(
        'weekly_plan_id',
        '10000000-0000-0000-0000-000000000004'
      )
    ) ->> 'code'
  )::text,
  'HIERARCHY_VIOLATION'::text,
  'a daily task cannot link to an archived weekly plan'
);

set local "request.jwt.claim.sub" =
  '90000000-0000-0000-0000-000000000002';

select is(
  (
    select count(*)::integer
    from public.plans
    where id = '10000000-0000-0000-0000-000000000003'
  ),
  0,
  'RLS hides another user plan'
);

select is(
  (
    public.mcp_update_plan(
      '10000000-0000-0000-0000-000000000003',
      2,
      '{"notes":"cross-user write"}'::jsonb
    ) ->> 'code'
  )::text,
  'NOT_FOUND'::text,
  'another user cannot update the plan'
);

select is(
  (
    public.mcp_create_plan(
      '10000000-0000-0000-0000-000000000001',
      'annual',
      '另一用户同 ID 计划',
      '2026-01-01',
      '2026-12-31',
      'active',
      '',
      '',
      '',
      '',
      null,
      (
        select id
        from public.directions
        where user_id = auth.uid()
          and deleted_at is null
        order by sort_order
        limit 1
      ),
      ''
    ) ->> 'code'
  )::text,
  'IDEMPOTENCY_CONFLICT'::text,
  'a globally colliding UUID does not create a duplicate'
);

set local "request.jwt.claim.sub" =
  '90000000-0000-0000-0000-000000000001';

update public.plans
set
  status = 'archived',
  archived_at = timezone('utc', now())
where id = '10000000-0000-0000-0000-000000000002';

select is(
  (
    public.mcp_create_plan(
      '10000000-0000-0000-0000-000000000003',
      'weekly',
      '本周计划-已修改',
      '2026-07-27',
      '2026-08-02',
      'active',
      '',
      '本周目标',
      '',
      '',
      '10000000-0000-0000-0000-000000000002',
      null,
      ''
    ) #>> '{data,idempotent_replay}'
  )::text,
  'true'::text,
  'an exact idempotent replay survives a later parent archive'
);

update public.plans
set deleted_at = timezone('utc', now())
where id = '10000000-0000-0000-0000-000000000003';

select is(
  (
    public.mcp_update_plan(
      '10000000-0000-0000-0000-000000000003',
      3,
      '{"notes":"cannot update deleted"}'::jsonb
    ) ->> 'code'
  )::text,
  'RECORD_DELETED'::text,
  'a soft-deleted plan cannot be modified'
);

select is(
  jsonb_typeof(
    public.mcp_update_plan(
      '10000000-0000-0000-0000-000000000003',
      3,
      '{"notes":"cannot update deleted"}'::jsonb
    ) -> 'details'
  )::text,
  'object'::text,
  'every RPC error includes an object-shaped details value'
);

select is(
  jsonb_array_length(
    public.mcp_plan_period_warnings(
      'weekly',
      '2026-07-27',
      '2026-08-02'
    )
  ),
  0,
  'a natural Monday-to-Sunday week has no warning'
);

select * from finish();
rollback;
