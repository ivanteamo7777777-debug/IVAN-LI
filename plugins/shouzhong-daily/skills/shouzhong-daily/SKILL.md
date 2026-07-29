---
name: shouzhong-daily
description: Use the 守中日课 MCP server to read or update plans and daily execution, atomically update the six daily slots, save genuine accumulations, and prepare review drafts.
---

# 守中日课

Use this skill when the user wants to work with their 守中日课 personal daily management library.

## Operating principles

- Read the relevant current record before any write.
- Treat the six daily tasks as six independent numbered slots, not six fixed categories.
- Keep exercise and meals separate from the six daily task slots.
- Never postpone an unfinished task or replace a slot automatically.
- AI suggestions and review text are drafts. Do not write them until the user explicitly confirms in the current conversation.
- Use the record's current `version` as `expected_version`. If the tool returns a conflict, show the current cloud version and ask the user which version to keep.
- Treat every `status: "error"` result as a failed write. Never infer success from partial text.
- Do not infer medical, nutrition, or calorie conclusions from meal records.
- Send only the minimum data needed for the user's request.

## Read workflows

For today's priorities:

1. Call `get_today` for the user's date.
2. If more planning context is needed, call `list_plans`.
3. Explain the upstream path and completion standard without changing records.

For one plan:

1. Call `get_plan` with its UUID.
2. Use the returned `version`, parent, upstream path, child counts, and linked-task count.
3. Call `update_plan` only after the user confirms the exact patch.

For a review:

1. Call `get_period_summary` for the exact period.
2. Use `search_accumulations` only if actual accumulated outcomes are relevant.
3. Clearly distinguish stored facts from your interpretation.

## Write workflows

Before `update_daily_task`, `batch_update_daily_tasks`, `create_plan`, `update_plan`, `upsert_meal_log`, or `save_review_draft`, read the relevant current data and obtain explicit confirmation.

To update one daily slot:

1. Call `get_today`.
2. Confirm the exact date, slot, and patch with the user.
3. Call `update_daily_task` with the returned `version`.
4. On `VERSION_CONFLICT`, read again and do not retry automatically.

To update multiple daily slots:

1. Call `get_today` once.
2. Confirm all changes together.
3. Call `batch_update_daily_tasks` once with each slot's current version.
4. Keep `atomic` omitted or `true`; use `false` only when the user explicitly accepts partial success.
5. On `BATCH_UPDATE_FAILED`, no item was saved. On `PARTIAL_FAILURE`, some items were saved; read again before handling only failed items.

To create a plan:

1. If the user wants a relationship, read parents with `list_plans`; call `list_directions` only when an annual plan should link to a direction.
2. Confirm the complete plan with the user.
3. Generate one UUID and keep it for retries.
4. Call `create_plan`. Relationships are optional: annual plans may omit `direction_id`, and monthly or weekly plans may omit `parent_plan_id`. When selected, monthly parents must be annual and weekly parents must be monthly.

To update a plan:

1. Call `get_plan`.
2. Confirm the exact patch.
3. Call `update_plan` with the current `version`.
4. Never change hierarchy implicitly. Do not retry a version conflict without reading again.

`add_exercise` creates one independent session. The same day may have multiple sessions.

`add_accumulation` is only for outcomes the user deliberately wants to retain. Never add every completed task by default.

`save_review_draft` writes only the editable `ai_draft`; it must not replace a formal review.
