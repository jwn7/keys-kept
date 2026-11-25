import { dayKey } from './util';

/**
 * 이 기기에서만 세는 사용 수치 (docs/KPI.md).
 * 개수와 시각만 둔다. 메모 제목·본문은 들어가지 않고, 어디로도 보내지 않는다.
 * 설정 > 내 사용에서 사용자가 직접 보고, 원하면 복사해서 건넨다.
 */
const KEY = 'vault.metrics';
const KEEP_DAYS = 60;
const KEEP_SAMPLES = 30;

export type UnlockMethod = 'password' | 'passkey' | 'recovery';
export type CaptureKind = 'quick' | 'new';
export type Metrics = {
  /** 처음 설정을 끝낸 시각(ms). 다른 기기에서 불러온 경우 null */
  installedAt: number | null;
  firstNoteAt: number | null;
  /** 앱을 연 날 `YYYY-MM-DD`, 오래된 것부터 */
  days: string[];
  unlocks: Record<UnlockMethod, number>;
  captures: number;
  quickCaptures: number;
  /** 잠금을 푼 뒤 첫 메모를 만들 때까지 걸린 시간(ms), 최근 것만 */
  captureMs: number[];
};

export const emptyMetrics = (): Metrics => ({
  installedAt: null,
  firstNoteAt: null,
  days: [],
  unlocks: { password: 0, passkey: 0, recovery: 0 },
  captures: 0,
  quickCaptures: 0,
  captureMs: [],
});

// ---- 순수 함수: 테스트는 여기만 본다 ----

export function applyOpen(m: Metrics, now: number): Metrics {
  const day = dayKey(new Date(now));
  if (m.days.includes(day)) return m;
  return { ...m, days: [...m.days, day].slice(-KEEP_DAYS) };
}

/** openedAt: 이번에 잠금을 푼 시각. 푼 뒤 첫 메모일 때만 넘긴다. */
export function applyCapture(m: Metrics, kind: CaptureKind, now: number, openedAt: number | null): Metrics {
  return {
    ...m,
    firstNoteAt: m.firstNoteAt ?? now,
    captures: m.captures + 1,
    quickCaptures: m.quickCaptures + (kind === 'quick' ? 1 : 0),
    captureMs: openedAt === null ? m.captureMs : [...m.captureMs, Math.max(0, now - openedAt)].slice(-KEEP_SAMPLES),
  };
}

export type Summary = {
  /** 처음 설정 → 첫 메모(초) */
  firstNoteSec: number | null;
  /** 잠금 해제 → 첫 메모(초), 중앙값 */
  captureSec: number | null;
  active7: number;
  active28: number;
  /** 0~1. 잠금 해제 중 패스키 비율 */
  passkeyShare: number | null;
  /** 0~1. 새 메모 중 빠른 메모 비율 */
  quickShare: number | null;
  unlocks: number;
  captures: number;
};

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function summarize(m: Metrics, now: number): Summary {
  const since = (days: number) => {
    const d = new Date(now);
    return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - (days - 1)));
  };
  const activeSince = (days: number) => m.days.filter((d) => d >= since(days)).length;
  const unlocks = m.unlocks.password + m.unlocks.passkey + m.unlocks.recovery;
  const med = median(m.captureMs);
  return {
    firstNoteSec: m.installedAt !== null && m.firstNoteAt !== null ? Math.round((m.firstNoteAt - m.installedAt) / 1000) : null,
    captureSec: med === null ? null : Math.round(med / 1000),
    active7: activeSince(7),
    active28: activeSince(28),
    passkeyShare: unlocks ? m.unlocks.passkey / unlocks : null,
    quickShare: m.captures ? m.quickCaptures / m.captures : null,
    unlocks,
    captures: m.captures,
  };
}

// ---- 저장 ----

export function loadMetrics(): Metrics {
  const d = emptyMetrics();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Metrics>;
    return { ...d, ...raw, unlocks: { ...d.unlocks, ...raw.unlocks } };
  } catch {
    return d;
  }
}

function update(fn: (m: Metrics) => Metrics): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(fn(loadMetrics())));
  } catch {
    /* 저장이 막힌 환경에서는 세지 않는다 */
  }
}

/** 이번 잠금 해제 시각. 그 뒤 첫 메모를 만들면 비운다. */
let openedAt: number | null = null;

export function markInstalled(now = Date.now()): void {
  openedAt = now;
  update((m) => ({ ...m, installedAt: m.installedAt ?? now }));
}
/** 잠금이 풀릴 때마다 (방법과 무관) */
export function markOpen(now = Date.now()): void {
  openedAt = now;
  update((m) => applyOpen(m, now));
}
export function markUnlock(method: UnlockMethod): void {
  update((m) => ({ ...m, unlocks: { ...m.unlocks, [method]: m.unlocks[method] + 1 } }));
}
export function markCapture(kind: CaptureKind, now = Date.now()): void {
  const from = openedAt;
  openedAt = null;
  update((m) => applyCapture(m, kind, now, from));
}
