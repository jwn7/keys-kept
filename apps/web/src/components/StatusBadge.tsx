import { useEffect, useState } from 'react';
import type { SyncStatus } from '@vault/core';
import { ko } from '../i18n/ko';
import { relTime } from '../app/util';
import { useApp } from '../app/store';

/** 상태는 항상 색 + 형태(점) + 텍스트 (DESIGN.md). 로그인 만료는 누를 수 있는 버튼으로 보여준다. */
export function StatusBadge({ status, local }: { status: SyncStatus; local: boolean }) {
  const [, tick] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  if (local) return <span className="badge muted">{ko.sync.localOnly}</span>;
  switch (status.state) {
    case 'synced':
      return <span className="badge ok">{ko.sync.synced(status.at ? relTime(status.at) : ko.time.justNow)}</span>;
    case 'syncing':
      return <span className="badge ok busy">{ko.sync.syncing}</span>;
    case 'offline':
      return <span className="badge warn">{ko.sync.offline(status.pending)}</span>;
    case 'auth':
      // 로그인 창은 여기서 사용자가 누를 때만 연다 (팝업 차단도 피한다)
      return (
        <button
          type="button"
          className="badge warn badge-action"
          title={ko.sync.reconnectHint(status.pending)}
          disabled={busy}
          onClick={async () => {
            const { app } = useApp.getState();
            setBusy(true);
            try {
              await app.driveAuth?.reconnect();
              await app.session.sync();
            } catch {
              /* 창을 닫았으면 그대로 */
            } finally {
              setBusy(false);
            }
          }}
        >
          {ko.sync.reconnect}
        </button>
      );
    case 'conflict':
      return <span className="badge danger">{ko.sync.conflicts(status.count)}</span>;
    case 'error':
      return <span className="badge danger" title={status.message}>{ko.sync.error}</span>;
  }
}
