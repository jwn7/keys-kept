import { useEffect, useRef, useState } from 'react';
import { extractTags, type Note } from '@vault/core';
import { registerEditorFlush, useApp } from '../app/store';
import { ui } from '../app/ui';
import { ko } from '../i18n/ko';
import { charCount, displayTitle, formatDay, relTime } from '../app/util';
import { createMarkdownEditor, type EditorHandle } from '../editor/markdownEditor';
import { LockIcon } from '../components/Icons';
import { useBacklinks, useNoteActions } from './MainScreen';
import { VersionHistory } from './VersionHistory';

/** 입력 후 1초 디바운스 → 로컬 암호화 저장 → outbox (SPEC §2.1) */
const DEBOUNCE_MS = 1000;
const RETRY_MS = 3000;

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

export function Editor() {
  const app = useApp((s) => s.app);
  const selectedId = useApp((s) => s.selectedId);
  const notes = useApp((s) => s.notes);
  const trash = useApp((s) => s.trash);
  const status = useApp((s) => s.status);
  const mobileView = useApp((s) => s.mobileView);
  const view = useApp((s) => s.view);
  const select = useApp((s) => s.select);
  const actions = useNoteActions();
  const note = notes.find((n) => n.id === selectedId) ?? trash.find((n) => n.id === selectedId) ?? null;
  const inTrash = !!note && note.deletedAt !== null;
  const backlinks = useBacklinks(selectedId);

  const [title, setTitle] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versionCount, setVersionCount] = useState(0);
  const [chars, setChars] = useState(0);
  const bodyRef = useRef('');
  const hostRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<EditorHandle | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteRef = useRef<Note | null>(null);
  noteRef.current = note;
  const titleRef = useRef('');
  titleRef.current = title;
  const dirtyRef = useRef(false);

  /**
   * 미저장분을 지금 저장. `target`은 어느 메모의 내용인지 — 메모 전환 cleanup에서는 반드시 이전 메모를 넘긴다.
   * (noteRef는 렌더 직후 이미 새 메모를 가리키므로, ref만 믿으면 이전 내용이 새 메모에 덮어써진다.)
   */
  const flush = async (target: Note | null = noteRef.current): Promise<void> => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const n = target;
    if (!n || n.deletedAt !== null) return;
    if (!dirtyRef.current) return;
    if (app.session.isLocked) return; // 열쇠가 없으면 암호화할 수 없다. 잠그는 쪽(lockNow)이 먼저 flush를 기다린다.
    const body = bodyRef.current;
    const t = titleRef.current;
    dirtyRef.current = false;
    if (body === n.body && t === n.title) {
      setSaveState('saved');
      return;
    }
    setSaveState('saving');
    try {
      const saved = await app.session.save({ id: n.id, title: t, body, tags: mergeTags(n, body) });
      setSavedAt(saved.updatedAt);
      if (!dirtyRef.current) setSaveState('saved');
      if (app.backendKind !== 'memory') app.scheduler.requestNow();
    } catch {
      // 저장 실패(저장 공간 부족 등): 입력은 편집기에 남아 있다. 같은 메모를 보고 있으면 다시 시도한다.
      if (noteRef.current?.id !== n.id) return;
      dirtyRef.current = true;
      setSaveState('error');
      timerRef.current = setTimeout(() => void flush(), RETRY_MS);
    }
  };

  const schedule = () => {
    dirtyRef.current = true;
    setSaveState('dirty');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void flush(), DEBOUNCE_MS);
  };

  // 메모가 바뀌면 편집기 내용 교체. 같은 메모의 외부 갱신(동기화)은 편집 중이 아닐 때만 반영.
  useEffect(() => {
    if (!note || !hostRef.current) return;
    // 선택이 비었다가 다시 생기면 본문 자리(div)가 새로 만들어진다. 옛 자리에 붙은 편집기는 버리고 새로 만든다.
    if (editorRef.current && editorRef.current.view.dom.parentElement !== hostRef.current) {
      editorRef.current.destroy();
      editorRef.current = null;
    }
    if (dirtyRef.current && editorRef.current) return; // 같은 메모를 편집 중이면 외부 갱신으로 덮지 않는다 (다음 저장이 이긴다)
    setTitle(note.title);
    bodyRef.current = note.body;
    setChars(charCount(note.body));
    setSavedAt(note.updatedAt);
    setSaveState('saved');
    void app.session.history(note.id).then((h) => setVersionCount(h.length)).catch(() => setVersionCount(0));
    if (!editorRef.current) {
      editorRef.current = createMarkdownEditor({
        parent: hostRef.current,
        doc: note.body,
        onChange: (text) => {
          bodyRef.current = text;
          setChars(charCount(text));
          schedule();
        },
        titles: () => useApp.getState().notes.map((n) => n.title).filter(Boolean),
        onOpenLink: (t) => void flush().then(() => actions.openByTitle(t)),
        onEscape: () => editorRef.current?.view.contentDOM.blur(),
      });
    } else {
      editorRef.current.setDoc(note.body);
    }
    editorRef.current.setReadOnly(note.deletedAt !== null);
  }, [note?.id, note?.updatedAt]); // 나머지는 ref로 읽는다

  // 방금 만든 빈 메모는 제목부터 쓰게 한다
  useEffect(() => {
    const n = noteRef.current;
    if (n && n.deletedAt === null && n.title === '' && n.body === '') titleInputRef.current?.focus();
  }, [selectedId]);

  // 메모 전환·언마운트 시 "이전" 메모의 미저장분 flush. 클로저로 이전 메모를 고정한다.
  useEffect(() => {
    const previous = note;
    return () => {
      void flush(previous);
    };
  }, [selectedId]);

  // 잠금·목록으로 나가기·탭 숨김: 디바운스를 기다리지 않고 지금 저장
  useEffect(() => registerEditorFlush(() => flush()), []);
  useEffect(() => {
    if (mobileView === 'list') void flush();
  }, [mobileView]);
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);

  useEffect(
    () => () => {
      editorRef.current?.destroy();
      editorRef.current = null; // 개발 모드(StrictMode)는 effect를 두 번 돌린다. 파괴된 뷰를 다시 쓰지 않게 비운다.
    },
    [],
  );

  if (!note) {
    return (
      <main className="editor">
        {/* 빈 화면은 다음 행동을 알려주는 자리: 자주 쓰는 세 가지와 단축키 */}
        <div className="editor-empty">
          <p>{ko.main.noSelection}</p>
          <div className="hint-list">
            <button type="button" onClick={() => void actions.newNote()}><span>{ko.main.hintNew}</span><kbd>Alt N</kbd></button>
            <button type="button" onClick={() => useApp.getState().setPalette(true)}><span>{ko.main.hintSearch}</span><kbd>Ctrl K</kbd></button>
            <button type="button" onClick={() => void actions.today()}><span>{ko.main.hintToday}</span><kbd>Ctrl D</kbd></button>
          </div>
        </div>
      </main>
    );
  }

  const pending = status.state === 'offline' || status.state === 'auth' ? status.pending : 0;
  const crumb = `${note.folder ?? ko.main.noFolder} / ${displayTitle(note)}`;
  const saveText =
    saveState === 'saving' ? ko.editor.saving : saveState === 'error' ? ko.editor.saveFailed : saveState === 'dirty' ? ko.editor.unsaved : ko.editor.savedLocal(relTime(savedAt));

  return (
    <main className="editor">
      <div
        className="editor-inner"
        onFocus={() => useApp.getState().setEditing(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) useApp.getState().setEditing(false);
        }}
      >
        <div className="editor-meta">
          <span className="crumb desktop-only">{crumb}</span>
          {view !== 'list' && (
            <button type="button" className="icon-round desktop-only" aria-label={ko.main.closeNote} title={ko.main.closeNote} onClick={() => void flush().then(() => select(null))}>
              ×
            </button>
          )}
          <span className="lock-note">
            <LockIcon />
            <span>{ko.editor.encryptedShort}</span>
          </span>
        </div>
        <input
          ref={titleInputRef}
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
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
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
              <button type="button" className="chip chip-add" onClick={() => editorRef.current?.insert(' #', 2)}>{ko.editor.addTag}</button>
              <DateField note={note} />
              <NoteMenu note={note} onFlush={flush} />
            </>
          )}
          {inTrash && (
            <>
              <span className="small muted">{ko.editor.readOnlyTrash}</span>
              <button type="button" className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => void app.session.restore(note.id).then(() => useApp.getState().setFilter({ kind: 'all' }))}>{ko.main.restore}</button>
            </>
          )}
        </div>
        <div className="editor-body" ref={hostRef} />
        {!inTrash && (
          <div className="mobile-toolbar">
            <button type="button" onClick={() => editorRef.current?.insertAtLineStart('# ')} aria-label={ko.editor.toolbar.heading}>H</button>
            <button type="button" onClick={() => editorRef.current?.insertAtLineStart('- [ ] ')} aria-label={ko.editor.toolbar.checkbox}>☐</button>
            <button type="button" onClick={() => editorRef.current?.insertAtLineStart('- ')} aria-label={ko.editor.toolbar.list}>•</button>
            <button type="button" onClick={() => editorRef.current?.insert('[[', 2)}>{ko.editor.toolbar.link}</button>
            <button type="button" onClick={() => editorRef.current?.insert('#', 1)}>{ko.editor.toolbar.tag}</button>
            <button type="button" onClick={() => editorRef.current?.insert('```\n\n```', 4)} aria-label={ko.editor.toolbar.code}>{'</>'}</button>
            <button type="button" onClick={() => editorRef.current?.openSlash()}>/</button>
          </div>
        )}
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
            <span className={saveState === 'error' ? 'save-error' : undefined} role="status">
              {(saveState === 'saved' || saveState === 'saving') && <span className="tick" aria-hidden="true">✓ </span>}
              {saveText}
            </span>
            {pending > 0 && <span>{ko.sync.pending(pending)}</span>}
            <span className="chars">{ko.editor.chars(chars)}</span>
            <button type="button" className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => void flush().then(() => setHistoryOpen(true))}>{ko.editor.history(versionCount)}</button>
          </div>
        </div>
      </div>
      {historyOpen && <VersionHistory noteId={note.id} onClose={() => setHistoryOpen(false)} />}
    </main>
  );
}

/** 일정 날짜: 누르면 날짜 고르기가 열린다. 고른 뒤 × 로 지운다 */
function DateField({ note }: { note: Note }) {
  const app = useApp((s) => s.app);
  const ref = useRef<HTMLInputElement>(null);
  const set = (date: string | null) => void app.session.save({ id: note.id, date });
  const open = () => {
    const el = ref.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (el?.showPicker) el.showPicker();
    else el?.focus();
  };
  return (
    <span className="date-field">
      <button type="button" className={`chip${note.date ? ' chip-date' : ' chip-add'}`} onClick={open}>
        {note.date ? formatDay(note.date) : `+ ${ko.cal.setDate}`}
      </button>
      {note.date && (
        <button type="button" className="chip-x" aria-label={ko.cal.clearDate} onClick={() => set(null)}>×</button>
      )}
      <input ref={ref} type="date" className="date-input" tabIndex={-1} aria-hidden="true" value={note.date ?? ''} onChange={(e) => set(e.target.value || null)} />
    </span>
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
  const wrapRef = useRef<HTMLSpanElement>(null);

  // 바깥을 누르거나 Esc를 누르면 닫는다
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const act = async (fn: () => Promise<unknown>) => {
    setOpen(false);
    await onFlush();
    await fn();
  };
  const moveFolder = async () => {
    const folders = [...new Set(useApp.getState().notes.map((n) => n.folder).filter((f): f is string => f !== null))].sort((a, b) => a.localeCompare(b, 'ko'));
    const f = await ui.prompt({
      title: ko.editor.moveFolder,
      label: ko.editor.folderLabel,
      initial: note.folder ?? '',
      suggestions: folders,
      confirmLabel: ko.editor.move,
      allowEmpty: true,
    });
    if (f === null) return;
    await app.session.save({ id: note.id, folder: f.trim() || null });
  };
  // 휴지통은 되돌릴 수 있는 동작이라 확인 창 대신 "되돌리기"를 준다
  const toTrash = async () => {
    await app.session.delete(note.id);
    select(null);
    ui.toast(ko.editor.movedToTrash, {
      label: ko.common.undo,
      run: async () => {
        await app.session.restore(note.id);
        select(note.id);
      },
    });
  };

  return (
    <span ref={wrapRef} style={{ position: 'relative', marginLeft: 'auto' }}>
      <button type="button" className="btn btn-ghost btn-sm" aria-label={ko.editor.more} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>⋯</button>
      {open && (
        <div role="menu" className="menu">
          <button type="button" role="menuitem" onClick={() => void act(() => app.session.save({ id: note.id, pinned: !note.pinned }))}>{note.pinned ? ko.editor.unpin : ko.editor.pin}</button>
          <button type="button" role="menuitem" onClick={() => void act(moveFolder)}>{ko.editor.moveFolder}</button>
          <button type="button" role="menuitem" className="danger" onClick={() => void act(toTrash)}>{ko.editor.delete}</button>
        </div>
      )}
    </span>
  );
}
