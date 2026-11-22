import { useEffect, useState } from 'react';
import type { Note } from '@vault/core';
import { useApp } from '../app/store';
import { ko } from '../i18n/ko';
import { relTime } from '../app/util';
import { ui } from '../app/ui';

type Row = { version: number; savedAt: string; note: Note };

export function VersionHistory({ noteId, onClose }: { noteId: string; onClose: () => void }) {
  const app = useApp((s) => s.app);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [preview, setPreview] = useState<Row | null>(null);
  useEffect(() => {
    void app.session.history(noteId).then(setRows);
  }, [app, noteId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay center" onClick={onClose}>
      <div className="dialog" role="dialog" aria-label={ko.history.title} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div>
          <h2>{ko.history.title}</h2>
        </div>
        {rows === null ? (
          <div className="skeleton" />
        ) : rows.length <= 1 ? (
          <p className="small muted">{ko.history.empty}</p>
        ) : (
          <div>
            {rows.map((r, i) => (
              <div key={`${r.version}-${r.savedAt}`} className="history-row">
                <span>
                  {ko.history.version(r.version)} <span className="muted">{relTime(r.savedAt)}</span>
                  {i === 0 && <span className="chip" style={{ marginLeft: 8 }}>{ko.history.current}</span>}
                </span>
                <span style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="btn btn-sm" onClick={() => setPreview(preview?.version === r.version ? null : r)}>{ko.history.preview}</button>
                  {i > 0 && (
                    <button type="button" className="btn btn-sm" onClick={() => void app.session.revert(noteId, r.version).then(() => {
                      onClose();
                      ui.toast(ko.history.reverted(r.version));
                    })}>{ko.history.revert}</button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
        {preview && (
          <pre style={{ maxHeight: 240, overflow: 'auto', margin: 0, padding: 12, background: 'var(--paper)', borderRadius: 8, fontFamily: 'var(--font-sans)', whiteSpace: 'pre-wrap', fontSize: 13 }}>
            <strong>{preview.note.title}</strong>
            {'\n'}
            {preview.note.body}
          </pre>
        )}
        <div className="actions">
          <button type="button" className="btn btn-sm" onClick={onClose}>{ko.common.close}</button>
        </div>
      </div>
    </div>
  );
}
