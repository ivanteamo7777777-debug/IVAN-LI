-- Stable, RLS-scoped MCP writes for daily tasks and plans.
-- All public RPCs return a non-empty JSON envelope and rely on the existing
-- set_updated_at_and_version trigger for updated_at/version changes.

alter table public.plans
  add column if not exists importance text not null default '',
  add column if not exists first_action text not null default '';

create or replace function public.validate_plan_hierarchy()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  parent_record public.plans;
  direction_owner uuid;
  creates_cycle boolean := false;
begin
  if tg_op = 'UPDATE' then
    if new.plan_type is not distinct from old.plan_type
      and new.parent_id is not distinct from old.parent_id
      and new.direction_id is not distinct from old.direction_id
      and new.user_id is not distinct from old.user_id
    then
      return new;
    end if;
  end if;

  if new.plan_type = 'annual' then
    select user_id into direction_owner
    from public.directions
    where id = new.direction_id
      and deleted_at is null
      and archived_at is null;

    if direction_owner is distinct from new.user_id then
      raise exception 'annual plan direction must belong to the same user';
    end if;
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'plan parent would create a cycle';
  end if;

  if tg_op = 'UPDATE' then
    if new.parent_id is distinct from old.parent_id then
      with recursive descendants(id) as (
        select p.id
        from public.plans p
        where p.parent_id = new.id
          and p.user_id = new.user_id
          and p.deleted_at is null
        union
        select p.id
        from public.plans p
        join descendants d on p.parent_id = d.id
        where p.user_id = new.user_id
          and p.deleted_at is null
      )
      select exists (
        select 1 from descendants where id = new.parent_id
      ) into creates_cycle;

      if creates_cycle then
        raise exception 'plan parent would create a cycle';
      end if;
    end if;
  end if;

  select * into parent_record
  from public.plans
  where id = new.parent_id
    and deleted_at is null
    and archived_at is null
    and status <> 'archived';

  if parent_record.id is null
    or parent_record.user_id is distinct from new.user_id
  then
    raise exception 'parent plan must be an active plan owned by the same user';
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

create or replace function public.validate_weekly_plan_link()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  linked_plan public.plans;
begin
  if tg_op = 'UPDATE' then
    if new.weekly_plan_id is not distinct from old.weekly_plan_id
      and new.user_id is not distinct from old.user_id
    then
      return new;
    end if;
  end if;

  if new.weekly_plan_id is null then
    return new;
  end if;

  select * into linked_plan
  from public.plans
  where id = new.weekly_plan_id
    and deleted_at is null
    and archived_at is null
    and status <> 'archived';

  if linked_plan.id is null
    or linked_plan.user_id is distinct from new.user_id
    or linked_plan.plan_type <> 'weekly'
  then
    raise exception
      'daily task may only link to a non-archived weekly plan owned by the user';
  end if;
  return new;
end;
$$;

create or replace function public.mcp_result_ok(
  p_message text,
  p_data jsonb
)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'status', 'ok',
    'message', coalesce(p_message, ''),
    'data', coalesce(p_data, '{}'::jsonb)
  );
$$;

create or replace function public.mcp_result_error(
  p_code text,
  p_message text,
  p_details jsonb default '{}'::jsonb
)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'status', 'error',
    'code', coalesce(nullif(p_code, ''), 'INTERNAL_ERROR'),
    'message', coalesce(p_message, '操作未完成。'),
    'details',
      case
        when jsonb_typeof(coalesce(p_details, '{}'::jsonb)) = 'object'
          then coalesce(p_details, '{}'::jsonb)
        else '{}'::jsonb
      end
  );
$$;

create or replace function public.mcp_plan_upstream_path(
  p_plan_id uuid,
  p_user_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive chain as (
    select
      p.id,
      p.parent_id,
      p.direction_id,
      p.title,
      0 as depth,
      array[p.id]::uuid[] as visited
    from public.plans p
    where p.id = p_plan_id
      and p.user_id = p_user_id
      and p.deleted_at is null

    union all

    select
      parent.id,
      parent.parent_id,
      parent.direction_id,
      parent.title,
      child.depth + 1,
      child.visited || parent.id
    from public.plans parent
    join chain child on child.parent_id = parent.id
    where parent.user_id = p_user_id
      and parent.deleted_at is null
      and not parent.id = any(child.visited)
  ),
  labels as (
    select d.title as label, 0 as sort_order
    from chain c
    join public.directions d
      on d.id = c.direction_id
     and d.user_id = p_user_id
     and d.deleted_at is null
    union all
    select c.title, 100 - c.depth
    from chain c
  )
  select coalesce(
    jsonb_agg(label order by sort_order),
    '[]'::jsonb
  )
  from labels;
$$;

create or replace function public.mcp_plan_period_warnings(
  p_plan_type text,
  p_period_start date,
  p_period_end date
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  warnings jsonb := '[]'::jsonb;
  natural_month_end date;
begin
  if p_plan_type = 'annual'
    and (
      p_period_start <> make_date(extract(year from p_period_start)::integer, 1, 1)
      or p_period_end <> make_date(extract(year from p_period_start)::integer, 12, 31)
    )
  then
    warnings := warnings || jsonb_build_array(
      '该年度计划不是同一自然年的 1 月 1 日至 12 月 31 日。'
    );
  elsif p_plan_type = 'monthly' then
    natural_month_end :=
      (
        date_trunc('month', p_period_start::timestamp)
        + interval '1 month'
        - interval '1 day'
      )::date;
    if p_period_start
        <> date_trunc('month', p_period_start::timestamp)::date
      or p_period_end <> natural_month_end
    then
      warnings := warnings || jsonb_build_array(
        '该月度计划不是完整的自然月。'
      );
    end if;
  elsif p_plan_type = 'weekly'
    and (
      extract(isodow from p_period_start)::integer <> 1
      or extract(isodow from p_period_end)::integer <> 7
      or p_period_end - p_period_start <> 6
    )
  then
    warnings := warnings || jsonb_build_array(
      '该周计划不是周一至周日的完整自然周。'
    );
  end if;
  return warnings;
end;
$$;

-- Expose slot_index as integer because JSON-RPC/PostgREST numeric values and
-- ordinary SQL integer literals should resolve this function unambiguously.
drop function if exists public.mcp_update_daily_task(
  date,
  smallint,
  integer,
  jsonb
);

create or replace function public.mcp_update_daily_task(
  p_entry_date date,
  p_slot_index integer,
  p_expected_version integer,
  p_patch jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  current_task public.daily_tasks%rowtype;
  updated_task public.daily_tasks%rowtype;
  linked_plan public.plans%rowtype;
  unknown_keys jsonb;
  key_name text;
  linked_plan_id uuid;
begin
  if caller is null then
    return public.mcp_result_error(
      'UNAUTHORIZED',
      '登录状态已失效，请重新登录。',
      '{}'::jsonb
    );
  end if;
  if p_entry_date is null then
    return public.mcp_result_error(
      'INVALID_ARGUMENT',
      '日期不能为空。',
      jsonb_build_object('field', 'date')
    );
  end if;
  if p_slot_index is null or p_slot_index < 1 or p_slot_index > 6 then
    return public.mcp_result_error(
      'INVALID_ARGUMENT',
      'slot_index 必须为 1–6。',
      jsonb_build_object('field', 'slot_index', 'value', p_slot_index)
    );
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    return public.mcp_result_error(
      'INVALID_ARGUMENT',
      'expected_version 必须是大于 0 的整数。',
      jsonb_build_object('field', 'expected_version')
    );
  end if;
  if p_patch is null
    or jsonb_typeof(p_patch) <> 'object'
    or p_patch = '{}'::jsonb
  then
    return public.mcp_result_error(
      'INVALID_ARGUMENT',
      'patch 必须是包含至少一个可修改字段的对象。',
      jsonb_build_object('field', 'patch')
    );
  end if;

  select coalesce(jsonb_agg(patch_key), '[]'::jsonb)
  into unknown_keys
  from jsonb_object_keys(p_patch) as patch_keys(patch_key)
  where patch_key <> all(array[
    'title',
    'importance',
    'completion_standard',
    'first_action',
    'weekly_plan_id',
    'status',
    'result',
    'completed_at',
    'notes'
  ]);
  if jsonb_array_length(unknown_keys) > 0 then
    return public.mcp_result_error(
      'INVALID_ARGUMENT',
      'patch 包含不可修改的字段。',
      jsonb_build_object('unknown_fields', unknown_keys)
    );
  end if;

  foreach key_name in array array[
    'title',
    'importance',
    'completion_standard',
    'first_action',
    'status',
    'result',
    'notes'
  ]
  loop
    if p_patch ? key_name and jsonb_typeof(p_patch -> key_name) <> 'string' then
      return public.mcp_result_error(
        'INVALID_ARGUMENT',
        format('%s 必须是字符串。', key_name),
        jsonb_build_object('field', key_name)
      );
    end if;
  end loop;

  if p_patch ? 'title'
    and char_length(p_patch ->> 'title') > 200
  then
    return public.mcp_result_error(
      'INVALID_ARGUMENT',
      '任务标题不能超过 200 个字符。',
      jsonb_build_object('field', 'title', 'max_length', 200)
    );
  end if;
  if p_patch ? 'status'
    and (p_patch ->> 'status') <> all(array[
      'not_started',
      'in_progress',
      'completed',
      'not_completed',
      'not_scheduled'
    ])
  then
    return public.mcp_result_error(
      'INVALID_ARGUMENT',
      '任务状态不合法。',
      jsonb_build_object('field', 'status')
    );
  end if;
  if p_patch ? 'weekly_plan_id'
    and jsonb_typeof(p_patch -> 'weekly_plan_id') not in ('string', 'null')
  then
    return public.mcp_result_error(
      'INVALID_ARGUMENT',
      'weekly_plan_id 必须是 UUID 或 null。',
      jsonb_build_object('field', 'weekly_plan_id')
    );
  end if;
  if p_patch ? 'completed_at'
    and jsonb_typeof(p_patch -> 'completed_at') not in ('string', 'null')
  then
    return public.mcp_result_error(
      'INVALID_ARGUMENT',
      'completed_at 必须是时间字符串或 null。',
      jsonb_build_object('field', 'completed_at')
    );
  end if;

  select * into current_task
  from public.daily_tasks
  where user_id = caller
    and entry_date = p_entry_date
    and slot_index = p_slot_index
  for update;

  if current_task.id is null then
    return public.mcp_result_error(
      'NOT_FOUND',
      '未找到指定日期和位置的每日任务。',
      jsonb_build_object(
        'date', p_entry_date,
        'slot_index', p_slot_index
      )
    );
  end if;
  if current_task.deleted_at is not null then
    return public.mcp_result_error(
      'RECORD_DELETED',
      '该每日任务已删除，不能修改。',
      jsonb_build_object('task_id', current_task.id)
    );
  end if;
  if current_task.archived_at is not null then
    return public.mcp_result_error(
      'RECORD_ARCHIVED',
      '该每日任务已归档，不能修改。',
      jsonb_build_object('task_id', current_task.id)
    );
  end if;
  if current_task.version <> p_expected_version then
    return public.mcp_result_error(
      'VERSION_CONFLICT',
      '数据已被修改，请重新读取后再提交。',
      jsonb_build_object(
        'task_id', current_task.id,
        'expected_version', p_expected_version,
        'current_version', current_task.version,
        'current', to_jsonb(current_task)
      )
    );
  end if;

  if p_patch ? 'weekly_plan_id'
    and jsonb_typeof(p_patch -> 'weekly_plan_id') = 'string'
  then
    linked_plan_id := (p_patch ->> 'weekly_plan_id')::uuid;
    select * into linked_plan
    from public.plans
    where id = linked_plan_id
      and user_id = caller
      and plan_type = 'weekly'
      and deleted_at is null
      and archived_at is null
      and status <> 'archived';

    if linked_plan.id is null then
      return public.mcp_result_error(
        'HIERARCHY_VIOLATION',
        '每日任务只能关联当前用户未删除、未归档的周计划。',
        jsonb_build_object('weekly_plan_id', linked_plan_id)
      );
    end if;
  end if;

  update public.daily_tasks
  set
    title = case
      when p_patch ? 'title' then p_patch ->> 'title'
      else title
    end,
    importance = case
      when p_patch ? 'importance' then p_patch ->> 'importance'
      else importance
    end,
    completion_standard = case
      when p_patch ? 'completion_standard'
        then p_patch ->> 'completion_standard'
      else completion_standard
    end,
    first_action = case
      when p_patch ? 'first_action' then p_patch ->> 'first_action'
      else first_action
    end,
    weekly_plan_id = case
      when p_patch ? 'weekly_plan_id'
        and jsonb_typeof(p_patch -> 'weekly_plan_id') = 'null'
        then null
      when p_patch ? 'weekly_plan_id'
        then (p_patch ->> 'weekly_plan_id')::uuid
      else weekly_plan_id
    end,
    status = case
      when p_patch ? 'status' then p_patch ->> 'status'
      else status
    end,
    result = case
      when p_patch ? 'result' then p_patch ->> 'result'
      else result
    end,
    completed_at = case
      when p_patch ? 'completed_at'
        and jsonb_typeof(p_patch -> 'completed_at') = 'null'
        then null
      when p_patch ? 'completed_at'
        then (p_patch ->> 'completed_at')::timestamptz
      else completed_at
    end,
    notes = case
      when p_patch ? 'notes' then p_patch ->> 'notes'
      else notes
    end
  where id = current_task.id
    and user_id = caller
    and version = p_expected_version
  returning * into updated_task;

  if updated_task.id is null then
    return public.mcp_result_error(
      'VERSION_CONFLICT',
      '数据已被修改，请重新读取后再提交。',
      jsonb_build_object(
        'task_id', current_task.id,
        'expected_version', p_expected_version
      )
    );
  end if;

  return public.mcp_result_ok(
    format('已更新 %s 第 %s 件事。', p_entry_date, p_slot_index),
    to_jsonb(updated_task) || jsonb_build_object(
      'upstream_path',
      case
        when updated_task.weekly_plan_id is null then '[]'::jsonb
        else public.mcp_plan_upstream_path(
          updated_task.weekly_plan_id,
          caller
        )
      end
    )
  );
exception
  when invalid_text_representation
    or invalid_datetime_format
    or datetime_field_overflow
    or check_violation
    or not_null_violation
    or string_data_right_truncation
  then
    return public.mcp_result_error(
      'INVALID_ARGUMENT',
      '提交的数据格式不正确。',
      jsonb_build_object('sqlstate', sqlstate)
    );
  when others then
    return public.mcp_result_error(
      'DATABASE_ERROR',
      '更新每日任务失败，请稍后重试。',
      jsonb_build_object(
        'operation', 'mcp_update_daily_task',
        'sqlstate', sqlstate
      )
    );
end;
$$;

create or replace function public.mcp_batch_update_daily_tasks(
  p_entry_date date,
  p_tasks jsonb,
  p_atomic boolean default true
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  item jsonb;
  result jsonb;
  successful_tasks jsonb := '[]'::jsonb;
  failed_items jsonb := '[]'::jsonb;
  failed_slot smallint;
  failed_reason text;
  slot_value smallint;
  expected_version_value integer;
  duplicate_slot smallint;
  success_count integer := 0;
  failure_count integer := 0;
begin
  if caller is null then
    return public.mcp_result_error(
      'UNAUTHORIZED',
      '登录状态已失效，请重新登录。',
      '{}'::jsonb
    );
  end if;
  if p_entry_date is null then
    return public.mcp_result_error(
      'BATCH_UPDATE_FAILED',
      '批量更新失败，所有修改已回滚。',
      jsonb_build_object(
        'failed_slot_index', null,
        'reason', 'INVALID_ARGUMENT',
        'field', 'date'
      )
    );
  end if;
  if p_tasks is null or jsonb_typeof(p_tasks) <> 'array' then
    return public.mcp_result_error(
      'BATCH_UPDATE_FAILED',
      '批量更新失败，所有修改已回滚。',
      jsonb_build_object(
        'failed_slot_index', null,
        'reason', 'INVALID_ARGUMENT',
        'field', 'tasks',
        'constraint', 'tasks 必须包含 1–6 条记录'
      )
    );
  end if;
  if jsonb_array_length(p_tasks) < 1
    or jsonb_array_length(p_tasks) > 6
  then
    return public.mcp_result_error(
      'BATCH_UPDATE_FAILED',
      '批量更新失败，所有修改已回滚。',
      jsonb_build_object(
        'failed_slot_index', null,
        'reason', 'INVALID_ARGUMENT',
        'field', 'tasks',
        'constraint', 'tasks 必须包含 1–6 条记录'
      )
    );
  end if;

  for item in select value from jsonb_array_elements(p_tasks)
  loop
    if jsonb_typeof(item) <> 'object' then
      return public.mcp_result_error(
        'BATCH_UPDATE_FAILED',
        '批量更新失败，所有修改已回滚。',
        jsonb_build_object(
          'failed_slot_index', null,
          'reason', 'INVALID_ARGUMENT',
          'field', 'tasks'
        )
      );
    end if;
    if not (item ? 'slot_index')
      or not (item ? 'expected_version')
      or not (item ? 'patch')
    then
      return public.mcp_result_error(
        'BATCH_UPDATE_FAILED',
        '批量更新失败，所有修改已回滚。',
        jsonb_build_object(
          'failed_slot_index', null,
          'reason', 'INVALID_ARGUMENT',
          'field', 'tasks'
        )
      );
    end if;
    if exists (
      select 1
      from jsonb_object_keys(item) as item_keys(key_name)
      where key_name
        <> all(array['slot_index', 'expected_version', 'patch'])
    )
    then
      return public.mcp_result_error(
        'BATCH_UPDATE_FAILED',
        '批量更新失败，所有修改已回滚。',
        jsonb_build_object(
          'failed_slot_index', null,
          'reason', 'INVALID_ARGUMENT',
          'field', 'tasks'
        )
      );
    end if;

    begin
      slot_value := (item ->> 'slot_index')::smallint;
      expected_version_value := (item ->> 'expected_version')::integer;
    exception when others then
      return public.mcp_result_error(
        'BATCH_UPDATE_FAILED',
        '批量更新失败，所有修改已回滚。',
        jsonb_build_object(
          'failed_slot_index', null,
          'reason', 'INVALID_ARGUMENT',
          'field', 'tasks'
        )
      );
    end;

    if slot_value is null
      or slot_value < 1
      or slot_value > 6
      or expected_version_value is null
      or expected_version_value < 1
      or jsonb_typeof(item -> 'patch') <> 'object'
      or item -> 'patch' = '{}'::jsonb
    then
      return public.mcp_result_error(
        'BATCH_UPDATE_FAILED',
        '批量更新失败，所有修改已回滚。',
        jsonb_build_object(
          'failed_slot_index', slot_value,
          'reason', 'INVALID_ARGUMENT'
        )
      );
    end if;
  end loop;

  select slot_index into duplicate_slot
  from (
    select (value ->> 'slot_index')::smallint as slot_index, count(*) as n
    from jsonb_array_elements(p_tasks)
    group by (value ->> 'slot_index')::smallint
  ) duplicates
  where n > 1
  limit 1;

  if duplicate_slot is not null then
    return public.mcp_result_error(
      'BATCH_UPDATE_FAILED',
      '批量更新失败，所有修改已回滚。',
      jsonb_build_object(
        'failed_slot_index', duplicate_slot,
        'reason', 'INVALID_ARGUMENT',
        'constraint', '同一批次的 slot_index 不能重复'
      )
    );
  end if;

  if coalesce(p_atomic, true) then
    begin
      for item in
        select value
        from jsonb_array_elements(p_tasks)
        order by (value ->> 'slot_index')::smallint
      loop
        slot_value := (item ->> 'slot_index')::smallint;
        expected_version_value := (item ->> 'expected_version')::integer;
        result := public.mcp_update_daily_task(
          p_entry_date,
          slot_value,
          expected_version_value,
          item -> 'patch'
        );

        if result ->> 'status' <> 'ok' then
          failed_slot := slot_value;
          failed_reason := coalesce(result ->> 'code', 'INTERNAL_ERROR');
          raise exception using
            errcode = 'P0001',
            message = 'atomic batch item failed';
        end if;
        successful_tasks :=
          successful_tasks || jsonb_build_array(result -> 'data');
      end loop;
    exception when sqlstate 'P0001' then
      return public.mcp_result_error(
        'BATCH_UPDATE_FAILED',
        '批量更新失败，所有修改已回滚。',
        jsonb_build_object(
          'failed_slot_index', failed_slot,
          'reason', coalesce(failed_reason, 'INTERNAL_ERROR')
        )
      );
    when others then
      return public.mcp_result_error(
        'BATCH_UPDATE_FAILED',
        '批量更新失败，所有修改已回滚。',
        jsonb_build_object(
          'failed_slot_index', failed_slot,
          'reason', 'DATABASE_ERROR',
          'sqlstate', sqlstate
        )
      );
    end;

    return public.mcp_result_ok(
      format(
        '已批量更新 %s 的 %s 件事。',
        p_entry_date,
        jsonb_array_length(successful_tasks)
      ),
      jsonb_build_object(
        'atomic', true,
        'tasks', successful_tasks
      )
    );
  end if;

  for item in
    select value
    from jsonb_array_elements(p_tasks)
    order by (value ->> 'slot_index')::smallint
  loop
    slot_value := (item ->> 'slot_index')::smallint;
    expected_version_value := (item ->> 'expected_version')::integer;
    result := public.mcp_update_daily_task(
      p_entry_date,
      slot_value,
      expected_version_value,
      item -> 'patch'
    );

    if result ->> 'status' = 'ok' then
      success_count := success_count + 1;
      successful_tasks :=
        successful_tasks || jsonb_build_array(result -> 'data');
    else
      failure_count := failure_count + 1;
      failed_items := failed_items || jsonb_build_array(
        jsonb_build_object(
          'slot_index', slot_value,
          'code', coalesce(result ->> 'code', 'INTERNAL_ERROR'),
          'message', coalesce(result ->> 'message', '操作未完成。'),
          'details',
            case
              when jsonb_typeof(result -> 'details') = 'object'
                then result -> 'details'
              else '{}'::jsonb
            end
        )
      );
    end if;
  end loop;

  if failure_count > 0 then
    return public.mcp_result_error(
      'PARTIAL_FAILURE',
      format(
        '部分更新完成：%s 条成功，%s 条失败；请先重新读取再处理失败项。',
        success_count,
        failure_count
      ),
      jsonb_build_object(
        'atomic', false,
        'successful_tasks', successful_tasks,
        'errors', failed_items
      )
    );
  end if;

  return public.mcp_result_ok(
    format('已批量更新 %s 的 %s 件事。', p_entry_date, success_count),
    jsonb_build_object(
      'atomic', false,
      'tasks', successful_tasks,
      'errors', '[]'::jsonb
    )
  );
exception
  when others then
    return public.mcp_result_error(
      'BATCH_UPDATE_FAILED',
      '批量更新失败，所有修改已回滚。',
      jsonb_build_object(
        'failed_slot_index', failed_slot,
        'reason', 'DATABASE_ERROR',
        'sqlstate', sqlstate
      )
    );
end;
$$;

create or replace function public.mcp_create_plan(
  p_id uuid,
  p_plan_type text,
  p_title text,
  p_period_start date,
  p_period_end date,
  p_status text default 'draft',
  p_importance text default '',
  p_objective text default '',
  p_completion_standard text default '',
  p_first_action text default '',
  p_parent_plan_id uuid default null,
  p_direction_id uuid default null,
  p_notes text default ''
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  existing_plan public.plans%rowtype;
  inserted_plan public.plans%rowtype;
  parent_plan public.plans%rowtype;
  direction_owner uuid;
  warnings jsonb;
  is_same_request boolean;
begin
  if caller is null then
    return public.mcp_result_error(
      'UNAUTHORIZED',
      '登录状态已失效，请重新登录。',
      '{}'::jsonb
    );
  end if;
  if p_id is null then
    return public.mcp_result_error(
      'INVALID_ARGUMENT',
      'id 必须是客户端生成的 UUID。',
      jsonb_build_object('field', 'id')
    );
  end if;
  if p_plan_type is null
    or p_plan_type <> all(array['annual', 'monthly', 'weekly'])
  then
    return public.mcp_result_error(
      'INVALID_ARGUMENT',
      'plan_type 只允许 annual、monthly 或 weekly。',
      jsonb_build_object('field', 'plan_type')
    );
  end if;
  if p_title is null
    or btrim(p_title) = ''
    or char_length(p_title) > 200
  then
    return public.mcp_result_error(
      'INVALID_ARGUMENT',
      '计划标题长度必须为 1–200 个字符。',
      jsonb_build_object('field', 'title')
    );
  end if;
  if p_period_start is null or p_period_end is null then
    return public.mcp_result_error(
      'INVALID_ARGUMENT',
      '计划开始和结束日期不能为空。',
      jsonb_build_object('field', 'period')
    );
  end if;
  if p_period_start > p_period_end then
    return public.mcp_result_error(
      'INVALID_ARGUMENT',
      '开始日期不能晚于结束日期。',
      jsonb_build_object(
        'period_start', p_period_start,
        'period_end', p_period_end
      )
    );
  end if;
  if p_status is null
    or p_status <> all(array[
      'draft',
      'active',
      'paused',
      'completed',
      'archived'
    ])
  then
    return public.mcp_result_error(
      'INVALID_ARGUMENT',
      '计划状态不合法。',
      jsonb_build_object('field', 'status')
    );
  end if;

  -- Resolve the idempotency key before validating mutable parent state.
  -- An exact replay must stay idempotent even if its parent or direction was
  -- archived after the original insert.
  select * into existing_plan
  from public.plans
  where id = p_id
    and user_id = caller
  for update;

  if existing_plan.id is not null then
    if existing_plan.deleted_at is not null then
      return public.mcp_result_error(
        'RECORD_DELETED',
        '相同 id 的计划已被删除，不能重复使用该 id。',
        jsonb_build_object('plan_id', p_id)
      );
    end if;

    is_same_request :=
      existing_plan.plan_type = p_plan_type
      and existing_plan.title = p_title
      and existing_plan.period_start = p_period_start
      and existing_plan.period_end = p_period_end
      and existing_plan.status = p_status
      and existing_plan.importance = coalesce(p_importance, '')
      and existing_plan.objective = coalesce(p_objective, '')
      and existing_plan.completion_standard
        = coalesce(p_completion_standard, '')
      and existing_plan.first_action = coalesce(p_first_action, '')
      and existing_plan.parent_id is not distinct from p_parent_plan_id
      and existing_plan.direction_id is not distinct from p_direction_id
      and existing_plan.notes = coalesce(p_notes, '');

    if not is_same_request then
      return public.mcp_result_error(
        'IDEMPOTENCY_CONFLICT',
        '相同 id 已用于另一份计划，请读取现有计划或使用新的 UUID。',
        jsonb_build_object(
          'plan_id', p_id,
          'current_version', existing_plan.version
        )
      );
    end if;

    warnings := public.mcp_plan_period_warnings(
      existing_plan.plan_type,
      existing_plan.period_start,
      existing_plan.period_end
    );
    return public.mcp_result_ok(
      '该计划已存在，未重复创建。',
      to_jsonb(existing_plan) || jsonb_build_object(
        'parent_plan_id', existing_plan.parent_id,
        'upstream_path',
          public.mcp_plan_upstream_path(existing_plan.id, caller),
        'warnings', warnings,
        'idempotent_replay', true
      )
    );
  end if;

  if p_plan_type = 'annual' then
    if p_parent_plan_id is not null or p_direction_id is null then
      return public.mcp_result_error(
        'HIERARCHY_VIOLATION',
        '年度计划必须关联方向，且不能有上级计划。',
        jsonb_build_object(
          'parent_plan_id', p_parent_plan_id,
          'direction_id', p_direction_id
        )
      );
    end if;

    select user_id into direction_owner
    from public.directions
    where id = p_direction_id
      and user_id = caller
      and deleted_at is null
      and archived_at is null;
    if direction_owner is null then
      return public.mcp_result_error(
        'HIERARCHY_VIOLATION',
        '年度计划必须关联当前用户的有效方向。',
        jsonb_build_object('direction_id', p_direction_id)
      );
    end if;
  else
    if p_parent_plan_id is null or p_direction_id is not null then
      return public.mcp_result_error(
        'HIERARCHY_VIOLATION',
        '月度和周计划必须关联上级计划，且不能直接关联方向。',
        jsonb_build_object(
          'parent_plan_id', p_parent_plan_id,
          'direction_id', p_direction_id
        )
      );
    end if;

    if p_parent_plan_id = p_id then
      return public.mcp_result_error(
        'CYCLE_DETECTED',
        '计划不能把自己设为上级计划。',
        jsonb_build_object('parent_plan_id', p_parent_plan_id)
      );
    end if;

    select * into parent_plan
    from public.plans
    where id = p_parent_plan_id
      and user_id = caller
      and deleted_at is null
      and archived_at is null
      and status <> 'archived';
    if parent_plan.id is null then
      return public.mcp_result_error(
        'HIERARCHY_VIOLATION',
        '上级计划不存在、已删除、已归档或不属于当前用户。',
        jsonb_build_object('parent_plan_id', p_parent_plan_id)
      );
    end if;
    if p_plan_type = 'monthly' and parent_plan.plan_type <> 'annual' then
      return public.mcp_result_error(
        'HIERARCHY_VIOLATION',
        '月计划只能关联年计划。',
        jsonb_build_object(
          'parent_plan_id', p_parent_plan_id,
          'parent_plan_type', parent_plan.plan_type
        )
      );
    end if;
    if p_plan_type = 'weekly' and parent_plan.plan_type <> 'monthly' then
      return public.mcp_result_error(
        'HIERARCHY_VIOLATION',
        '周计划只能关联月计划。',
        jsonb_build_object(
          'parent_plan_id', p_parent_plan_id,
          'parent_plan_type', parent_plan.plan_type
        )
      );
    end if;
  end if;

  insert into public.plans (
    id,
    user_id,
    plan_type,
    title,
    objective,
    period_start,
    period_end,
    completion_standard,
    status,
    parent_id,
    direction_id,
    importance,
    first_action,
    notes,
    archived_at
  )
  values (
    p_id,
    caller,
    p_plan_type,
    p_title,
    coalesce(p_objective, ''),
    p_period_start,
    p_period_end,
    coalesce(p_completion_standard, ''),
    p_status,
    p_parent_plan_id,
    p_direction_id,
    coalesce(p_importance, ''),
    coalesce(p_first_action, ''),
    coalesce(p_notes, ''),
    case
      when p_status = 'archived' then timezone('utc', now())
      else null
    end
  )
  returning * into inserted_plan;

  warnings := public.mcp_plan_period_warnings(
    inserted_plan.plan_type,
    inserted_plan.period_start,
    inserted_plan.period_end
  );
  return public.mcp_result_ok(
    format(
      '已新增%s计划。',
      case inserted_plan.plan_type
        when 'annual' then '年度'
        when 'monthly' then '月度'
        else '周'
      end
    ),
    to_jsonb(inserted_plan) || jsonb_build_object(
      'parent_plan_id', inserted_plan.parent_id,
      'upstream_path',
        public.mcp_plan_upstream_path(inserted_plan.id, caller),
      'warnings', warnings,
      'idempotent_replay', false
    )
  );
exception
  when unique_violation then
    select * into existing_plan
    from public.plans
    where id = p_id
      and user_id = caller;

    is_same_request :=
      existing_plan.id is not null
      and existing_plan.deleted_at is null
      and existing_plan.plan_type = p_plan_type
      and existing_plan.title = p_title
      and existing_plan.period_start = p_period_start
      and existing_plan.period_end = p_period_end
      and existing_plan.status = p_status
      and existing_plan.importance = coalesce(p_importance, '')
      and existing_plan.objective = coalesce(p_objective, '')
      and existing_plan.completion_standard
        = coalesce(p_completion_standard, '')
      and existing_plan.first_action = coalesce(p_first_action, '')
      and existing_plan.parent_id is not distinct from p_parent_plan_id
      and existing_plan.direction_id is not distinct from p_direction_id
      and existing_plan.notes = coalesce(p_notes, '');

    if is_same_request then
      warnings := public.mcp_plan_period_warnings(
        existing_plan.plan_type,
        existing_plan.period_start,
        existing_plan.period_end
      );
      return public.mcp_result_ok(
        '该计划已存在，未重复创建。',
        to_jsonb(existing_plan) || jsonb_build_object(
          'parent_plan_id', existing_plan.parent_id,
          'upstream_path',
            public.mcp_plan_upstream_path(existing_plan.id, caller),
          'warnings', warnings,
          'idempotent_replay', true
        )
      );
    end if;

    return public.mcp_result_error(
      'IDEMPOTENCY_CONFLICT',
      '相同 id 已存在，未创建重复计划。',
      jsonb_build_object('plan_id', p_id)
    );
  when check_violation
    or not_null_violation
    or string_data_right_truncation
  then
    return public.mcp_result_error(
      'INVALID_ARGUMENT',
      '计划数据不符合约束。',
      jsonb_build_object('sqlstate', sqlstate)
    );
  when others then
    return public.mcp_result_error(
      'DATABASE_ERROR',
      '新增计划失败，请稍后重试。',
      jsonb_build_object(
        'operation', 'mcp_create_plan',
        'sqlstate', sqlstate
      )
    );
end;
$$;

create or replace function public.mcp_update_plan(
  p_plan_id uuid,
  p_expected_version integer,
  p_patch jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  current_plan public.plans%rowtype;
  updated_plan public.plans%rowtype;
  parent_plan public.plans%rowtype;
  unknown_keys jsonb;
  key_name text;
  next_period_start date;
  next_period_end date;
  next_parent_id uuid;
  warnings jsonb;
  creates_cycle boolean := false;
begin
  if caller is null then
    return public.mcp_result_error(
      'UNAUTHORIZED',
      '登录状态已失效，请重新登录。',
      '{}'::jsonb
    );
  end if;
  if p_plan_id is null then
    return public.mcp_result_error(
      'INVALID_ARGUMENT',
      'plan_id 必须是 UUID。',
      jsonb_build_object('field', 'plan_id')
    );
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    return public.mcp_result_error(
      'INVALID_ARGUMENT',
      'expected_version 必须是大于 0 的整数。',
      jsonb_build_object('field', 'expected_version')
    );
  end if;
  if p_patch is null
    or jsonb_typeof(p_patch) <> 'object'
    or p_patch = '{}'::jsonb
  then
    return public.mcp_result_error(
      'INVALID_ARGUMENT',
      'patch 必须是包含至少一个可修改字段的对象。',
      jsonb_build_object('field', 'patch')
    );
  end if;

  select coalesce(jsonb_agg(patch_key), '[]'::jsonb)
  into unknown_keys
  from jsonb_object_keys(p_patch) as patch_keys(patch_key)
  where patch_key <> all(array[
    'title',
    'objective',
    'period_start',
    'period_end',
    'status',
    'importance',
    'completion_standard',
    'first_action',
    'parent_plan_id',
    'notes'
  ]);
  if jsonb_array_length(unknown_keys) > 0 then
    return public.mcp_result_error(
      'INVALID_ARGUMENT',
      'patch 包含不可修改的字段。',
      jsonb_build_object('unknown_fields', unknown_keys)
    );
  end if;

  foreach key_name in array array[
    'title',
    'objective',
    'period_start',
    'period_end',
    'status',
    'importance',
    'completion_standard',
    'first_action',
    'notes'
  ]
  loop
    if p_patch ? key_name and jsonb_typeof(p_patch -> key_name) <> 'string' then
      return public.mcp_result_error(
        'INVALID_ARGUMENT',
        format('%s 必须是字符串。', key_name),
        jsonb_build_object('field', key_name)
      );
    end if;
  end loop;

  if p_patch ? 'parent_plan_id'
    and jsonb_typeof(p_patch -> 'parent_plan_id') not in ('string', 'null')
  then
    return public.mcp_result_error(
      'INVALID_ARGUMENT',
      'parent_plan_id 必须是 UUID 或 null。',
      jsonb_build_object('field', 'parent_plan_id')
    );
  end if;
  if p_patch ? 'title'
    and (
      btrim(p_patch ->> 'title') = ''
      or char_length(p_patch ->> 'title') > 200
    )
  then
    return public.mcp_result_error(
      'INVALID_ARGUMENT',
      '计划标题长度必须为 1–200 个字符。',
      jsonb_build_object('field', 'title')
    );
  end if;
  if p_patch ? 'status'
    and (p_patch ->> 'status') <> all(array[
      'draft',
      'active',
      'paused',
      'completed',
      'archived'
    ])
  then
    return public.mcp_result_error(
      'INVALID_ARGUMENT',
      '计划状态不合法。',
      jsonb_build_object('field', 'status')
    );
  end if;

  select * into current_plan
  from public.plans
  where id = p_plan_id
    and user_id = caller
  for update;

  if current_plan.id is null then
    return public.mcp_result_error(
      'NOT_FOUND',
      '未找到该计划。',
      jsonb_build_object('plan_id', p_plan_id)
    );
  end if;
  if current_plan.deleted_at is not null then
    return public.mcp_result_error(
      'RECORD_DELETED',
      '该计划已删除，不能修改。',
      jsonb_build_object('plan_id', p_plan_id)
    );
  end if;
  if current_plan.version <> p_expected_version then
    return public.mcp_result_error(
      'VERSION_CONFLICT',
      '计划已被修改，请重新读取后再提交。',
      jsonb_build_object(
        'plan_id', p_plan_id,
        'expected_version', p_expected_version,
        'current_version', current_plan.version,
        'current', to_jsonb(current_plan)
      )
    );
  end if;

  begin
    next_period_start := case
      when p_patch ? 'period_start'
        then (p_patch ->> 'period_start')::date
      else current_plan.period_start
    end;
    next_period_end := case
      when p_patch ? 'period_end'
        then (p_patch ->> 'period_end')::date
      else current_plan.period_end
    end;
    next_parent_id := case
      when p_patch ? 'parent_plan_id'
        and jsonb_typeof(p_patch -> 'parent_plan_id') = 'null'
        then null
      when p_patch ? 'parent_plan_id'
        then (p_patch ->> 'parent_plan_id')::uuid
      else current_plan.parent_id
    end;
  exception when others then
    return public.mcp_result_error(
      'INVALID_ARGUMENT',
      '日期或 parent_plan_id 格式不正确。',
      jsonb_build_object('sqlstate', sqlstate)
    );
  end;

  if next_period_start > next_period_end then
    return public.mcp_result_error(
      'INVALID_ARGUMENT',
      '开始日期不能晚于结束日期。',
      jsonb_build_object(
        'period_start', next_period_start,
        'period_end', next_period_end
      )
    );
  end if;

  if current_plan.plan_type = 'annual' and next_parent_id is not null then
    return public.mcp_result_error(
      'HIERARCHY_VIOLATION',
      '年度计划不能有上级计划。',
      jsonb_build_object('parent_plan_id', next_parent_id)
    );
  end if;
  if current_plan.plan_type in ('monthly', 'weekly')
    and next_parent_id is null
  then
    return public.mcp_result_error(
      'HIERARCHY_VIOLATION',
      '月度和周计划必须保留合法的上级计划。',
      jsonb_build_object('parent_plan_id', null)
    );
  end if;

  if p_patch ? 'parent_plan_id' and next_parent_id is not null then
    if next_parent_id = current_plan.id then
      return public.mcp_result_error(
        'CYCLE_DETECTED',
        '计划不能把自己设为上级计划。',
        jsonb_build_object('parent_plan_id', next_parent_id)
      );
    end if;

    with recursive descendants(id) as (
      select p.id
      from public.plans p
      where p.parent_id = current_plan.id
        and p.user_id = caller
        and p.deleted_at is null
      union
      select p.id
      from public.plans p
      join descendants d on p.parent_id = d.id
      where p.user_id = caller
        and p.deleted_at is null
    )
    select exists (
      select 1 from descendants where id = next_parent_id
    ) into creates_cycle;
    if creates_cycle then
      return public.mcp_result_error(
        'CYCLE_DETECTED',
        '该上级计划会形成循环引用。',
        jsonb_build_object('parent_plan_id', next_parent_id)
      );
    end if;

    select * into parent_plan
    from public.plans
    where id = next_parent_id
      and user_id = caller
      and deleted_at is null
      and archived_at is null
      and status <> 'archived';
    if parent_plan.id is null then
      return public.mcp_result_error(
        'HIERARCHY_VIOLATION',
        '上级计划不存在、已删除、已归档或不属于当前用户。',
        jsonb_build_object('parent_plan_id', next_parent_id)
      );
    end if;
    if current_plan.plan_type = 'monthly'
      and parent_plan.plan_type <> 'annual'
    then
      return public.mcp_result_error(
        'HIERARCHY_VIOLATION',
        '月计划只能关联年计划。',
        jsonb_build_object(
          'parent_plan_id', next_parent_id,
          'parent_plan_type', parent_plan.plan_type
        )
      );
    end if;
    if current_plan.plan_type = 'weekly'
      and parent_plan.plan_type <> 'monthly'
    then
      return public.mcp_result_error(
        'HIERARCHY_VIOLATION',
        '周计划只能关联月计划。',
        jsonb_build_object(
          'parent_plan_id', next_parent_id,
          'parent_plan_type', parent_plan.plan_type
        )
      );
    end if;
  end if;

  update public.plans
  set
    title = case
      when p_patch ? 'title' then p_patch ->> 'title'
      else title
    end,
    objective = case
      when p_patch ? 'objective' then p_patch ->> 'objective'
      else objective
    end,
    period_start = next_period_start,
    period_end = next_period_end,
    status = case
      when p_patch ? 'status' then p_patch ->> 'status'
      else status
    end,
    importance = case
      when p_patch ? 'importance' then p_patch ->> 'importance'
      else importance
    end,
    completion_standard = case
      when p_patch ? 'completion_standard'
        then p_patch ->> 'completion_standard'
      else completion_standard
    end,
    first_action = case
      when p_patch ? 'first_action' then p_patch ->> 'first_action'
      else first_action
    end,
    parent_id = next_parent_id,
    notes = case
      when p_patch ? 'notes' then p_patch ->> 'notes'
      else notes
    end,
    archived_at = case
      when p_patch ? 'status' and p_patch ->> 'status' = 'archived'
        then coalesce(archived_at, timezone('utc', now()))
      when p_patch ? 'status' and p_patch ->> 'status' <> 'archived'
        then null
      else archived_at
    end
  where id = current_plan.id
    and user_id = caller
    and version = p_expected_version
  returning * into updated_plan;

  if updated_plan.id is null then
    return public.mcp_result_error(
      'VERSION_CONFLICT',
      '计划已被修改，请重新读取后再提交。',
      jsonb_build_object(
        'plan_id', p_plan_id,
        'expected_version', p_expected_version
      )
    );
  end if;

  warnings := public.mcp_plan_period_warnings(
    updated_plan.plan_type,
    updated_plan.period_start,
    updated_plan.period_end
  );
  return public.mcp_result_ok(
    '已修改计划。',
    to_jsonb(updated_plan) || jsonb_build_object(
      'parent_plan_id', updated_plan.parent_id,
      'upstream_path',
        public.mcp_plan_upstream_path(updated_plan.id, caller),
      'warnings', warnings
    )
  );
exception
  when invalid_text_representation
    or invalid_datetime_format
    or datetime_field_overflow
    or check_violation
    or not_null_violation
    or string_data_right_truncation
  then
    return public.mcp_result_error(
      'INVALID_ARGUMENT',
      '提交的计划数据格式不正确。',
      jsonb_build_object('sqlstate', sqlstate)
    );
  when others then
    return public.mcp_result_error(
      'DATABASE_ERROR',
      '修改计划失败，请稍后重试。',
      jsonb_build_object(
        'operation', 'mcp_update_plan',
        'sqlstate', sqlstate
      )
    );
end;
$$;

comment on function public.mcp_update_daily_task(date, integer, integer, jsonb)
is 'Update one existing daily-task slot with an optimistic version check.';
comment on function public.mcp_batch_update_daily_tasks(date, jsonb, boolean)
is 'Update 1-6 daily-task slots; atomic=true rolls the whole subtransaction back on any failure.';
comment on function public.mcp_create_plan(
  uuid,
  text,
  text,
  date,
  date,
  text,
  text,
  text,
  text,
  text,
  uuid,
  uuid,
  text
)
is 'Create an annual, monthly or weekly plan using a client UUID as the idempotency key.';
comment on function public.mcp_update_plan(uuid, integer, jsonb)
is 'Update an existing plan using an optimistic version check and a strict patch allow-list.';

revoke all on function public.mcp_result_ok(text, jsonb) from public;
revoke all on function public.mcp_result_error(text, text, jsonb) from public;
revoke all on function public.mcp_plan_upstream_path(uuid, uuid) from public;
revoke all on function public.mcp_plan_period_warnings(text, date, date)
  from public;
revoke all on function public.mcp_update_daily_task(
  date,
  integer,
  integer,
  jsonb
) from public;
revoke all on function public.mcp_batch_update_daily_tasks(
  date,
  jsonb,
  boolean
) from public;
revoke all on function public.mcp_create_plan(
  uuid,
  text,
  text,
  date,
  date,
  text,
  text,
  text,
  text,
  text,
  uuid,
  uuid,
  text
) from public;
revoke all on function public.mcp_update_plan(uuid, integer, jsonb)
  from public;

grant execute on function public.mcp_update_daily_task(
  date,
  integer,
  integer,
  jsonb
) to authenticated;
grant execute on function public.mcp_result_ok(text, jsonb)
  to authenticated;
grant execute on function public.mcp_result_error(text, text, jsonb)
  to authenticated;
grant execute on function public.mcp_plan_upstream_path(uuid, uuid)
  to authenticated;
grant execute on function public.mcp_plan_period_warnings(text, date, date)
  to authenticated;
grant execute on function public.mcp_batch_update_daily_tasks(
  date,
  jsonb,
  boolean
) to authenticated;
grant execute on function public.mcp_create_plan(
  uuid,
  text,
  text,
  date,
  date,
  text,
  text,
  text,
  text,
  text,
  uuid,
  uuid,
  text
) to authenticated;
grant execute on function public.mcp_update_plan(uuid, integer, jsonb)
  to authenticated;
