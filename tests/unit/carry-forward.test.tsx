import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  carryExerciseFromYesterday,
  carryMealFromYesterday,
  dedupeDailySixSuggestions,
} from "@/components/today/carry-forward";
import { ExerciseSection } from "@/components/today/exercise-section";
import { MealSection } from "@/components/today/meal-section";
import type { ExerciseLog, MealLog, MealType } from "@/types/domain";

const userId = "00000000-0000-4000-8000-000000000001";
const yesterday = "2026-08-16";
const today = "2026-08-17";
const now = "2026-08-17T01:00:00.000Z";

function exercise(overrides: Partial<ExerciseLog> = {}): ExerciseLog {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    user_id: userId,
    entry_date: yesterday,
    planned: true,
    activity: "晨跑",
    planned_minutes: 35,
    actual_minutes: 42,
    intensity: "moderate",
    status: "completed",
    body_feeling: "轻松",
    notes: "昨天备注",
    created_at: "2026-08-16T01:00:00.000Z",
    updated_at: "2026-08-16T02:00:00.000Z",
    version: 3,
    ...overrides,
  };
}

function meal(type: MealType, overrides: Partial<MealLog> = {}): MealLog {
  return {
    id: `20000000-0000-4000-8000-00000000000${
      ["breakfast", "lunch", "dinner", "snack"].indexOf(type) + 1
    }`,
    user_id: userId,
    entry_date: today,
    meal_type: type,
    content: "",
    photo_paths: [],
    hydration_ml: 0,
    overall_feeling: "",
    notes: "",
    created_at: now,
    updated_at: now,
    version: 2,
    ...overrides,
  };
}

function todayMeals(): Record<MealType, MealLog> {
  return {
    breakfast: meal("breakfast", {
      content: "今天早餐",
      photo_paths: ["today/photo.jpg"],
      hydration_ml: 500,
      overall_feeling: "舒适",
      notes: "保留今天备注",
    }),
    lunch: meal("lunch"),
    dinner: meal("dinner"),
    snack: meal("snack"),
  };
}

describe("carry yesterday records", () => {
  it("copies only the exercise plan fields and resets today's execution", () => {
    const source = exercise();
    const carried = carryExerciseFromYesterday(source, {
      userId,
      date: today,
      now,
    });

    expect(carried.id).not.toBe(source.id);
    expect(
      carryExerciseFromYesterday(source, { userId, date: today, now }).id,
    ).toBe(carried.id);
    expect(
      carryExerciseFromYesterday(
        exercise({ id: "10000000-0000-4000-8000-000000000002" }),
        { userId, date: today, now },
      ).id,
    ).not.toBe(carried.id);
    expect(carried).toMatchObject({
      user_id: userId,
      entry_date: today,
      planned: true,
      activity: "晨跑",
      planned_minutes: 35,
      intensity: "moderate",
      actual_minutes: null,
      status: "not_started",
      body_feeling: "",
      notes: "",
      version: 0,
    });
  });

  it("copies meal content without yesterday's private attachments or summary fields", () => {
    const source = meal("breakfast", {
      entry_date: yesterday,
      content: "燕麦和鸡蛋",
      photo_paths: ["yesterday/photo.jpg"],
      hydration_ml: 900,
      overall_feeling: "匆忙",
      notes: "昨天备注",
      version: 7,
    });
    const carried = carryMealFromYesterday(source, {
      userId,
      date: today,
      id: "new-meal-id",
      now,
    });

    expect(carried).toEqual({
      id: "new-meal-id",
      user_id: userId,
      entry_date: today,
      meal_type: "breakfast",
      content: "燕麦和鸡蛋",
      photo_paths: [],
      hydration_ml: 0,
      overall_feeling: "",
      notes: "",
      created_at: now,
      updated_at: now,
      version: 0,
    });
  });

  it("deduplicates identical AI suggestions within one confirmed batch", () => {
    const first = {
      title: "写周报",
      importance: "对齐本周",
      completion_standard: "完成一版",
      first_action: "打开文档",
      weekly_plan_id: null,
    };
    expect(
      dedupeDailySixSuggestions([
        first,
        { ...first, title: " 写周报 " },
        { ...first, title: "准备例会", first_action: "先列提纲" },
      ]),
    ).toEqual([
      first,
      { ...first, title: "准备例会", first_action: "先列提纲" },
    ]);
  });

  it("prevents rapid double confirmation from adding the same exercise twice", async () => {
    let finish: (() => void) | undefined;
    const onCarryForward = vi.fn(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    render(
      <ExerciseSection
        values={[]}
        yesterdayValues={[exercise()]}
        onAdd={vi.fn()}
        onCarryForward={onCarryForward}
        onPatch={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("carry-yesterday-exercise"));
    fireEvent.click(screen.getByLabelText("选择昨天的运动 1"));
    const confirm = screen.getByTestId("confirm-carry-exercise");
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onCarryForward).toHaveBeenCalledTimes(1);
    await act(async () => finish?.());
  });

  it("disables meals with today content and carries only an empty meal", async () => {
    const meals = todayMeals();
    const breakfast = meal("breakfast", {
      entry_date: yesterday,
      content: "昨天早餐",
    });
    const lunch = meal("lunch", {
      entry_date: yesterday,
      content: "昨天午餐",
    });
    const onCarryForward = vi.fn().mockResolvedValue(undefined);
    render(
      <MealSection
        userId={userId}
        date={today}
        meals={meals}
        yesterdayMeals={{ breakfast, lunch }}
        onPatch={vi.fn()}
        onCarryForward={onCarryForward}
      />,
    );

    fireEvent.click(screen.getByTestId("carry-yesterday-meal"));
    expect(screen.getByLabelText("选择昨天的早餐")).toBeDisabled();
    expect(screen.getByText("今天已有文字，不会覆盖")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("选择昨天的午餐"));
    const confirm = screen.getByTestId("confirm-carry-meals");
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(onCarryForward).toHaveBeenCalledTimes(1));
    expect(onCarryForward).toHaveBeenCalledWith(["lunch"]);
  });
});
