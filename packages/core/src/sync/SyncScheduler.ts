export type SyncSchedulerOptions = {
  run: () => Promise<unknown>;
  /** 기본 30초 (SPEC §3.2 Drive 폴링) */
  intervalMs?: number;
  /** focus/online 이벤트를 받을 대상. 브라우저에선 window. */
  target?: EventTarget;
  isOnline?: () => boolean;
  /** requestNow 디바운스 (outbox에 항목이 생길 때 연타 방지) */
  debounceMs?: number;
};

/** 트리거: start 즉시 · interval · focus 복귀 · online 복귀 · requestNow(outbox 변경). */
export class SyncScheduler {
  private readonly run: () => Promise<unknown>;
  private readonly intervalMs: number;
  private readonly target: EventTarget | undefined;
  private readonly isOnline: () => boolean;
  private readonly debounceMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private readonly onWake = () => this.tick();

  constructor(opts: SyncSchedulerOptions) {
    this.run = opts.run;
    this.intervalMs = opts.intervalMs ?? 30_000;
    this.target = opts.target;
    this.isOnline = opts.isOnline ?? (() => true);
    this.debounceMs = opts.debounceMs ?? 500;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.target?.addEventListener('focus', this.onWake);
    this.target?.addEventListener('online', this.onWake);
    this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = null;
    this.target?.removeEventListener('focus', this.onWake);
    this.target?.removeEventListener('online', this.onWake);
  }

  /** 로컬 변경 직후 호출. 짧게 모아서 한 번 실행. */
  requestNow(): void {
    if (!this.timer) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      this.tick();
    }, this.debounceMs);
  }

  private tick(): void {
    if (!this.timer || !this.isOnline()) return;
    void this.run().catch(() => undefined); // 상태는 SyncEngine이 이벤트로 알린다
  }
}
