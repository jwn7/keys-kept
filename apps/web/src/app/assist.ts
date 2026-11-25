import type { Note } from '@vault/core';
import { dayKey } from './util';

/**
 * 적어 둔 것을 앱이 다시 꺼내 주는 계산들 (docs/KPI.md "자동으로 도와주는 것").
 * 전부 잠금을 푼 기기 안에서, 복호화된 메모 배열만 보고 계산한다. 서버로 가는 것은 없다.
 */

// ---------- 1. 빠른 메모의 날짜 말 ("내일 치과 3시") ----------

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
// 영어 날짜 말도 같이 알아본다 (화면 언어와 무관, 대소문자 무시). 요일은 줄임말(sun, sat) 없이 온전한 이름만: 사람 이름·다른 낱말과 헷갈리지 않게.
const EN_WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const EN_WEEKDAY_RE = new RegExp(`^(?:(this|next)\\s+)?(${EN_WEEKDAYS.join('|')})$`);
const EN_DATE_WORD = String.raw`today|tomorrow|(?:(?:this|next)\s+)?(?:${EN_WEEKDAYS.join('|')})`;
const DATE_WORD = String.raw`${EN_DATE_WORD}|오늘|내일|모레|(?:(?:이번|다음)\s?주\s?)?[일월화수목금토]요일|\d{1,2}월\s?\d{1,2}일|\d{1,2}\/\d{1,2}`;
const AT_START = new RegExp(`^(${DATE_WORD})\\s+(.+)$`, 'i');
const AT_END = new RegExp(`^(.+?)\\s+(${DATE_WORD})$`, 'i');

function resolveDateWord(raw: string, now: Date): string | null {
  const at = (offset: number) => dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset));
  /** 요일(0 = 일요일)을 날짜로. week가 없으면 다가오는 그 요일, 있으면 월요일에 시작하는 이번 주·다음 주의 그 요일. */
  const weekday = (week: 'this' | 'next' | null, target: number) => {
    const dow = now.getDay();
    if (!week) return at((target - dow + 7) % 7 || 7); // "금요일" = 다가오는 금요일 (오늘이 금요일이면 다음 주)
    const monday = -((dow + 6) % 7); // 한 주는 월요일에 시작한다
    return at(monday + ((target + 6) % 7) + (week === 'next' ? 7 : 0));
  };
  const word = raw.toLowerCase();
  if (word === '오늘' || word === 'today') return at(0);
  if (word === '내일' || word === 'tomorrow') return at(1);
  if (word === '모레') return at(2);
  const wd = /^(?:(이번|다음)\s?주\s?)?([일월화수목금토])요일$/.exec(word);
  if (wd) return weekday(wd[1] ? (wd[1] === '다음' ? 'next' : 'this') : null, WEEKDAYS.indexOf(wd[2]!));
  const en = EN_WEEKDAY_RE.exec(word.replace(/\s+/g, ' '));
  if (en) return weekday((en[1] as 'this' | 'next' | undefined) ?? null, EN_WEEKDAYS.indexOf(en[2]!));
  const md = /^(\d{1,2})월\s?(\d{1,2})일$/.exec(word) ?? /^(\d{1,2})\/(\d{1,2})$/.exec(word);
  if (md) {
    const m = Number(md[1]);
    const d = Number(md[2]);
    for (const y of [now.getFullYear(), now.getFullYear() + 1]) {
      const dt = new Date(y, m - 1, d);
      if (dt.getMonth() !== m - 1 || dt.getDate() !== d) return null; // 2월 30일 같은 없는 날
      if (dayKey(dt) >= at(0)) return dayKey(dt); // 이미 지난 날짜면 내년
    }
  }
  return null;
}

/** 맨 앞이나 맨 뒤의 날짜 말을 떼어 내고 날짜로 바꾼다. 날짜 말만 있거나 없으면 그대로 둔다. */
export function parseQuickDate(input: string, now: Date): { text: string; date: string | null; word: string | null } {
  const t = input.trim();
  const a = AT_START.exec(t);
  const b = a ? null : AT_END.exec(t);
  const word = a ? a[1]! : b ? b[2]! : null;
  const rest = a ? a[2]! : b ? b[1]! : t;
  const date = word ? resolveDateWord(word, now) : null;
  return date ? { text: rest.trim(), date, word } : { text: t, date: null, word: null };
}

// ---------- 2. 안 끝난 할 일 모으기 (`- [ ] @민수 보고서`) ----------

export type Task = {
  noteId: string;
  noteTitle: string;
  /** 본문에서 몇 번째 줄인지 (0부터) */
  line: number;
  text: string;
  /** `@이름`이 있으면 담당자 */
  who: string | null;
  /** 그 메모의 일정 날짜 */
  date: string | null;
};

const TASK_RE = /^\s*(?:[-*+]|\d+\.)\s+\[ \]\s+(.+)$/;
const WHO_RE = /(?:^|\s)@([^\s@,.:;]+)/;

export function openTasks(notes: Note[]): Task[] {
  const out: (Task & { updatedAt: string })[] = [];
  for (const n of notes) {
    if (!n.body.includes('[ ]')) continue;
    n.body.split('\n').forEach((raw, line) => {
      const m = TASK_RE.exec(raw);
      if (!m) return;
      const text = m[1]!.trim();
      out.push({ noteId: n.id, noteTitle: n.title, line, text, who: WHO_RE.exec(text)?.[1] ?? null, date: n.date ?? null, updatedAt: n.updatedAt });
    });
  }
  // 날짜가 있는 것(가까운 순) 먼저, 나머지는 최근에 고친 메모부터. 같은 메모 안에서는 적은 순서.
  out.sort((x, y) => {
    if (x.date !== y.date) return x.date === null ? 1 : y.date === null ? -1 : x.date.localeCompare(y.date);
    if (x.noteId !== y.noteId) return y.updatedAt.localeCompare(x.updatedAt);
    return x.line - y.line;
  });
  return out.map(({ updatedAt: _u, ...t }) => t);
}

/** 그 줄의 `[ ]`를 `[x]`로. 줄이 그 사이에 바뀌어 할 일이 아니면 본문을 그대로 돌려준다. */
export function checkTask(body: string, line: number): string {
  const lines = body.split('\n');
  const raw = lines[line];
  if (raw === undefined || !TASK_RE.test(raw)) return body;
  lines[line] = raw.replace('[ ]', '[x]');
  return lines.join('\n');
}

// ---------- 3. 관련 메모 ----------

const words = (s: string) => [...new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2 && !/^\d+$/.test(w)))];

/** 태그가 같거나 제목의 낱말이 겹치는 메모. 태그 3점, 제목끼리 2점, 제목 낱말이 상대 본문에 있으면 1점. */
export function relatedNotes(note: Note, notes: Note[], max = 3): Note[] {
  const mine = words(note.title);
  const tags = new Set(note.tags);
  if (mine.length === 0 && tags.size === 0) return [];
  const scored: [number, Note][] = [];
  for (const o of notes) {
    if (o.id === note.id) continue;
    let score = o.tags.filter((t) => tags.has(t)).length * 3;
    const title = o.title.toLowerCase();
    const body = o.body.toLowerCase();
    for (const w of mine) score += title.includes(w) ? 2 : body.includes(w) ? 1 : 0;
    if (score >= 2) scored.push([score, o]);
  }
  return scored.sort((a, b) => b[0] - a[0] || b[1].updatedAt.localeCompare(a[1].updatedAt)).slice(0, max).map(([, o]) => o);
}

// ---------- 4. 다시 볼 메모 (간격 복습) ----------

export const REVIEW_TAG = '복습';
/** 영어 학습 노트 템플릿은 #review를 붙인다 (i18n/en.ts). 둘 다 알아본다: 언어를 바꿔도 예전 메모가 계속 나오게. */
export const REVIEW_TAGS = [REVIEW_TAG, 'review'];
/** 쓴 날로부터 며칠 뒤에 다시 보여줄지. 잊기 직전에 다시 보면 오래 남는다(간격 반복). */
export const REVIEW_DAYS = [1, 3, 7, 14, 30];

const dayNumber = (key: string) => {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};

export function reviewDue(notes: Note[], today: string): Note[] {
  const t = dayNumber(today);
  return notes.filter((n) => n.tags.some((tag) => REVIEW_TAGS.includes(tag)) && REVIEW_DAYS.includes(t - dayNumber(dayKey(new Date(n.createdAt)))));
}
