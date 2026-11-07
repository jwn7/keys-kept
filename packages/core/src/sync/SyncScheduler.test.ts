import { describe, expect, it, vi } from 'vitest';
import { SyncScheduler } from './SyncScheduler';

describe('SyncScheduler', () => {
  it('start 시 즉시 1회, 이후 interval마다, focus/online 이벤트에도 실행', () => {
    vi.useFakeTimers();
    const runs: string[] = [];
    const target = new EventTarget();
    const s = new SyncScheduler({
      run: async () => { runs.push('run'); },
      intervalMs: 30_000,
      target,
      isOnline: () => true,
    });
    s.start();
    expect(runs).toHaveLength(1);
    vi.advanceTimersByTime(30_000);
    expect(runs).toHaveLength(2);
    target.dispatchEvent(new Event('focus'));
    expect(runs).toHaveLength(3);
    target.dispatchEvent(new Event('online'));
    expect(runs).toHaveLength(4);
    s.stop();
    vi.advanceTimersByTime(90_000);
    target.dispatchEvent(new Event('focus'));
    expect(runs).toHaveLength(4);
    vi.useRealTimers();
  });

  it('오프라인이면 interval 실행을 건너뛴다, requestNow는 디바운스', () => {
    vi.useFakeTimers();
    let online = false;
    const runs: number[] = [];
    const s = new SyncScheduler({ run: async () => { runs.push(1); }, intervalMs: 1000, target: new EventTarget(), isOnline: () => online });
    s.start();
    expect(runs).toHaveLength(0);
    vi.advanceTimersByTime(3000);
    expect(runs).toHaveLength(0);
    online = true;
    s.requestNow();
    s.requestNow();
    s.requestNow();
    vi.advanceTimersByTime(600);
    expect(runs).toHaveLength(1);
    s.stop();
    vi.useRealTimers();
  });
});
