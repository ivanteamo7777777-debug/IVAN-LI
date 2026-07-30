-- Weekly plans may be independent or link directly to either an annual or a
-- monthly plan. Monthly plans continue to accept annual parents only.
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

  if p_plan_type = 'weekly'
    and parent_plan.plan_type not in ('annual', 'monthly')
  then
    return public.mcp_result_error(
      'HIERARCHY_VIOLATION',
      '周计划只能关联年计划或月计划。',
      jsonb_build_object(
        'parent_plan_id', p_parent_plan_id,
        'parent_plan_type', parent_plan.plan_type
      )
    );
  end if;

  return null;
end;
$$;

grant execute on function public.mcp_plan_relationship_error(
  uuid,
  uuid,
  text,
  uuid,
  uuid
) to authenticated, service_role;
