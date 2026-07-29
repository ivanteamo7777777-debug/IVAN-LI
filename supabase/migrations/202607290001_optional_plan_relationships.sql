-- Allow annual, monthly and weekly plans to exist independently.
-- Relationships remain type-safe and cycle-free whenever the user selects one.

alter table public.plans
  drop constraint if exists plans_relationship_shape;

alter table public.plans
  add constraint plans_relationship_shape check (
    (plan_type = 'annual' and parent_id is null)
    or
    (
      plan_type in ('monthly', 'weekly')
      and direction_id is null
    )
  );

create or replace function public.mcp_plan_relationship_error(
  p_user_id uuid,
  p_plan_id uuid,
  p_plan_type text,
  p_parent_plan_id uuid,
  p_direction_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  parent_plan public.plans%rowtype;
  direction_owner uuid;
  creates_cycle boolean := false;
begin
  if p_plan_type = 'annual' then
    if p_parent_plan_id is not null then
      return public.mcp_result_error(
        'HIERARCHY_VIOLATION',
        '年度计划不能设置上级计划。',
        jsonb_build_object('parent_plan_id', p_parent_plan_id)
      );
    end if;

    if p_direction_id is null then
      return null;
    end if;

    select user_id into direction_owner
    from public.directions
    where id = p_direction_id
      and user_id = p_user_id
      and deleted_at is null
      and archived_at is null
    for share;

    if direction_owner is null then
      return public.mcp_result_error(
        'HIERARCHY_VIOLATION',
        '所选方向不存在、已归档或不属于当前用户。',
        jsonb_build_object('direction_id', p_direction_id)
      );
    end if;
    return null;
  end if;

  if p_plan_type is null
    or p_plan_type not in ('monthly', 'weekly')
  then
    return public.mcp_result_error(
      'INVALID_ARGUMENT',
      'plan_type 只允许 annual、monthly 或 weekly。',
      jsonb_build_object('plan_type', p_plan_type)
    );
  end if;

  if p_direction_id is not null then
    return public.mcp_result_error(
      'HIERARCHY_VIOLATION',
      '月度和周计划不能直接关联方向。',
      jsonb_build_object('direction_id', p_direction_id)
    );
  end if;

  if p_parent_plan_id is null then
    return null;
  end if;

  if p_parent_plan_id = p_plan_id then
    return public.mcp_result_error(
      'CYCLE_DETECTED',
      '计划不能把自己设为上级计划。',
      jsonb_build_object('parent_plan_id', p_parent_plan_id)
    );
  end if;

  with recursive descendants(id) as (
    select p.id
    from public.plans p
    where p.parent_id = p_plan_id
      and p.user_id = p_user_id
      and p.deleted_at is null
    union
    select p.id
    from public.plans p
    join descendants d on p.parent_id = d.id
    where p.user_id = p_user_id
      and p.deleted_at is null
  )
  select exists (
    select 1
    from descendants
    where id = p_parent_plan_id
  ) into creates_cycle;

  if creates_cycle then
    return public.mcp_result_error(
      'CYCLE_DETECTED',
      '该上级计划会形成循环引用。',
      jsonb_build_object('parent_plan_id', p_parent_plan_id)
    );
  end if;

  select * into parent_plan
  from public.plans
  where id = p_parent_plan_id
    and user_id = p_user_id
    and deleted_at is null
    and archived_at is null
    and status <> 'archived'
  for share;

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

  return null;
end;
$$;

create or replace function public.validate_plan_hierarchy()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  relationship_error jsonb;
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

  relationship_error := public.mcp_plan_relationship_error(
    new.user_id,
    new.id,
    new.plan_type,
    new.parent_id,
    new.direction_id
  );

  if relationship_error is not null then
    raise exception using
      errcode = '23514',
      message = relationship_error ->> 'message';
  end if;

  return new;
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
  relationship_error jsonb;
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

  -- Resolve the idempotency key before checking mutable relationship state.
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

  relationship_error := public.mcp_plan_relationship_error(
    caller,
    p_id,
    p_plan_type,
    p_parent_plan_id,
    p_direction_id
  );
  if relationship_error is not null then
    return relationship_error;
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
  unknown_keys jsonb;
  key_name text;
  next_period_start date;
  next_period_end date;
  next_parent_id uuid;
  relationship_error jsonb;
  warnings jsonb;
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
      '年度计划不能设置上级计划。',
      jsonb_build_object('parent_plan_id', next_parent_id)
    );
  end if;

  if p_patch ? 'parent_plan_id'
    and current_plan.plan_type in ('monthly', 'weekly')
  then
    relationship_error := public.mcp_plan_relationship_error(
      caller,
      current_plan.id,
      current_plan.plan_type,
      next_parent_id,
      current_plan.direction_id
    );
    if relationship_error is not null then
      return relationship_error;
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

comment on function public.mcp_plan_relationship_error(
  uuid,
  uuid,
  text,
  uuid,
  uuid
)
is 'Return null for a valid optional plan relationship, otherwise a structured MCP error.';

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
is 'Create an independent or linked annual, monthly or weekly plan using a client UUID as the idempotency key.';

comment on function public.mcp_update_plan(uuid, integer, jsonb)
is 'Update a plan with optimistic locking; omit parent_plan_id to keep the relationship or pass null to make the plan independent.';

revoke all on function public.mcp_plan_relationship_error(
  uuid,
  uuid,
  text,
  uuid,
  uuid
) from public;
grant execute on function public.mcp_plan_relationship_error(
  uuid,
  uuid,
  text,
  uuid,
  uuid
) to authenticated;
grant execute on function public.mcp_plan_relationship_error(
  uuid,
  uuid,
  text,
  uuid,
  uuid
) to service_role;
grant execute on function public.mcp_result_error(text, text, jsonb)
  to service_role;
