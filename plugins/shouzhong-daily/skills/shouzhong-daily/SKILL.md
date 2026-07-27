---
name: shouzhong-daily
description: Use the 守中日课 MCP server to read plans and execution data, update confirmed daily records, save genuine accumulations, and prepare review drafts.
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
- Do not infer medical, nutrition, or calorie conclusions from meal records.
- Send only the minimum data needed for the user's request.

## Read workflows

For today's priorities:

1. Call `get_today` for the user's date.
2. If more planning context is needed, call `list_plans`.
3. Explain the upstream path and completion standard without changing records.

For a review:

1. Call `get_period_summary` for the exact period.
2. Use `search_accumulations` only if actual accumulated outcomes are relevant.
3. Clearly distinguish stored facts from your interpretation.

## Write workflows

Before `update_daily_task`, `upsert_meal_log`, or `save_review_draft`, read the current record and obtain explicit confirmation.

`add_exercise` creates one independent session. The same day may have multiple sessions.

`add_accumulation` is only for outcomes the user deliberately wants to retain. Never add every completed task by default.

`save_review_draft` writes only the editable `ai_draft`; it must not replace a formal review.
