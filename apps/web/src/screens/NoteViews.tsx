import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { isConflictCopy, type Note } from '@vault/core';
import { useApp } from '../app/store';
import { ui } from '../app/ui';
import { ko } from '../i18n/ko';
import { dayKey, displayTitle, formatDay, monthGrid, noteDay, relTime, snippet } from '../app/util';
import { PinIcon } from '../components/Icons';

/**
 * 빠른 메모: 한 줄 쓰고 Enter → 새 메모 (편집기로 넘어가지 않고 계속 적을 수 있다).
 * 캘린더에서 고른 날이 있으면 그 날짜의 일정으로 만든다. Shift+Enter는 만들고 바로 연다.
 */
export function QuickAdd() {
  const app = useApp((s) => s.app);
  const view = useApp((s) => s.view);
  const calDay = useApp((s) => s.calDay);
  const filter = useApp((s) => s.filter);
  const [text, setText] = useState('');
  const date = view === 'calendar' ? calDay : null;
  const add = async (open: boolean) => {
    const t = text.trim();
    if (!t) return;
    const [first, ...rest] = t.split('\n');
    // 저장을 기다리기 전에 칸부터 비운다. 저장이 끝난 뒤에 비우면 그 사이에 친 다음 메모가 같이 지워진다.
    setText('');
    const n = await app.session.save({
      title: first ?? '',
      body: rest.join('\n'),
      date,
      folder: filter.kind === 'folder' ? filter.folder : null,
    });
    if (app.backendKind !== 'memory') app.scheduler.requestNow();
    if (open) useApp.getState().select(n.id);
    else ui.toast(date ? ko.quick.addedOn(formatDay(date)) : ko.quick.added);
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
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder={date ? ko.quick.placeholderOn(formatDay(date)) : ko.quick.placeholder}
        aria-label={ko.quick.label}
      />
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

export function NoteRow({ n, now }: { n: Note; now: number }) {
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
        <time dateTime={n.updatedAt}>{relTime(n.updatedAt, now)}</time>
      </div>
      {snippet(n.body) && <div className="s">{snippet(n.body)}</div>}
      {(n.date || isConflictCopy(n)) && (
        <div className="row-meta">
          <DateChip date={n.date} />
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

/** 월 캘린더. 날을 누르면 그 날의 메모가 아래에 나오고, 빠른 메모가 그 날짜로 들어간다. */
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
  const dayNotes = calDay ? (byDay.get(calDay) ?? []) : [];
  const undated = calBasis === 'date' ? list.filter((n) => !noteDay(n, 'date')).length : 0;

  // 방향키로 날짜 이동 (키보드만으로 조작)
  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!step) return;
    e.preventDefault();
    const base = calDay ?? today;
    const [by, bm, bd] = base.split('-').map(Number) as [number, number, number];
    const next = dayKey(new Date(by, bm - 1, bd + step));
    setCal({ month: next.slice(0, 7), day: next });
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`)?.focus());
  };

  return (
    <div className="calendar">
      <div className="cal-head">
        <div className="cal-nav">
          <button type="button" className="icon-round" aria-label={ko.cal.prev} onClick={() => move(-1)}>‹</button>
          <h2 className="cal-title">{ko.time.month(y, m)}</h2>
          <button type="button" className="icon-round" aria-label={ko.cal.next} onClick={() => move(1)}>›</button>
          <button type="button" className="btn btn-sm" onClick={goToday}>{ko.cal.today}</button>
        </div>
        <div className="segment" role="group" aria-label={ko.cal.basis}>
          {(['date', 'created'] as const).map((b) => (
            <button key={b} type="button" aria-pressed={calBasis === b} onClick={() => setPref('calBasis', b)}>{ko.cal.bases[b]}</button>
          ))}
        </div>
      </div>
      <div className="cal-grid" role="grid" aria-label={ko.time.month(y, m)} ref={gridRef} onKeyDown={onGridKey}>
        {ko.time.weekdays.map((w, i) => (
          <div key={w} className={`cal-wd${i === 0 ? ' sun' : ''}`} role="columnheader">{w}</div>
        ))}
        {days.map((d) => {
          const items = byDay.get(d) ?? [];
          const inMonth = d.slice(0, 7) === calMonth;
          const label = `${formatDay(d)}${items.length ? `, ${ko.main.count(items.length)}` : ''}`;
          return (
            <button
              key={d}
              type="button"
              role="gridcell"
              data-day={d}
              className={`cal-cell${inMonth ? '' : ' out'}${d === today ? ' today' : ''}`}
              aria-selected={d === calDay}
              aria-label={label}
              tabIndex={d === (calDay ?? today) ? 0 : -1}
              onClick={() => setCal({ day: d })}
            >
              <span className="cal-num">{Number(d.slice(8))}</span>
              <span className="cal-items">
                {items.slice(0, 3).map((n) => (
                  <span key={n.id} className="cal-item">{displayTitle(n)}</span>
                ))}
                {items.length > 3 && <span className="cal-more">+{items.length - 3}</span>}
              </span>
              {items.length > 0 && <span className="cal-dot" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <div className="cal-day">
        {calDay ? (
          <>
            <div className="cal-day-head">
              <strong>{formatDay(calDay)}</strong>
              <span className="muted small">{ko.main.count(dayNotes.length)}</span>
            </div>
            {dayNotes.length === 0 ? (
              <p className="small muted">{ko.cal.emptyDay}</p>
            ) : (
              dayNotes.map((n) => <NoteRow key={n.id} n={n} now={now} />)
            )}
          </>
        ) : (
          <p className="small muted">
            {ko.cal.pickDay}
            {undated > 0 && (
              <>
                {' '}
                <button type="button" className="btn-link" onClick={() => setPref('view', 'list')}>{ko.cal.undated(undated)}</button>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
