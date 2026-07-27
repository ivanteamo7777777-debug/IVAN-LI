import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BufferedInput,
  BufferedTextarea,
} from "@/components/ui/buffered-field";

afterEach(() => {
  vi.useRealTimers();
});

describe("buffered fields", () => {
  it("updates immediately but commits only after 400ms of quiet time", () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    render(
      <BufferedInput aria-label="任务标题" value="" onCommit={onCommit} />,
    );
    const input = screen.getByLabelText("任务标题");

    fireEvent.change(input, { target: { value: "守" } });
    fireEvent.change(input, { target: { value: "守中" } });

    expect(input).toHaveValue("守中");
    expect(onCommit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(399));
    expect(onCommit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenLastCalledWith("守中");
  });

  it("keeps the active draft when an older external value rerenders", () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    const { rerender } = render(
      <BufferedTextarea aria-label="备注" value="原文" onCommit={onCommit} />,
    );
    const textarea = screen.getByLabelText("备注");
    fireEvent.change(textarea, { target: { value: "正在输入的新内容" } });

    rerender(
      <BufferedTextarea
        aria-label="备注"
        value="较早的云端内容"
        onCommit={onCommit}
      />,
    );

    expect(textarea).toHaveValue("正在输入的新内容");
  });

  it("waits for Chinese composition to finish and flushes on blur", () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    render(
      <BufferedInput aria-label="中文输入" value="" onCommit={onCommit} />,
    );
    const input = screen.getByLabelText("中文输入");

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "日课" } });
    act(() => vi.advanceTimersByTime(1000));
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.compositionEnd(input);
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("日课");
  });

  it("flushes a pending draft before the page is hidden", () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    render(
      <BufferedInput aria-label="离开页面" value="" onCommit={onCommit} />,
    );
    fireEvent.change(screen.getByLabelText("离开页面"), {
      target: { value: "尚未到防抖时间" },
    });

    fireEvent.pageHide(window);

    expect(onCommit).toHaveBeenCalledWith("尚未到防抖时间");
  });
});
