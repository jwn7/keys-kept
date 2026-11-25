import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { detectKey, isConflictCopy, isSecret, parseEnv, secretIssues, type Note } from '@vault/core';
import { KeyRow } from './KeyViews';
import { flushEditor, useApp } from '../app/store';
import { checkTask, openTasks, parseQuickDate, reviewDue, type Task } from '../app/assist';
import { markCapture } from '../app/metrics';
import { ko } from '../i18n/ko';
import { dayKey, displayTitle, formatDay, monthGrid, noteDay, relTime, snippet } from '../app/util';
import { PinIcon } from '../components/Icons';

/**
 * 빠른 메모: 한 줄 쓰고 Enter → 새 메모 (편집기로 넘어가지 않고 계속 적을 수 있다).
 * 캘린더에서 고른 날이 있으면 그 날짜의 일정으로 만든다. Shift+Enter는 만들고 바로 연다.
 * "내일 치과 3시"처럼 앞뒤에 날짜 말이 있으면 날짜로 바꾼다. 바뀔 날짜를 칩으로 미리 보여주고, 칩을 누르면 뺀다.
 */
export function QuickAdd() {
  const app = useApp((s) => s.app);
  const view = useApp((s) => s.view);
  const calDay = useApp((s) => s.calDay);
  const filter = useApp((s) => s.filter);
  const [text, setText] = useState('');
  const [noDate, setNoDate] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const date = view === 'calendar' && filter.kind !== 'today' ? calDay : null;
  const parsed = useMemo(() => (date || noDate ? null : parseQuickDate(text, new Date())), [text, date, noDate]);
  // 잠금을 풀면 아무 것도 누르지 않고 바로 적을 수 있게 (PC만. 모바일에서는 키보드가 화면을 가린다)
  useEffect(() => {
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches && !useApp.getState().selectedId) inputRef.current?.focus();
  }, []);
  const add = async (open: boolean) => {
    const t = text.trim();
    if (!t) return;
    // `NAME=value` 또는 알아볼 수 있는 키 값이면 메모가 아니라 키 항목으로 넣는다
    const pair = /^(?:export\s+)?[A-Z_][A-Z0-9_]*=\S/.test(t) ? parseEnv(t)[0] : undefined;
    const bare = pair ? null : detectKey(t);
    if (pair || bare) {
      setText('');
      setNoDate(false);
      markCapture('quick');
      const k = await app.session.save({
        title: pair ? pair.name : `${bare!.provider} ${bare!.kind}`,
        folder: filter.kind === 'folder' ? filter.folder : null,
        secret: { value: pair ? pair.value : t, env: useApp.getState().envFilter, usedIn: [] },
      });
      if (app.backendKind !== 'memory') app.scheduler.requestNow();
      if (open) useApp.getState().select(k.id);
      return;
    }
    const when = parsed?.date ?? date;
    const [first, ...rest] = (parsed?.date ? parsed.text : t).split('\n');
    // 저장을 기다리기 전에 칸부터 비운다. 저장이 끝난 뒤에 비우면 그 사이에 친 다음 메모가 같이 지워진다.
    setText('');
    setNoDate(false);
    markCapture('quick');
    const n = await app.session.save({
      title: first ?? '',
      body: rest.join('\n'),
      date: when,
      folder: filter.kind === 'folder' ? filter.folder : null,
    });
    if (app.backendKind !== 'memory') app.scheduler.requestNow();
    // 추가한 메모가 목록·캘린더에 바로 나타나는 것이 피드백이다. 알림을 따로 띄우지 않는다.
    if (open) useApp.getState().select(n.id);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void add(e.shiftKey);
  };
  return (
    <div className="quick-add">
      <span className="quick-plus" aria-hidden="true">+</span>
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (!e.target.value) setNoDate(false);
        }}
        onKeyDown={onKey}
        onPaste={(e) => {
          // 여러 줄짜리 .env를 붙여 넣으면 한 줄로 뭉개지 않고 넣기 창을 연다
          const pasted = e.clipboardData.getData('text');
          if (/\n/.test(pasted) && parseEnv(pasted).length >= 2) {
            e.preventDefault();
            useApp.getState().setEnvImport({ text: pasted });
          }
        }}
        placeholder={date ? ko.quick.placeholderOn(formatDay(date)) : ko.quick.placeholder}
        aria-label={ko.quick.label}
      />
      {parsed?.date && (
        <button type="button" className="quick-date" title={ko.quick.dateCancel(formatDay(parsed.date))} aria-label={ko.quick.dateCancel(formatDay(parsed.date))} onClick={() => setNoDate(true)}>
          {formatDay(parsed.date)} <span aria-hidden="true">×</span>
        </button>
      )}
      {text && (
        <button type="button" className="clear" aria-label={ko.common.clear} onClick={() => setText('')}>
          ×
        </button>
      )}
    </div>
  );
}

export function DateChip({ date }: { date: string | null | undefined }) {
  if (!date) return null;
  const today = dayKey(new Date());
  return <span className={`date-chip${date === today ? ' today' : ''}`}>{date === today ? ko.cal.today : formatDay(date)}</span>;
}

/** 키 항목이면 키 줄로, 아니면 메모 줄로. */
export function NoteRow(props: { n: Note; now: number; hideDate?: boolean }) {
  return isSecret(props.n) ? <KeyRow n={props.n} /> : <PlainRow {...props} />;
}

/** hideDate: 일정 목록 안에서는 날짜가 이미 묶음 제목에 있으므로 날짜 칩과 수정 시각을 숨긴다 */
function PlainRow({ n, now, hideDate }: { n: Note; now: number; hideDate?: boolean }) {
  const selectedId = useApp((s) => s.selectedId);
  const select = useApp((s) => s.select);
  return (
    <button type="button" className="note-row" aria-current={n.id === selectedId ? 'true' : undefined} onClick={() => select(n.id)}>
      <div className="t">
        <span>
          {n.pinned && (
            <span className="pin" title={ko.main.pinned}>
              <PinIcon />
              <span className="sr-only">{ko.main.pinned}</span>
            </span>
          )}
          {displayTitle(n)}
        </span>
        {!hideDate && <time dateTime={n.updatedAt}>{relTime(n.updatedAt, now)}</time>}
      </div>
      {snippet(n.body) && <div className="s">{snippet(n.body)}</div>}
      {((n.date && !hideDate) || isConflictCopy(n)) && (
        <div className="row-meta">
          {!hideDate && <DateChip date={n.date} />}
          {isConflictCopy(n) && <span className="conflict-flag">{n.title.slice(n.title.indexOf('(충돌 사본') + 1, -1)}</span>}
        </div>
      )}
    </button>
  );
}

/** 카드 보기: 제목·미리보기·날짜·태그를 같은 자리에 두어 훑어보기 쉽게 */
export function CardGrid({ list }: { list: Note[] }) {
  const selectedId = useApp((s) => s.selectedId);
  const select = useApp((s) => s.select);
  return (
    <div className="card-grid">
      {list.map((n) => (
        <button key={n.id} type="button" className="note-card" aria-current={n.id === selectedId ? 'true' : undefined} onClick={() => select(n.id)}>
          <span className="note-card-title">
            {n.pinned && <PinIcon />}
            {displayTitle(n)}
          </span>
          {snippet(n.body) && <span className="note-card-body">{snippet(n.body, 160)}</span>}
          <span className="note-card-foot">
            {n.date ? <DateChip date={n.date} /> : <span>{relTime(n.updatedAt)}</span>}
            {n.tags.slice(0, 2).map((t) => (
              <span key={t} className="tag-mini">#{t}</span>
            ))}
          </span>
        </button>
      ))}
    </div>
  );
}

/** 앞으로 며칠치 일정을 날짜별로 묶는다 (오늘 포함, 고른 날은 위에서 따로 보여주므로 뺀다). */
function upcomingGroups(byDay: Map<string, Note[]>, today: string, skip: string | null, days = 30): [string, Note[]][] {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const out: [string, Note[]][] = [];
  for (let i = 0; i < days; i++) {
    const k = dayKey(new Date(y, m - 1, d + i));
    const items = byDay.get(k);
    if (items && k !== skip) out.push([k, items]);
  }
  return out;
}

const MAX_TASKS = 8;

/**
 * 첫 화면의 묶음 하나. TodayView 안에서 정의하면 다시 그려질 때마다 줄들이 새로 만들어져,
 * 입력 칸에서 벗어나며 저장이 일어나는 순간의 클릭이 사라진다 (사이드바 Item과 같은 문제). 그래서 바깥에 둔다.
 */
function Group({ label, list, now }: { label: string; list: Note[]; now: number }) {
  if (list.length === 0) return null;
  return (
    <section aria-label={label}>
      <h2 className="label agenda-label">{label}</h2>
      {list.map((n) => (
        <NoteRow key={n.id} n={n} now={now} />
      ))}
    </section>
  );
}

/**
 * 오늘 화면: 열자마자 "오늘 뭐가 있고, 뭘 해야 하고, 뭘 다시 봐야 하나"가 보이게 한다.
 * 한 메모는 한 묶음에만 나온다 (위 묶음이 우선).
 */
export function TodayView({ now, onDaily }: { now: number; onDaily: () => void }) {
  const app = useApp((s) => s.app);
  const notes = useApp((s) => s.notes);
  const select = useApp((s) => s.select);
  const setFilter = useApp((s) => s.setFilter);
  const today = dayKey(new Date(now));
  const v = useMemo(() => {
    const byDay = new Map<string, Note[]>();
    for (const n of notes) {
      if (isSecret(n)) continue; // 키의 날짜는 만료일이다. 일정이 아니라 '지금 살펴볼 키'에서 본다
      const k = noteDay(n, 'date');
      if (k) byDay.set(k, [...(byDay.get(k) ?? []), n]);
    }
    // 공개될 수 있는 키가 먼저, 그다음 만료가 가까운 순
    const attention = notes
      .filter((n) => secretIssues(n, today).length > 0)
      .sort((a, b) => Number(secretIssues(b, today).includes('public-name')) - Number(secretIssues(a, today).includes('public-name')) || (a.date ?? '9').localeCompare(b.date ?? '9'));
    const noPlace = notes.filter((n) => isSecret(n) && n.secret.usedIn.length === 0).length;
    const hasKeys = notes.some(isSecret);
    const todays = byDay.get(today) ?? [];
    const upcoming = upcomingGroups(byDay, today, today, 8);
    const shown = new Set([...attention, ...todays, ...upcoming.flatMap(([, items]) => items)].map((n) => n.id));
    const take = (list: Note[]) => {
      const out = list.filter((n) => !shown.has(n.id));
      for (const n of out) shown.add(n.id);
      return out;
    };
    const review = take(reviewDue(notes, today));
    const pinned = take(notes.filter((n) => n.pinned));
    const recent = take([...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).filter((n) => !shown.has(n.id)).slice(0, 6));
    return { attention, noPlace, hasKeys, todays, upcoming, review, pinned, recent, tasks: openTasks(notes), rest: notes.length - shown.size };
  }, [notes, today]);
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  const tomorrow = dayKey(new Date(ty, tm - 1, td + 1));

  const done = async (t: Task) => {
    await flushEditor(); // 열려 있는 메모에 아직 저장 안 된 입력이 있으면 먼저 저장한다
    const cur = useApp.getState().notes.find((n) => n.id === t.noteId);
    if (!cur) return;
    await app.session.save({ id: cur.id, body: checkTask(cur.body, t.line) });
    if (app.backendKind !== 'memory') app.scheduler.requestNow();
  };

  return (
    <div className="today">
      <div className="today-head">
        <span>{formatDay(today)}</span>
        <button type="button" className="btn-link" onClick={onDaily} title="Ctrl+D">{ko.main.today}</button>
      </div>
      {v.hasKeys && (
        <section aria-label={ko.keys.attention}>
          <h2 className="label agenda-label">{ko.keys.attention}</h2>
          {v.attention.length === 0 ? <p className="agenda-empty">{ko.keys.allClear}</p> : v.attention.map((n) => <NoteRow key={n.id} n={n} now={now} />)}
          {v.noPlace > 0 && (
            <p className="agenda-empty no-place">
              <button type="button" className="btn-link" onClick={() => setFilter({ kind: 'keys' })}>{ko.keys.noPlace(v.noPlace)}</button> {ko.keys.noPlaceHint}
            </p>
          )}
        </section>
      )}
      {/* 키 장부로 쓰는 사람에게 "일정이 없습니다"는 소음이다. 일정이 있거나 키가 하나도 없을 때만 보인다 */}
      {(v.todays.length > 0 || !v.hasKeys) && (
        <section aria-label={ko.main.todaySchedule}>
          <h2 className="label agenda-label">{ko.main.todaySchedule}</h2>
          {v.todays.length === 0 ? <p className="agenda-empty">{ko.cal.emptyDay}</p> : v.todays.map((n) => <NoteRow key={n.id} n={n} now={now} hideDate />)}
        </section>
      )}
      {v.tasks.length > 0 && (
        <section aria-label={ko.main.tasks}>
          <h2 className="label agenda-label">{ko.main.tasks}</h2>
          {v.tasks.slice(0, MAX_TASKS).map((t) => (
            <div key={`${t.noteId}:${t.line}`} className="task-row">
              <input type="checkbox" checked={false} aria-label={t.text} onChange={() => void done(t)} />
              <button type="button" className="task-text" onClick={() => select(t.noteId)}>
                <span>{t.text}</span>
                <span className="task-from">{[t.noteTitle || ko.main.untitled, t.date && (t.date === today ? ko.cal.today : formatDay(t.date))].filter(Boolean).join(' · ')}</span>
              </button>
            </div>
          ))}
          {v.tasks.length > MAX_TASKS && <p className="agenda-empty">{ko.main.moreTasks(v.tasks.length - MAX_TASKS)}</p>}
        </section>
      )}
      {v.upcoming.length > 0 && (
        <section aria-label={ko.cal.upcoming}>
          <h2 className="label agenda-label">{ko.cal.upcoming}</h2>
          {v.upcoming.map(([k, items]) => (
            <div key={k} className="agenda-group">
              <div className="agenda-date">{k === tomorrow ? ko.cal.tomorrow : formatDay(k)}</div>
              <div className="agenda-items">
                {items.map((n) => (
                  <NoteRow key={n.id} n={n} now={now} hideDate />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
      <Group label={ko.main.review} list={v.review} now={now} />
      <Group label={ko.main.pinnedSection} list={v.pinned} now={now} />
      <Group label={ko.main.recent} list={v.recent} now={now} />
      {v.rest > 0 && (
        <button type="button" className="btn-link muted agenda-undated" onClick={() => setFilter({ kind: 'all' })}>{ko.main.seeAll(notes.length)}</button>
      )}
    </div>
  );
}

/**
 * 캘린더: 왼쪽에 작은 달력, 오른쪽에 고른 날의 메모와 다가오는 일정.
 * 달력은 "어느 날에 무엇이 있나"만 점으로 보여주고, 내용은 오른쪽 목록에서 읽는다 (큰 칸에 제목을 잘라 넣지 않는다).
 */
export function CalendarView({ list, now }: { list: Note[]; now: number }) {
  const calMonth = useApp((s) => s.calMonth);
  const calDay = useApp((s) => s.calDay);
  const calBasis = useApp((s) => s.calBasis);
  const setCal = useApp((s) => s.setCal);
  const setPref = useApp((s) => s.setPref);
  const gridRef = useRef<HTMLDivElement>(null);
  const [y, m] = calMonth.split('-').map(Number) as [number, number];
  const days = useMemo(() => monthGrid(y, m - 1), [y, m]);
  const today = dayKey(new Date(now));
  const byDay = useMemo(() => {
    const map = new Map<string, Note[]>();
    for (const n of list) {
      const k = noteDay(n, calBasis);
      if (!k) continue;
      const arr = map.get(k) ?? [];
      arr.push(n);
      map.set(k, arr);
    }
    return map;
  }, [list, calBasis]);
  const move = (delta: number) => {
    const d = new Date(y, m - 1 + delta, 1);
    setCal({ month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` });
  };
  const goToday = () => setCal({ month: today.slice(0, 7), day: today });
  const selected = calDay ?? today;
  const dayNotes = byDay.get(selected) ?? [];
  const upcoming = calBasis === 'date' ? upcomingGroups(byDay, today, selected) : [];
  const undated = calBasis === 'date' ? list.filter((n) => !noteDay(n, 'date')).length : 0;

  // 방향키로 날짜 이동 (키보드만으로 조작)
  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!step) return;
    e.preventDefault();
    const [by, bm, bd] = selected.split('-').map(Number) as [number, number, number];
    const next = dayKey(new Date(by, bm - 1, bd + step));
    setCal({ month: next.slice(0, 7), day: next });
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`)?.focus());
  };

  return (
    <div className="calendar">
      <div className="cal-side">
        <div className="cal-head">
          <h2 className="cal-title">{ko.time.month(y, m)}</h2>
          <div className="cal-nav">
            <button type="button" className="icon-round" aria-label={ko.cal.prev} onClick={() => move(-1)}>‹</button>
            <button type="button" className="btn btn-sm" onClick={goToday}>{ko.cal.today}</button>
            <button type="button" className="icon-round" aria-label={ko.cal.next} onClick={() => move(1)}>›</button>
          </div>
        </div>
        <div className="cal-grid" ref={gridRef} onKeyDown={onGridKey}>
          {ko.time.weekdays.map((w, i) => (
            <div key={w} className={`cal-wd${i === 0 ? ' sun' : ''}`} aria-hidden="true">{w}</div>
          ))}
          {days.map((d) => {
            const count = byDay.get(d)?.length ?? 0;
            const inMonth = d.slice(0, 7) === calMonth;
            return (
              <button
                key={d}
                type="button"
                data-day={d}
                className={`cal-cell${inMonth ? '' : ' out'}${d === today ? ' today' : ''}`}
                aria-pressed={d === selected}
                aria-label={`${formatDay(d)}${count ? `, ${ko.main.count(count)}` : ''}`}
                tabIndex={d === selected ? 0 : -1}
                onClick={() => setCal({ day: d })}
              >
                <span className="cal-num">{Number(d.slice(8))}</span>
                <span className="cal-dots" aria-hidden="true">
                  {Array.from({ length: Math.min(3, count) }, (_, i) => (
                    <i key={i} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        <div className="segment" role="group" aria-label={ko.cal.basis}>
          {(['date', 'created'] as const).map((b) => (
            <button key={b} type="button" aria-pressed={calBasis === b} onClick={() => setPref('calBasis', b)}>{ko.cal.bases[b]}</button>
          ))}
        </div>
      </div>
      <div className="cal-agenda">
        <section className="agenda-day" aria-label={formatDay(selected)}>
          <h3 className="agenda-head">
            {selected === today && <span className="date-chip today">{ko.cal.today}</span>}
            {formatDay(selected)}
            <span className="agenda-count">{dayNotes.length > 0 && ko.main.count(dayNotes.length)}</span>
          </h3>
          {dayNotes.length === 0 ? <p className="agenda-empty">{ko.cal.emptyDay}</p> : dayNotes.map((n) => <NoteRow key={n.id} n={n} now={now} hideDate />)}
        </section>
        {upcoming.length > 0 && (
          <section aria-label={ko.cal.upcoming}>
            <div className="label agenda-label">{ko.cal.upcoming}</div>
            {upcoming.map(([k, items]) => (
              <div key={k} className="agenda-group">
                <button type="button" className="agenda-date" onClick={() => setCal({ day: k })}>
                  {k === today ? ko.cal.today : formatDay(k)}
                </button>
                <div className="agenda-items">
                  {items.map((n) => (
                    <NoteRow key={n.id} n={n} now={now} hideDate />
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}
        {undated > 0 && (
          <button type="button" className="btn-link muted agenda-undated" onClick={() => setPref('view', 'list')}>{ko.cal.undated(undated)}</button>
        )}
      </div>
    </div>
  );
}
