import { describe, expect, it } from 'vitest';
import type { Note } from '@vault/core';
import { backlinkIndex, passwordScore, relTime, snippet, todayTitle, wikiLinks } from './util';

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

describe('snippet / todayTitle', () => {
  it('제목 줄과 마크다운 기호를 걷어낸다', () => {
    expect(snippet('# 제목\n- [ ] 할 일 **굵게**')).toBe('할 일 굵게');
  });
  it('YYYY-MM-DD', () => {
    expect(todayTitle(new Date(2026, 10, 7))).toBe('2026-11-07');
  });
});
