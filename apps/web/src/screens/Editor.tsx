import { useEffect, useRef, useState } from 'react';
import { extractTags, type Note } from '@vault/core';
import { useApp } from '../app/store';
import { ko } from '../i18n/ko';
import { displayTitle, relTime } from '../app/util';
import { createMarkdownEditor, type EditorHandle } from '../editor/markdownEditor';
import { useBacklinks, useNoteActions } from './MainScreen';
import { VersionHistory } from './VersionHistory';

/** 입력 후 1초 디바운스 → 로컬 암호화 저장 → outbox (SPEC §2.1) */
const DEBOUNCE_MS = 1000;

export function Editor() {
  const app = useApp((s) => s.app);
  const selectedId = useApp((s) => s.selectedId);
  const notes = useApp((s) => s.notes);
  const trash = useApp((s) => s.trash);
  const status = useApp((s) => s.status);
  const select = useApp((s) => s.select);
  const actions = useNoteActions();
  const note = notes.find((n) => n.id === selectedId) ?? trash.find((n) => n.id === selectedId) ?? null;
  const inTrash = !!note && note.deletedAt !== null;
  const backlinks = useBacklinks(selectedId);

  const [title, setTitle] = useState('');
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving'>('saved');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versionCount, setVersionCount] = useState(0);
  const bodyRef = useRef('');
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorHandle | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteRef = useRef<Note | null>(null);
  noteRef.current = note;

  /**
   * 미저장분을 지금 저장. `target`은 어느 메모의 내용인지 — 메모 전환 cleanup에서는 반드시 이전 메모를 넘긴다.
   * (noteRef는 렌더 직후 이미 새 메모를 가리키므로, ref만 믿으면 이전 내용이 새 메모에 덮어써진다.)
   */
  const flush = async (target: Note | null = noteRef.current) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const n = target;
    if (!n || n.deletedAt !== null) return;
    if (!dirtyRef.current) return;
    const body = bodyRef.current;
    const t = titleRef.current;
    dirtyRef.current = false;
    if (body === n.body && t === n.title) {
      setSaveState('saved');
      return;
    }
    setSaveState('saving');
    const saved = await app.session.save({ id: n.id, title: t, body, tags: mergeTags(n, body) });
    setSavedAt(saved.updatedAt);
    setSaveState('saved');
    if (app.backendKind !== 'memory') app.scheduler.requestNow();
  };
  const titleRef = useRef('');
  titleRef.current = title;
  const dirtyRef = useRef(false);

  const schedule = () => {
    dirtyRef.current = true;
    setSaveState('dirty');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void flush(), DEBOUNCE_MS);
  };

  // 메모가 바뀌면 편집기 내용 교체. 같은 메모의 외부 갱신(동기화)은 편집 중이 아닐 때만 반영.
  useEffect(() => {
    if (!note || !hostRef.current) return;
    if (dirtyRef.current && editorRef.current) return; // 같은 메모를 편집 중이면 외부 갱신으로 덮지 않는다 (다음 저장이 이긴다)
    setTitle(note.title);
    bodyRef.current = note.body;
    setSavedAt(note.updatedAt);
    setSaveState('saved');
    void app.session.history(note.id).then((h) => setVersionCount(h.length)).catch(() => setVersionCount(0));
    if (!editorRef.current) {
      editorRef.current = createMarkdownEditor({
        parent: hostRef.current,
        doc: note.body,
        onChange: (text) => {
          bodyRef.current = text;
          schedule();
        },
        titles: () => useApp.getState().notes.map((n) => n.title).filter(Boolean),
        onOpenLink: (t) => void flush().then(() => actions.openByTitle(t)),
        onEscape: () => editorRef.current?.view.contentDOM.blur(),
      });
    } else {
      editorRef.current.setDoc(note.body);
    }
  }, [note?.id, note?.updatedAt]); // 나머지는 ref로 읽는다


  // 메모 전환·언마운트 시 "이전" 메모의 미저장분 flush. 클로저로 이전 메모를 고정한다.
  useEffect(() => {
    const previous = note;
    return () => {
      void flush(previous);
    };
  }, [selectedId]);

  useEffect(() => () => editorRef.current?.destroy(), []);

  if (!note) {
    return (
      <main className="editor">
        <div className="empty" style={{ margin: 'auto' }}>
          <span>{ko.main.noSelection}</span>
          <button type="button" className="btn btn-sm" onClick={() => void actions.newNote()}>{ko.main.newNote}</button>
        </div>
      </main>
    );
  }

  const pending = status.state === 'offline' ? status.pending : 0;
  const crumb = `${note.folder ?? ko.main.noFolder} / ${displayTitle(note)}`;

  return (
    <main className="editor">
      <div className="editor-meta">
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" className="btn-link muted mobile-only" onClick={() => void flush().then(() => select(null))}>← {ko.main.allNotes}</button>
          <span className="desktop-only">{crumb}</span>
        </span>
        <span className="lock-note">{ko.editor.encrypted}</span>
      </div>
      <input
        className="editor-title"
        aria-label={ko.editor.title}
        value={title}
        placeholder={ko.main.untitled}
        readOnly={inTrash}
        onChange={(e) => {
          setTitle(e.target.value);
          schedule();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            editorRef.current?.view.focus();
          }
        }}
      />
      <div className="editor-tags">
        {note.tags.map((t) => (
          <button key={t} type="button" className="chip" onClick={() => useApp.getState().setFilter({ kind: 'tag', tag: t })}>#{t}</button>
        ))}
        {!inTrash && (
          <>
            <button type="button" className="chip" style={{ borderStyle: 'dashed', background: 'transparent', color: 'var(--muted)' }} onClick={() => editorRef.current?.insert(' #', 2)}>{ko.editor.addTag}</button>
            <NoteMenu note={note} onFlush={flush} />
          </>
        )}
        {inTrash && (
          <button type="button" className="btn btn-sm" onClick={() => void app.session.restore(note.id).then(() => useApp.getState().setFilter({ kind: 'all' }))}>{ko.main.restore}</button>
        )}
      </div>
      <div className="editor-body" ref={hostRef} />
      <div className="mobile-toolbar">
        <button type="button" onClick={() => editorRef.current?.insertAtLineStart('# ')} aria-label={ko.editor.toolbar.heading}>H</button>
        <button type="button" onClick={() => editorRef.current?.insertAtLineStart('- [ ] ')} aria-label={ko.editor.toolbar.checkbox}>☐</button>
        <button type="button" onClick={() => editorRef.current?.insertAtLineStart('- ')} aria-label={ko.editor.toolbar.list}>•</button>
        <button type="button" onClick={() => editorRef.current?.insert('[[', 2)}>{ko.editor.toolbar.link}</button>
        <button type="button" onClick={() => editorRef.current?.insert('#', 1)}>{ko.editor.toolbar.tag}</button>
        <button type="button" onClick={() => editorRef.current?.insert('```\n\n```', 4)} aria-label={ko.editor.toolbar.code}>{'</>'}</button>
        <button type="button" onClick={() => editorRef.current?.openSlash()}>/</button>
      </div>
      <div className="editor-foot">
        {backlinks.length > 0 && (
          <div className="backlinks">
            <span className="muted">{ko.editor.backlinks(backlinks.length)}</span>
            {backlinks.map((b) => (
              <button key={b.id} type="button" onClick={() => void flush().then(() => select(b.id))}>{displayTitle(b)}</button>
            ))}
          </div>
        )}
        <div className="save-state">
          <span>
            <span style={{ color: 'var(--ok)' }}>✓</span> {saveState === 'saving' ? ko.editor.saving : ko.editor.savedLocal(relTime(savedAt))}
            {pending > 0 && ` · ${ko.sync.pending(pending)}`}
          </span>
          <button type="button" className="btn btn-sm" onClick={() => setHistoryOpen(true)}>{ko.editor.history(versionCount)}</button>
        </div>
      </div>
      {historyOpen && <VersionHistory noteId={note.id} onClose={() => setHistoryOpen(false)} />}
    </main>
  );
}

/** 수동 태그는 유지하고 본문 #태그는 다시 계산 */
function mergeTags(prev: Note, body: string): string[] {
  const auto = new Set(extractTags(body));
  const prevAuto = new Set(extractTags(prev.body));
  const manual = prev.tags.filter((t) => !prevAuto.has(t));
  return [...new Set([...manual, ...auto])];
}

function NoteMenu({ note, onFlush }: { note: Note; onFlush: () => Promise<void> }) {
  const app = useApp((s) => s.app);
  const select = useApp((s) => s.select);
  const [open, setOpen] = useState(false);
  const act = async (fn: () => Promise<unknown>) => {
    setOpen(false);
    await onFlush();
    await fn();
  };
  return (
    <span style={{ position: 'relative', marginLeft: 'auto' }}>
      <button type="button" className="btn btn-ghost btn-sm" aria-label={ko.editor.more} aria-expanded={open} onClick={() => setOpen((o) => !o)}>⋯</button>
      {open && (
        <div role="menu" style={{ position: 'absolute', right: 0, top: '100%', zIndex: 10, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, padding: 6, display: 'flex', flexDirection: 'column', minWidth: 160, boxShadow: '0 8px 24px rgba(0,0,0,.08)' }}>
          <button type="button" className="btn btn-ghost btn-sm" style={{ justifyContent: 'flex-start' }} onClick={() => void act(() => app.session.save({ id: note.id, pinned: !note.pinned }))}>{note.pinned ? ko.editor.unpin : ko.editor.pin}</button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ justifyContent: 'flex-start' }}
            onClick={() =>
              void act(async () => {
                const f = window.prompt(ko.editor.folderPrompt, note.folder ?? '');
                if (f === null) return;
                await app.session.save({ id: note.id, folder: f.trim() || null });
              })
            }
          >
            {ko.editor.moveFolder}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ justifyContent: 'flex-start', color: 'var(--danger)' }}
            onClick={() =>
              void act(async () => {
                if (!window.confirm(ko.editor.deleteConfirm)) return;
                await app.session.delete(note.id);
                select(null);
              })
            }
          >
            {ko.editor.delete}
          </button>
        </div>
      )}
    </span>
  );
}
