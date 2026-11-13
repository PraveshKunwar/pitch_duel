export const ROUND_MS = 20_000;

export interface TimerHandle {
  cancel(): void;
}

export type TimerCallback = () => void | Promise<void>;

export interface TimerScheduler {
  schedule(delayMs: number, callback: TimerCallback): TimerHandle;
}

export function createDefaultScheduler(): TimerScheduler {
  return {
    schedule(delayMs, callback) {
      const timer = setTimeout(() => void callback(), delayMs);
      timer.unref();
      return { cancel: () => clearTimeout(timer) };
    },
  };
}

export interface ScheduledTimer {
  dueAt: number;
  cancelled: boolean;
  run: TimerCallback;
}

export interface ControllableScheduler extends TimerScheduler {
  now(): number;
  elapse(ms: number): void;
  flush(): Promise<void>;
  advance(ms: number): Promise<void>;
  pending(): ScheduledTimer[];
  all(): ScheduledTimer[];
}

export function createControllableScheduler(
  startMs = 0,
): ControllableScheduler {
  let now = startMs;
  let nextId = 1;
  const tasks: Array<ScheduledTimer & { id: number }> = [];

  const active = () => tasks.filter((task) => !task.cancelled);

  const due = (limit: number) =>
    active()
      .filter((task) => task.dueAt <= limit)
      .sort((a, b) => a.dueAt - b.dueAt || a.id - b.id);

  return {
    now: () => now,
    schedule(delayMs, callback) {
      const task = {
        id: nextId++,
        dueAt: now + delayMs,
        cancelled: false,
        run: callback,
      };
      tasks.push(task);
      return {
        cancel() {
          task.cancelled = true;
        },
      };
    },
    elapse(ms) {
      now += ms;
    },
    async flush() {
      for (;;) {
        const next = due(now)[0];
        if (!next) return;
        next.cancelled = true;
        await next.run();
      }
    },
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        const next = due(target)[0];
        if (!next) break;
        now = next.dueAt;
        next.cancelled = true;
        await next.run();
      }
      now = target;
    },
    pending() {
      return active();
    },
    all() {
      return tasks;
    },
  };
}
