import { useEffect, useState } from 'react';
import type { SyncStatus } from '@vault/core';
import { ko } from '../i18n/ko';
import { regrantFolder } from '../app/folderSync';
import { relTime } from '../app/util';
import { useApp } from '../app/store';
import { AlertIcon } from './Icons';

/** 다시 연결: 로그인 창·권한 창은 사용자가 누를 때만 연다 (팝업 차단도 피한다) */
async function reconnect(): Promise<void> {
  const { app } = useApp.getState();
  if (app.backendKind === 'folder') await regrantFolder();
  else await app.driveAuth?.reconnect();
  await app.session.sync();
}

/**
 * 상태는 항상 색 + 형태(점) + 텍스트 (DESIGN.md).
 * 동기화가 멈추면(로그인 만료, 폴더 권한, 오류) 무엇이 안전한지와 누를 단추 하나를 보여 준다 (DESIGN.md 검수 기준).
 * compact: 모바일 상단 바처럼 좁은 곳. 단추만 보인다.
 */
export function StatusBadge({ status, local, compact = false }: { status: SyncStatus; local: boolean; compact?: boolean }) {
  const [, tick] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  if (local) return <span className="badge muted">{ko.sync.localOnly}</span>;
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      /* 창을 닫았으면 그대로 */
    } finally {
      setBusy(false);
    }
  };
  const folder = useApp.getState().app.backendKind === 'folder';
  const stopped = (why: string, pending: number, label: string, fn: () => Promise<void>) =>
    compact ? (
      <button type="button" className="badge warn badge-action" title={`${why} ${ko.sync.safe(pending)}`} disabled={busy} onClick={() => void run(fn)}>
        {label}
      </button>
    ) : (
      <div className="sync-stopped" role="status">
        <span className="sync-stopped-title">
          <AlertIcon />
          {ko.sync.stopped}
        </span>
        <p>
          {why} {ko.sync.safe(pending)}
        </p>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void run(fn)}>
          {label}
        </button>
      </div>
    );
  switch (status.state) {
    case 'synced':
      return <span className="badge ok">{ko.sync.synced(status.at ? relTime(status.at) : ko.time.justNow)}</span>;
    case 'syncing':
      return <span className="badge ok busy">{ko.sync.syncing}</span>;
    case 'offline':
      return <span className="badge warn">{ko.sync.offline(status.pending)}</span>;
    case 'auth':
      return stopped(folder ? ko.sync.stoppedWhy.folder : ko.sync.stoppedWhy.drive, status.pending, folder ? ko.sync.reconnectFolder : ko.sync.reconnect, reconnect);
    case 'conflict':
      return <span className="badge danger">{ko.sync.conflicts(status.count)}</span>;
    case 'error':
      return compact ? (
        <span className="badge danger" title={status.message}>{ko.sync.error}</span>
      ) : (
        stopped(ko.sync.stoppedWhy.error, 0, ko.common.retry, async () => {
          await useApp.getState().app.session.sync();
        })
      );
  }
}
