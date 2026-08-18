import { isoNow, stableUuid } from "@/lib/utils";
import type {
  DailySixDraftSuggestion,
  ExerciseLog,
  MealLog,
} from "@/types/domain";

export function dedupeDailySixSuggestions(
  suggestions: DailySixDraftSuggestion[],
) {
  const seen = new Set<string>();
  return suggestions.filter((suggestion) => {
    const key = suggestion.title.trim().toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface CarryTarget {
  userId: string;
  date: string;
  id?: string;
  now?: string;
}

export function carryExerciseFromYesterday(
  source: ExerciseLog,
  target: CarryTarget,
): ExerciseLog {
  const now = target.now ?? isoNow();
  return {
    id:
      target.id ??
      stableUuid(`exercise-carry:${target.userId}:${target.date}:${source.id}`),
    user_id: target.userId,
    entry_date: target.date,
    planned: source.planned,
    activity: source.activity,
    planned_minutes: source.planned_minutes,
    actual_minutes: null,
    intensity: source.intensity,
    status: "not_started",
    body_feeling: "",
    notes: "",
    created_at: now,
    updated_at: now,
    version: 0,
  };
}

export function carryMealFromYesterday(
  source: MealLog,
  target: CarryTarget,
): MealLog {
  const now = target.now ?? isoNow();
  return {
    id:
      target.id ??
      stableUuid(
        `meal-carry:${target.userId}:${target.date}:${source.meal_type}`,
      ),
    user_id: target.userId,
    entry_date: target.date,
    meal_type: source.meal_type,
    content: source.content,
    photo_paths: [],
    hydration_ml: 0,
    overall_feeling: "",
    notes: "",
    created_at: now,
    updated_at: now,
    version: 0,
  };
}
