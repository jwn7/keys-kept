import { describe, expect, it } from 'vitest';
import type { Note } from '@vault/core';
import { backupsToDelete } from './autoBackup';
import { searchNotes, searchScore, dayKey, formatDay, charCount, matchSnippet, passwordScore, relTime, snippet, todayTitle } from './util';

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

describe('자동 백업 정리', () => {
  it('이 앱이 만든 이름만, 최근 것 keep개를 남기고 고른다', () => {
    const names = ['vault-2026-11-01.age', 'vault-2026-11-03.age', '내 문서.txt', 'vault-2026-11-02.age', 'vault-old.age'];
    expect(backupsToDelete(names, 2)).toEqual(['vault-2026-11-01.age']);
    expect(backupsToDelete(names, 14)).toEqual([]);
    expect(backupsToDelete(['메모.age', 'a.txt'], 0)).toEqual([]);
  });
});

describe('검색', () => {
  const a = { ...note('a', '주간 회의', '디자인 검토와 배포 일정'), tags: ['업무'] };
  const b = { ...note('b', '장보기', '우유 회의용 간식'), folder: '개인' };
  const c = note('c', '배포 체크리스트', '회의 없이 진행');
  it('여러 단어는 모두 들어 있어야 한다 (순서 무관, 대소문자 무시)', () => {
    expect(searchNotes([a, b, c], '회의 배포').map((n) => n.id)).toEqual(['a', 'c']);
    expect(searchNotes([a, b, c], '없는말')).toEqual([]);
    expect(searchNotes([{ ...a, title: 'Weekly Sync' }], 'weekly')).toHaveLength(1);
  });
  it('제목에서 찾은 메모가 본문에서 찾은 메모보다 먼저', () => {
    expect(searchNotes([b, a, c], '회의').map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });
  it('#태그와 폴더 이름으로도 찾는다', () => {
    expect(searchNotes([a, b, c], '#업무').map((n) => n.id)).toEqual(['a']);
    expect(searchNotes([a, b, c], '개인').map((n) => n.id)).toEqual(['b']);
  });
  it('빈 검색어는 그대로 돌려준다, searchScore 0은 불일치', () => {
    expect(searchNotes([a, b], '  ')).toEqual([a, b]);
    expect(searchScore(a, ['우유'])).toBe(0);
  });
});

describe('날짜', () => {
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
