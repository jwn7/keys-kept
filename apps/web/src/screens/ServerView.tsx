import { useEffect, useState } from 'react';
import type { Note } from '@vault/core';
import { useApp } from '../app/store';
import { ko } from '../i18n/ko';
import { displayTitle, snippet } from '../app/util';

/**
 * "서버가 보는 모습": 이 메모가 디스크와 서버에 실제로 어떤 글자로 있는지 그대로 보여준다.
 * 암호화된다는 말을 믿으라고 하지 않고 눈으로 확인하게 한다 (docs/KPI.md).
 */
export function ServerView({ note, onClose }: { note: Note; onClose: () => void }) {
  const app = useApp((s) => s.app);
  const [raw, setRaw] = useState<string | null>(null);
  useEffect(() => {
    void app.session.rawItem(note.id).then((item) => {
      if (!item) return setRaw('');
      // 암호문은 길어서 앞부분만. 나머지 필드는 서버에 올라가는 그대로다.
      const head = item.ciphertext.slice(0, 96);
      setRaw(JSON.stringify({ ...item, ciphertext: head + (item.ciphertext.length > 96 ? ko.proof.more(item.ciphertext.length) : '') }, null, 2));
    });
  }, [app, note.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay center" onClick={onClose}>
      <div className="dialog" role="dialog" aria-label={ko.proof.title} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <h2>{ko.proof.title}</h2>
        <div className="proof-pane">
          <div className="label">{ko.proof.mine}</div>
          <div className="proof-plain">
            <strong>{displayTitle(note)}</strong>
            {snippet(note.body, 120) && <span>{snippet(note.body, 120)}</span>}
          </div>
        </div>
        <div className="proof-pane">
          <div className="label">{ko.proof.theirs}</div>
          {raw === null ? <div className="skeleton" /> : <pre className="proof-raw">{raw}</pre>}
        </div>
        <p className="small muted">{ko.proof.note}</p>
        <div className="actions">
          <button type="button" className="btn btn-sm" onClick={onClose}>{ko.common.close}</button>
        </div>
      </div>
    </div>
  );
}
