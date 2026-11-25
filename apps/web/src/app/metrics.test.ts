import { describe, expect, it } from 'vitest';
import { applyCapture, applyOpen, emptyMetrics, summarize, type Metrics } from './metrics';

const at = (y: number, m: number, d: number, h = 12, s = 0) => new Date(y, m - 1, d, h, 0, s).getTime();

describe('metrics', () => {
  it('같은 날 여러 번 열어도 하루로 센다', () => {
    let m = emptyMetrics();
    m = applyOpen(m, at(2026, 11, 25, 9));
    m = applyOpen(m, at(2026, 11, 25, 21));
    m = applyOpen(m, at(2026, 11, 26, 9));
    expect(m.days).toEqual(['2026-11-25', '2026-11-26']);
  });

  it('최근 7일·28일 사용일: 오늘을 포함해 센다', () => {
    let m = emptyMetrics();
    for (const d of [1, 19, 20, 24, 25]) m = applyOpen(m, at(2026, 11, d));
    const s = summarize(m, at(2026, 11, 25));
    expect(s.active7).toBe(4); // 19, 20, 24, 25 (19일이 7일 전 경계)
    expect(s.active28).toBe(5);
    expect(summarize(m, at(2026, 11, 26)).active7).toBe(3); // 하루 지나면 19일이 빠진다
  });

  it('첫 메모까지 시간은 처음 한 번만 기록한다', () => {
    let m: Metrics = { ...emptyMetrics(), installedAt: at(2026, 11, 25, 12, 0) };
    m = applyCapture(m, 'quick', at(2026, 11, 25, 12, 40), null);
    m = applyCapture(m, 'new', at(2026, 11, 25, 13), null);
    const s = summarize(m, at(2026, 11, 25, 14));
    expect(s.firstNoteSec).toBe(40);
    expect(s.captures).toBe(2);
    expect(s.quickShare).toBe(0.5);
  });

  it('열고 나서 첫 메모까지: 잠금을 푼 뒤 첫 메모만 표본에 넣고 중앙값을 낸다', () => {
    let m = emptyMetrics();
    const t = at(2026, 11, 25);
    for (const ms of [4000, 30000, 6000]) m = applyCapture(m, 'quick', t + ms, t);
    m = applyCapture(m, 'quick', t + 99000, null); // 같은 세션의 둘째 메모는 표본이 아니다
    expect(m.captureMs).toEqual([4000, 30000, 6000]);
    expect(summarize(m, t).captureSec).toBe(6);
  });

  it('기록이 없으면 비율은 null (0%로 보이지 않게)', () => {
    const s = summarize(emptyMetrics(), at(2026, 11, 25));
    expect(s).toMatchObject({ firstNoteSec: null, captureSec: null, passkeyShare: null, quickShare: null, active7: 0 });
  });

  it('패스키 비율', () => {
    const m = { ...emptyMetrics(), unlocks: { password: 1, passkey: 3, recovery: 0 } };
    expect(summarize(m, at(2026, 11, 25)).passkeyShare).toBe(0.75);
  });
});
