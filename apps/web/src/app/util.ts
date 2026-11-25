import { ko } from '../i18n/ko';
import type { Note } from '@vault/core';

export function relTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  const diff = now - t;
  if (diff < 60_000) return ko.time.justNow;
  if (diff < 3_600_000) return ko.time.minutesAgo(Math.floor(diff / 60_000));
  if (diff < 86_400_000 && new Date(t).getDate() === new Date(now).getDate()) return ko.time.hoursAgo(Math.floor(diff / 3_600_000));
  if (diff < 2 * 86_400_000) return ko.time.yesterday;
  const d = new Date(t);
  return ko.time.date(d.getMonth() + 1, d.getDate());
}

/** 로컬 시간 기준 `YYYY-MM-DD` */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 캘린더에 놓일 날짜. basis 'date' = 일정 날짜(없으면 제목이 `YYYY-MM-DD`인 오늘의 메모), 'created' = 작성일.
 * 해당 날짜가 없으면 null (캘린더에 나오지 않는다).
 */
export function noteDay(n: Pick<Note, 'title' | 'createdAt'> & { date?: string | null }, basis: 'date' | 'created'): string | null {
  if (basis === 'created') return dayKey(new Date(n.createdAt));
  if (n.date && DAY_RE.test(n.date)) return n.date;
  const t = n.title.trim();
  return DAY_RE.test(t) ? t : null;
}

/** 월 달력 6주 × 7일. 일요일 시작. month는 0-11 */
export function monthGrid(year: number, month: number): string[] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  return Array.from({ length: 42 }, (_, i) => dayKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
}

/** `2026-11-24` → `11월 24일 (화)` */
export function formatDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  const w = ko.time.weekdays[new Date(y, m - 1, d).getDay()];
  return `${m}월 ${d}일 (${w})`;
}

export function todayTitle(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function snippet(body: string, max = 80): string {
  return body
    .replace(/^#+\s.*$/m, '')
    .replace(/\[[ xX]\]/g, ' ') // 체크박스 표기 `[ ]` `[x]`
    .replace(/[#*`>\[\]_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** 검색어를 공백으로 나눈 소문자 조각 */
export function searchTokens(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * 메모가 조각을 **모두** 포함하면 점수(>0), 아니면 0. 제목 3점, 태그·폴더 2점, 본문 1점.
 * `#업무`처럼 #으로 시작하면 태그에서만 찾는다. 검색은 기기 안의 복호화된 메모에서만 돈다.
 */
export function searchScore(n: Pick<Note, 'title' | 'body' | 'tags' | 'folder'>, tokens: string[]): number {
  const title = n.title.toLowerCase();
  const body = n.body.toLowerCase();
  const tags = n.tags.map((t) => t.toLowerCase());
  const folder = (n.folder ?? '').toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (t.startsWith('#') && t.length > 1) {
      if (!tags.some((x) => x.startsWith(t.slice(1)))) return 0;
      score += 2;
      continue;
    }
    const s = (title.includes(t) ? 3 : 0) + (tags.some((x) => x.includes(t)) || folder.includes(t) ? 2 : 0) + (body.includes(t) ? 1 : 0);
    if (s === 0) return 0;
    score += s;
  }
  return score;
}

/** 점수 높은 순. 같은 점수는 원래 순서(수정순 등)를 지킨다. */
export function searchNotes<T extends Pick<Note, 'title' | 'body' | 'tags' | 'folder'>>(notes: T[], query: string): T[] {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return notes;
  return notes
    .map((n, i) => ({ n, i, s: searchScore(n, tokens) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || x.i - y.i)
    .map((x) => x.n);
}

/** 검색어가 본문에서 처음 나오는 곳 앞뒤를 잘라 보여준다. 없으면 빈 문자열. */
export function matchSnippet(body: string, needle: string, radius = 28): string {
  // 여러 단어면 본문에 있는 첫 단어 주변을 보여준다
  const flat = body.replace(/\s+/g, ' ');
  const lower = flat.toLowerCase();
  const q = searchTokens(needle).find((t) => lower.includes(t)) ?? '';
  if (!q) return '';
  const i = lower.indexOf(q);
  if (i < 0) return '';
  const from = Math.max(0, i - radius);
  const to = Math.min(flat.length, i + q.length + radius);
  return `${from > 0 ? '…' : ''}${flat.slice(from, to).trim()}${to < flat.length ? '…' : ''}`;
}

/** 공백을 뺀 글자 수 (편집기 하단 표시) */
export function charCount(body: string): number {
  return [...body.replace(/\s/g, '')].length;
}

export function displayTitle(n: Pick<Note, 'title'>): string {
  return n.title.trim() || ko.main.untitled;
}

/** [[제목]] 링크 추출 */
export function wikiLinks(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) out.add((m[1] ?? '').trim());
  out.delete('');
  return [...out];
}

/** 백링크 인덱스: 제목 → 그 제목을 링크하는 메모 id[] (기기에서 계산, SPEC §2.2) */
export function backlinkIndex(notes: Note[]): Map<string, Note[]> {
  const byTitle = new Map<string, Note>();
  for (const n of notes) if (n.title.trim()) byTitle.set(n.title.trim(), n);
  const idx = new Map<string, Note[]>();
  for (const n of notes) {
    for (const t of wikiLinks(n.body)) {
      const target = byTitle.get(t);
      if (!target || target.id === n.id) continue;
      const arr = idx.get(target.id) ?? [];
      if (!arr.some((x) => x.id === n.id)) arr.push(n);
      idx.set(target.id, arr);
    }
  }
  return idx;
}

export function downloadBytes(name: string, bytes: Uint8Array, type = 'application/octet-stream'): void {
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 모바일: OS 공유 시트가 있으면 그걸로, 없으면 다운로드 */
export async function shareOrDownload(name: string, bytes: Uint8Array, type = 'application/octet-stream'): Promise<void> {
  const file = new File([bytes as BlobPart], name, { type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name });
      return;
    } catch {
      /* 취소 → 다운로드로 */
    }
  }
  downloadBytes(name, bytes, type);
}

export function pickFile(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(input.files ? Array.from(input.files) : []);
    input.click();
  });
}

export async function pickDirectoryFiles(): Promise<{ path: string; content: string }[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input') as HTMLInputElement & { webkitdirectory: boolean };
    input.type = 'file';
    input.webkitdirectory = true;
    input.multiple = true;
    input.onchange = async () => {
      const files = input.files ? Array.from(input.files) : [];
      const out: { path: string; content: string }[] = [];
      for (const f of files) {
        if (!f.name.toLowerCase().endsWith('.md')) continue;
        const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
        const parts = rel.split('/');
        parts.shift(); // 선택한 최상위 폴더 이름 제거
        out.push({ path: parts.join('/') || f.name, content: await f.text() });
      }
      resolve(out);
    };
    input.click();
  });
}

/** 간이 비밀번호 강도 0–4 (SPEC: zxcvbn 점수 3 이상 권장 — v1은 길이·다양성 기준 간이 추정) */
export function passwordScore(pw: string): number {
  if (!pw) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/, /[가-힣]/].filter((r) => r.test(pw)).length;
  const words = pw.trim().split(/\s+/).length;
  const len = pw.length;
  const repeated = /(.)\1{3,}/.test(pw) || /^(.{1,3})\1+$/.test(pw);
  let score = 0;
  if (len >= 8) score++;
  if (len >= 12) score++;
  if (len >= 16 || words >= 4) score++;
  if (classes >= 3 || (words >= 4 && len >= 20)) score++;
  if (repeated) score = Math.min(score, 1);
  return Math.min(4, score);
}
