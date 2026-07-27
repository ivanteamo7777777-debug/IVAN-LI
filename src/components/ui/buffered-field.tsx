"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const DEFAULT_COMMIT_DELAY_MS = 400;

function useBufferedValue(
  value: string,
  onCommit: (value: string) => void,
  delayMs: number,
) {
  const [draft, setDraft] = React.useState(value);
  const draftRef = React.useRef(value);
  const commitRef = React.useRef(onCommit);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = React.useRef(false);
  const composingRef = React.useRef(false);

  React.useEffect(() => {
    commitRef.current = onCommit;
  }, [onCommit]);

  const clearTimer = React.useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const flush = React.useCallback(() => {
    clearTimer();
    if (!pendingRef.current) return;
    pendingRef.current = false;
    commitRef.current(draftRef.current);
  }, [clearTimer]);

  const schedule = React.useCallback(() => {
    clearTimer();
    pendingRef.current = true;
    timerRef.current = setTimeout(flush, delayMs);
  }, [clearTimer, delayMs, flush]);

  const update = React.useCallback(
    (next: string) => {
      draftRef.current = next;
      setDraft(next);
      if (!composingRef.current) schedule();
    },
    [schedule],
  );

  React.useEffect(() => {
    if (pendingRef.current) return;
    draftRef.current = value;
    setDraft(value);
  }, [value]);

  React.useEffect(() => {
    const flushBeforeLeaving = () => flush();
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flushBeforeLeaving);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("pagehide", flushBeforeLeaving);
      document.removeEventListener("visibilitychange", flushWhenHidden);
      flush();
    };
  }, [flush]);

  return {
    draft,
    update,
    flush,
    startComposition: () => {
      composingRef.current = true;
      clearTimer();
    },
    endComposition: (next: string) => {
      composingRef.current = false;
      draftRef.current = next;
      setDraft(next);
      schedule();
    },
  };
}

type BufferedInputProps = Omit<
  React.ComponentProps<typeof Input>,
  "value" | "defaultValue" | "onChange"
> & {
  value: string | number;
  onCommit: (value: string) => void;
  commitDelayMs?: number;
};

export function BufferedInput({
  value,
  onCommit,
  commitDelayMs = DEFAULT_COMMIT_DELAY_MS,
  onBlur,
  onCompositionStart,
  onCompositionEnd,
  ...props
}: BufferedInputProps) {
  const buffered = useBufferedValue(String(value), onCommit, commitDelayMs);

  return (
    <Input
      {...props}
      value={buffered.draft}
      onChange={(event) => buffered.update(event.target.value)}
      onBlur={(event) => {
        buffered.flush();
        onBlur?.(event);
      }}
      onCompositionStart={(event) => {
        buffered.startComposition();
        onCompositionStart?.(event);
      }}
      onCompositionEnd={(event) => {
        buffered.endComposition(event.currentTarget.value);
        onCompositionEnd?.(event);
      }}
    />
  );
}

type BufferedTextareaProps = Omit<
  React.ComponentProps<typeof Textarea>,
  "value" | "defaultValue" | "onChange"
> & {
  value: string;
  onCommit: (value: string) => void;
  commitDelayMs?: number;
};

export function BufferedTextarea({
  value,
  onCommit,
  commitDelayMs = DEFAULT_COMMIT_DELAY_MS,
  onBlur,
  onCompositionStart,
  onCompositionEnd,
  ...props
}: BufferedTextareaProps) {
  const buffered = useBufferedValue(value, onCommit, commitDelayMs);

  return (
    <Textarea
      {...props}
      value={buffered.draft}
      onChange={(event) => buffered.update(event.target.value)}
      onBlur={(event) => {
        buffered.flush();
        onBlur?.(event);
      }}
      onCompositionStart={(event) => {
        buffered.startComposition();
        onCompositionStart?.(event);
      }}
      onCompositionEnd={(event) => {
        buffered.endComposition(event.currentTarget.value);
        onCompositionEnd?.(event);
      }}
    />
  );
}
