export type SyncStatus =
  "synced" | "pending" | "syncing" | "failed" | "conflict";

export type DirectionKind =
  | "mission"
  | "vision"
  | "value"
  | "life_direction"
  | "long_term_theme"
  | "desired_state"
  | "not_doing";

export type PlanType = "annual" | "monthly" | "weekly";
export type PlanStatus =
  "draft" | "active" | "paused" | "completed" | "archived";

export type TaskStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "not_completed"
  | "not_scheduled";

export type ReviewType = "daily" | "weekly" | "monthly" | "annual";

export type DailySixAutoDraftMode = "first_open" | "scheduled";

export interface DailySixDraftSuggestion {
  title: string;
  importance: string;
  completion_standard: string;
  first_action: string;
  weekly_plan_id: string | null;
}

export interface DailySixDraft {
  suggestions: DailySixDraftSuggestion[];
}

export interface BaseRecord {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  version: number;
  archived_at?: string | null;
  deleted_at?: string | null;
}

export interface Direction extends BaseRecord {
  kind: DirectionKind;
  title: string;
  content: string;
  sort_order: number;
}

export interface Plan extends BaseRecord {
  plan_type: PlanType;
  title: string;
  objective: string;
  importance?: string;
  period_start: string;
  period_end: string;
  completion_standard: string;
  first_action?: string;
  status: PlanStatus;
  parent_id: string | null;
  direction_id: string | null;
  progress: number;
  notes: string;
}

export interface DailyEntry extends BaseRecord {
  entry_date: string;
  note: string;
  daily_six_ai_draft: DailySixDraft | null;
  daily_six_ai_draft_status:
    "idle" | "generating" | "ready" | "applied" | "failed";
  daily_six_ai_draft_trigger: DailySixAutoDraftMode | null;
  daily_six_ai_draft_generated_at: string | null;
  daily_six_ai_draft_applied_at: string | null;
  daily_six_ai_draft_claim_id: string | null;
  daily_six_ai_draft_claimed_at: string | null;
  daily_six_ai_draft_last_attempt_at: string | null;
  daily_six_ai_draft_last_error_code: string | null;
}

export interface DailyTask extends BaseRecord {
  entry_date: string;
  slot_index: number;
  title: string;
  importance: string;
  completion_standard: string;
  first_action: string;
  weekly_plan_id: string | null;
  status: TaskStatus;
  result: string;
  completed_at: string | null;
  notes: string;
}

export interface ExerciseLog extends BaseRecord {
  entry_date: string;
  planned: boolean;
  activity: string;
  planned_minutes: number | null;
  actual_minutes: number | null;
  intensity: "light" | "moderate" | "high" | null;
  status: "not_started" | "completed" | "skipped";
  body_feeling: string;
  notes: string;
}

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export interface MealLog extends BaseRecord {
  entry_date: string;
  meal_type: MealType;
  content: string;
  photo_paths: string[];
  hydration_ml: number;
  overall_feeling: string;
  notes: string;
}

export interface AccumulationEntry extends BaseRecord {
  title: string;
  content: string;
  entry_date: string;
  tags: string[];
  source_task_id: string | null;
  source_plan_id: string | null;
  attachment_paths: string[];
  reusable_conclusion: string;
  next_use: string;
}

export interface Review extends BaseRecord {
  review_type: ReviewType;
  period_start: string;
  period_end: string;
  content: Record<string, string | number | string[]>;
  ai_draft: Record<string, unknown> | null;
  saved_from_draft: boolean;
}

export interface ReminderSetting extends BaseRecord {
  time_zone: string;
  daily_six_enabled: boolean;
  daily_six_time: string;
  daily_six_auto_draft_enabled: boolean;
  daily_six_auto_draft_mode: DailySixAutoDraftMode;
  daily_six_auto_draft_time: string;
  exercise_enabled: boolean;
  exercise_time: string;
  review_enabled: boolean;
  review_time: string;
  last_daily_six_sent: string | null;
  last_daily_six_ai_draft_generated: string | null;
  last_exercise_sent: string | null;
  last_review_sent: string | null;
}

export interface PushSubscriptionRecord extends BaseRecord {
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string;
}

export interface SyncConflict extends BaseRecord {
  table_name: SyncTable;
  record_id: string;
  local_data: Record<string, unknown>;
  remote_data: Record<string, unknown>;
  resolution: "pending" | "local" | "remote";
  resolved_at: string | null;
}

export type DomainRecord =
  | Direction
  | Plan
  | DailyEntry
  | DailyTask
  | ExerciseLog
  | MealLog
  | AccumulationEntry
  | Review
  | ReminderSetting
  | PushSubscriptionRecord
  | SyncConflict;

export type SyncTable =
  | "directions"
  | "plans"
  | "daily_entries"
  | "daily_tasks"
  | "exercise_logs"
  | "meal_logs"
  | "accumulation_entries"
  | "reviews"
  | "reminder_settings"
  | "push_subscriptions";

export const syncTables: SyncTable[] = [
  "directions",
  "plans",
  "daily_entries",
  "daily_tasks",
  "exercise_logs",
  "meal_logs",
  "accumulation_entries",
  "reviews",
  "reminder_settings",
  "push_subscriptions",
];

export const directionLabels: Record<DirectionKind, string> = {
  mission: "Mission",
  vision: "Vision",
  value: "Value",
  life_direction: "当前人生方向",
  long_term_theme: "长期主题",
  desired_state: "想要成为的状态",
  not_doing: "当前阶段不做什么",
};

export const taskStatusLabels: Record<TaskStatus, string> = {
  not_started: "未开始",
  in_progress: "进行中",
  completed: "已完成",
  not_completed: "未完成",
  not_scheduled: "今天不安排",
};

export const planStatusLabels: Record<PlanStatus, string> = {
  draft: "草稿",
  active: "进行中",
  paused: "暂缓",
  completed: "已完成",
  archived: "已归档",
};
