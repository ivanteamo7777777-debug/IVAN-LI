import { z } from "zod";

export const dailySixOutputSchema = z.object({
  suggestions: z
    .array(
      z.object({
        title: z.string().max(120),
        importance: z.string().max(500),
        completion_standard: z.string().max(500),
        first_action: z.string().max(500),
        weekly_plan_id: z.string().nullable(),
      }),
    )
    .length(6),
});

export const dailyReviewOutputSchema = z.object({
  done: z.string(),
  six_summary: z.string(),
  incomplete_reasons: z.string(),
  important_accumulation: z.string(),
  exercise: z.string(),
  meals: z.string(),
  chaos: z.string(),
  tomorrow_adjustment: z.string(),
  one_sentence: z.string(),
});

export const periodReviewOutputSchema = z.object({
  plan_completion: z.string(),
  daily_trend: z.string(),
  repeated_delays: z.string(),
  accumulation_count: z.string(),
  continuity: z.string(),
  main_problems: z.string(),
  next_focus: z.string(),
});

export const compactDirectionSchema = z.object({
  kind: z.string().max(40),
  title: z.string().max(120),
  content: z.string().max(1200),
});

export const compactPlanSchema = z.object({
  id: z.string(),
  plan_type: z.string().max(20),
  title: z.string().max(160),
  objective: z.string().max(800),
  completion_standard: z.string().max(800),
  parent_id: z.string().nullable(),
});

export const compactTaskSchema = z.object({
  entry_date: z.string().optional(),
  slot_index: z.number().optional(),
  title: z.string().max(160),
  status: z.string().optional(),
  importance: z.string().max(800).optional(),
  completion_standard: z.string().max(800).optional(),
  result: z.string().max(1200).optional(),
});
