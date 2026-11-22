import { describe, expect, it } from 'vitest';
import type { Note } from '@vault/core';
import { dayKey, formatDay, monthGrid, noteDay, backlinkIndex, charCount, matchSnippet, passwordScore, relTime, snippet, todayTitle, wikiLinks } from './util';

const note = (id: string, title: string, body: string): Note => ({
  id, title, body, tags: [], folder: null, pinned: false,
  createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', deletedAt: null,
});

describe('relTime', () => {
  const now = new Date('2026-11-07T12:00:00Z').getTime();
  it('방금 전 / N분 전 / N시간 전 / 어제 / M월 D일', () => {
    expect(relTime('2026-11-07T11:59:40Z', now)).toBe('방금 전');
    expect(relTime('2026-11-07T11:30:00Z', now)).toBe('30분 전');
    expect(relTime('2026-11-07T09:00:00Z', now)).toBe('3시간 전');
    expect(relTime('2026-11-06T10:00:00Z', now)).toBe('어제');
    expect(relTime('2026-10-24T10:00:00Z', now)).toBe('10월 24일');
    expect(relTime(null, now)).toBe('');
  });
});

describe('passwordScore', () => {
  it('짧고 반복적인 것은 약하고, 긴 문장은 강하다', () => {
    expect(passwordScore('')).toBe(0);
    expect(passwordScore('aaaaaaaaaaaa')).toBeLessThanOrEqual(1);
    expect(passwordScore('abc123')).toBeLessThan(3);
    expect(passwordScore('purple bicycle calendar pine')).toBeGreaterThanOrEqual(3);
    expect(passwordScore('Tr0ub4dor&3xyz!!')).toBeGreaterThanOrEqual(3);
  });
});

describe('wikiLinks / backlinkIndex', () => {
  it('[[제목]]과 [[제목|별칭]]을 추출하고 자기 참조는 제외', () => {
    expect(wikiLinks('a [[장보기]] b [[회의|m]] [[장보기]]')).toEqual(['장보기', '회의']);
    const a = note('a', '장보기', '우유');
    const b = note('b', '주말', '[[장보기]] 가기');
    const c = note('c', '메모', '[[메모]] 자기 자신');
    const idx = backlinkIndex([a, b, c]);
    expect(idx.get('a')?.map((n) => n.id)).toEqual(['b']);
    expect(idx.get('c')).toBeUndefined();
  });
});

describe('캘린더 날짜', () => {
  it('monthGrid: 2026년 11월은 일요일 11/1부터, 42칸', () => {
    const g = monthGrid(2026, 10);
    expect(g).toHaveLength(42);
    expect(g[0]).toBe('2026-11-01');
    expect(g[41]).toBe('2026-12-12');
  });
  it('monthGrid: 1일이 수요일이면 앞 칸은 지난달', () => {
    expect(monthGrid(2026, 6)[0]).toBe('2026-06-28');
  });
  it('noteDay: 일정 날짜 > 날짜 제목 > 없음, 작성일 기준은 로컬 날짜', () => {
    const base = { title: '치과', createdAt: new Date(2026, 10, 3, 23, 30).toISOString() };
    expect(noteDay({ ...base, date: '2026-11-24' }, 'date')).toBe('2026-11-24');
    expect(noteDay({ ...base, title: '2026-11-05' }, 'date')).toBe('2026-11-05');
    expect(noteDay(base, 'date')).toBeNull();
    expect(noteDay(base, 'created')).toBe('2026-11-03');
  });
  it('formatDay / dayKey', () => {
    expect(formatDay('2026-11-24')).toBe('11월 24일 (화)');
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('matchSnippet / charCount', () => {
  it('검색어 앞뒤를 잘라 보여주고, 없으면 빈 문자열', () => {
    const body = '가'.repeat(40) + ' 찾는말 ' + '나'.repeat(40);
    const s = matchSnippet(body, '찾는말', 5);
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect(s).toContain('찾는말');
    expect(matchSnippet('abc', 'zzz')).toBe('');
    expect(matchSnippet('Hello World', 'world')).toBe('Hello World');
  });
  it('체크된 항목의 x가 미리보기에 남지 않는다', () => {
    expect(snippet('- [x] 배포 준비\n- [ ] 검토')).toBe('배포 준비 검토');
  });
  it('charCount는 공백을 빼고 센다', () => {
    expect(charCount('가 나\n다')).toBe(3);
  });
});

describe('snippet / todayTitle', () => {
  it('제목 줄과 마크다운 기호를 걷어낸다', () => {
    expect(snippet('# 제목\n- [ ] 할 일 **굵게**')).toBe('할 일 굵게');
  });
  it('YYYY-MM-DD', () => {
    expect(todayTitle(new Date(2026, 10, 7))).toBe('2026-11-07');
  });
});
