import { describe, expect, it } from 'vitest';
import type { Note } from '@vault/core';
import { checkTask, openTasks, parseQuickDate, relatedNotes, reviewDue } from './assist';

const note = (p: Partial<Note> & { id: string }): Note =>
  ({ title: '', body: '', tags: [], folder: null, pinned: false, date: null, createdAt: '2026-11-25T03:00:00.000Z', updatedAt: '2026-11-25T03:00:00.000Z', deletedAt: null, ...p }) as Note;

describe('parseQuickDate', () => {
  const now = new Date(2026, 10, 25, 10); // 2026-11-25 수요일
  const p = (s: string) => parseQuickDate(s, now);

  it('앞이나 뒤의 날짜 말을 떼고 날짜로 바꾼다', () => {
    expect(p('내일 치과 3시')).toEqual({ text: '치과 3시', date: '2026-11-26', word: '내일' });
    expect(p('보고서 마감 모레')).toMatchObject({ text: '보고서 마감', date: '2026-11-27' });
    expect(p('오늘 장보기')).toMatchObject({ date: '2026-11-25' });
  });

  it('요일: 그냥 요일은 다가오는 그 요일, 이번 주·다음 주는 월요일 시작 기준', () => {
    expect(p('금요일 회식').date).toBe('2026-11-27');
    expect(p('수요일 발표').date).toBe('2026-12-02'); // 오늘이 수요일이면 다음 주
    expect(p('다음주 월요일 주간 회의').date).toBe('2026-11-30');
    expect(p('다음 주 일요일 등산').date).toBe('2026-12-06');
    expect(p('이번주 금요일 제출').date).toBe('2026-11-27');
  });

  it('월일: 지난 날짜면 내년, 없는 날짜면 무시', () => {
    expect(p('12월 3일 기말 발표').date).toBe('2026-12-03');
    expect(p('이사 견적 12/5').date).toBe('2026-12-05');
    expect(p('3월 2일 개강').date).toBe('2027-03-02');
    expect(p('2월 30일 뭔가')).toEqual({ text: '2월 30일 뭔가', date: null, word: null });
  });

  it('날짜 말이 문장 가운데 있거나 그것만 있으면 건드리지 않는다', () => {
    expect(p('회의는 내일 하기로 함').date).toBeNull();
    expect(p('내일').date).toBeNull();
    expect(p('내일배움카드 신청').date).toBeNull();
  });

  it('영어 날짜 말: today, tomorrow, 요일, this/next, 12/5 (대소문자 무시)', () => {
    expect(p('tomorrow dentist at 3')).toEqual({ text: 'dentist at 3', date: '2026-11-26', word: 'tomorrow' });
    expect(p('Ship the release Today')).toEqual({ text: 'Ship the release', date: '2026-11-25', word: 'Today' });
    expect(p('friday team dinner').date).toBe('2026-11-27');
    expect(p('Wednesday demo').date).toBe('2026-12-02'); // 오늘이 수요일이면 다음 주
    expect(p('next monday weekly sync').date).toBe('2026-11-30');
    expect(p('hiking next sunday').date).toBe('2026-12-06');
    expect(p('submit this friday').date).toBe('2026-11-27');
    expect(p('moving quote 12/5').date).toBe('2026-12-05');
  });

  it('영어도 문장 가운데나 낱말 일부, 줄임말은 건드리지 않는다', () => {
    expect(p('we agreed tomorrow is fine').date).toBeNull();
    expect(p('tomorrow').date).toBeNull();
    expect(p('todayish plan').date).toBeNull();
    expect(p('lunch with Sun').date).toBeNull();
    expect(p('rotate keys next').date).toBeNull();
  });
});

describe('openTasks / checkTask', () => {
  const notes = [
    note({ id: 'a', title: '주간 회의', body: '## 할 일\n- [x] 끝난 것\n- [ ] @민수 보고서 초안\n1. [ ] 배포 일정 확정', updatedAt: '2026-11-24T00:00:00.000Z' }),
    note({ id: 'b', title: '치과', body: '- [ ] 보험 서류 챙기기', date: '2026-11-26', updatedAt: '2026-11-20T00:00:00.000Z' }),
    note({ id: 'c', title: '일기', body: '할 일 없음 [ ] 이건 목록이 아님' }),
  ];

  it('안 끝난 체크박스만 모으고, 날짜 있는 것을 먼저 둔다', () => {
    const t = openTasks(notes);
    expect(t.map((x) => x.text)).toEqual(['보험 서류 챙기기', '@민수 보고서 초안', '배포 일정 확정']);
    expect(t[0]).toMatchObject({ noteId: 'b', date: '2026-11-26', who: null });
    expect(t[1]).toMatchObject({ noteId: 'a', line: 2, who: '민수', noteTitle: '주간 회의' });
  });

  it('체크하면 그 줄만 바뀐다', () => {
    const body = notes[0]!.body;
    expect(checkTask(body, 2)).toBe('## 할 일\n- [x] 끝난 것\n- [x] @민수 보고서 초안\n1. [ ] 배포 일정 확정');
    expect(checkTask(body, 0)).toBe(body); // 할 일이 아닌 줄
    expect(checkTask(body, 99)).toBe(body);
  });
});

describe('relatedNotes', () => {
  it('태그나 제목 낱말이 겹치는 메모를 점수순으로', () => {
    const cur = note({ id: 'cur', title: '배포 회의', tags: ['업무'] });
    const all = [
      cur,
      note({ id: 'tag', title: '분기 목표', tags: ['업무'] }),
      note({ id: 'title', title: '회의 준비물' }),
      note({ id: 'both', title: '배포 체크리스트', tags: ['업무'] }),
      note({ id: 'body', title: '잡담', body: '어제 회의 얘기' }),
      note({ id: 'none', title: '장보기' }),
    ];
    expect(relatedNotes(cur, all, 3).map((n) => n.id)).toEqual(['both', 'tag', 'title']);
    expect(relatedNotes(cur, all, 10).map((n) => n.id)).not.toContain('none');
    expect(relatedNotes(cur, all, 10).map((n) => n.id)).not.toContain('body'); // 1점은 약한 연결이라 뺀다
  });

  it('제목이 날짜뿐이고 태그도 없으면 추천하지 않는다', () => {
    expect(relatedNotes(note({ id: 'd', title: '2026-11-25' }), [note({ id: 'x', title: '2026-11-25 회고' })])).toEqual([]);
  });
});

describe('reviewDue', () => {
  it('#복습 메모를 쓴 지 1·3·7·14·30일째에만 다시 보여준다', () => {
    const made = (id: string, day: string, tags = ['복습']) => note({ id, tags, createdAt: new Date(`${day}T12:00:00`).toISOString() });
    const notes = [made('d1', '2026-11-24'), made('d2', '2026-11-23'), made('d7', '2026-11-18'), made('d30', '2026-10-26'), made('today', '2026-11-25'), made('plain', '2026-11-24', [])];
    expect(reviewDue(notes, '2026-11-25').map((n) => n.id)).toEqual(['d1', 'd7', 'd30']);
  });

  it('영어 템플릿의 #review 태그도 같이 알아본다', () => {
    const made = (id: string, day: string, tags: string[]) => note({ id, tags, createdAt: new Date(`${day}T12:00:00`).toISOString() });
    const notes = [made('en', '2026-11-24', ['review']), made('ko', '2026-11-22', ['복습']), made('other', '2026-11-24', ['reviewed'])];
    expect(reviewDue(notes, '2026-11-25').map((n) => n.id)).toEqual(['en', 'ko']);
  });
});
