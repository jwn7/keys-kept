import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { backupFileName, exportBackup } from '@vault/core';
import { useApp } from '../app/store';
import { ko } from '../i18n/ko';
import { displayTitle, matchSnippet, relTime, searchNotes, shareOrDownload } from '../app/util';
import { ui } from '../app/ui';
import { useNoteActions } from './MainScreen';

type Item = { id: string; kind: 'note' | 'cmd'; label: string; meta?: string; key?: string; run: () => void | Promise<void> };

export function CommandPalette() {
  const notes = useApp((s) => s.notes);
  const app = useApp((s) => s.app);
  const select = useApp((s) => s.select);
  const setPalette = useApp((s) => s.setPalette);
  const setScreen = useApp((s) => s.setScreen);
  const actions = useNoteActions();
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const close = () => setPalette(false);

  const items = useMemo<Item[]>(() => {
    const needle = q.trim().toLowerCase();
    const noteItems: Item[] = searchNotes(notes, needle)
      .slice(0, needle ? 20 : 6)
      .map((n) => ({
        id: n.id,
        kind: 'note',
        label: displayTitle(n),
        // 제목이 아니라 본문에서 찾았으면 그 대목을 보여준다
        meta: (needle && !n.title.toLowerCase().includes(needle) && matchSnippet(n.body, needle)) || `${n.folder ?? ko.main.noFolder}, ${relTime(n.updatedAt)}`,
        run: () => select(n.id),
      }));
    const all: Item[] = [
      { id: 'new', kind: 'cmd', label: ko.palette.cmd.newNote, key: 'Alt N', run: () => void actions.newNote() },
      { id: 'today', kind: 'cmd', label: ko.palette.cmd.today, key: 'Ctrl D', run: () => void actions.today() },
      { id: 'sync', kind: 'cmd', label: ko.palette.cmd.sync, run: () => void actions.syncNow() },
      {
        id: 'backup',
        kind: 'cmd',
        label: ko.palette.cmd.backup,
        run: async () => {
          const pass = await ui.prompt({ title: ko.settings.backup.makeTitle, label: ko.settings.backup.passphrase, password: true, confirmLabel: ko.settings.backup.download });
          if (!pass) return;
          const bytes = await exportBackup(app.session.list(), pass, app.deviceName);
          await shareOrDownload(backupFileName(), bytes);
          useApp.getState().setLastBackup(new Date().toISOString());
        },
      },
      { id: 'settings', kind: 'cmd', label: ko.palette.cmd.settings, run: () => setScreen('settings') },
      { id: 'lock', kind: 'cmd', label: ko.palette.cmd.lock, key: 'Ctrl L', run: () => actions.lock() },
    ];
    const cmds = all.filter((c) => (c.id !== 'sync' || app.backendKind !== 'memory') && (!needle || c.label.toLowerCase().includes(needle)));
    return [...noteItems, ...cmds];
  }, [q, notes, app.backendKind]); // actions/select/setScreen은 안정적


  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => setIdx(0), [q]);

  const run = async (it: Item) => {
    close();
    await it.run();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIdx((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const it = items[idx];
      if (it) void run(it);
    } else if (e.key === 'Escape') close();
  };
  const noteCount = items.filter((i) => i.kind === 'note').length;
  const highlight = (label: string) => {
    const n = q.trim();
    if (!n) return label;
    const i = label.toLowerCase().indexOf(n.toLowerCase());
    if (i < 0) return label;
    return (
      <>
        {label.slice(0, i)}
        <mark>{label.slice(i, i + n.length)}</mark>
        {label.slice(i + n.length)}
      </>
    );
  };

  return (
    <div className="overlay" onClick={close}>
      <div className="palette" role="dialog" aria-label={ko.main.search} onClick={(e) => e.stopPropagation()}>
        <div className="input-wrap">
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder={ko.palette.placeholder} aria-label={ko.palette.placeholder} />
          {q && <button type="button" className="clear" aria-label={ko.common.clear} onClick={() => setQ('')}>×</button>}
        </div>
        <div className="palette-list" role="listbox">
          {noteCount > 0 && <div className="label">{ko.palette.notes(noteCount)}</div>}
          {items.map((it, i) => (
            <Fragment key={it.id}>
              {it.kind === 'cmd' && (i === 0 || items[i - 1]?.kind === 'note') && <div className="label" style={{ paddingTop: 10 }}>{ko.palette.commands}</div>}
              <button type="button" role="option" className="palette-item" aria-selected={i === idx} onMouseEnter={() => setIdx(i)} onClick={() => void run(it)}>
                <span>{highlight(it.label)}</span>
                {it.key ? <kbd>{it.key}</kbd> : <span className="meta">{it.meta}</span>}
              </button>
            </Fragment>
          ))}
          {items.length === 0 && <div className="empty">{ko.palette.noResults}</div>}
        </div>
        <div className="palette-foot">
          <span>{ko.palette.hints.move}</span>
          <span>{ko.palette.hints.open}</span>
          <span>{ko.palette.hints.close}</span>
        </div>
      </div>
    </div>
  );
}
