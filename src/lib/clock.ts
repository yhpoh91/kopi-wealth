export interface Clock {
  nowMs(): number;
  nowIso(): string;
  today(): string;
}

class SystemClock implements Clock {
  nowMs() { return Date.now(); }
  nowIso() { return new Date().toISOString(); }
  today() { return new Date().toISOString().slice(0, 10); }
}

export const clock: Clock = new SystemClock();
