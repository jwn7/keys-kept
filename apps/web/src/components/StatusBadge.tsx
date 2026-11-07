import { useEffect, useState } from 'react';
import type { SyncStatus } from '@vault/core';
import { ko } from '../i18n/ko';
import { relTime } from '../app/util';

/** 상태는 항상 색 + 형태(점) + 텍스트 (DESIGN.md). */
export function StatusBadge({ status, local }: { status: SyncStatus; local: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  if (local) return <span className="badge muted">{ko.sync.localOnly}</span>;
  switch (status.state) {
    case 'synced':
      return <span className="badge ok">{`${ko.sync.drivePrefix} ${ko.sync.synced(status.at ? relTime(status.at) : ko.time.justNow)}`}</span>;
    case 'syncing':
      return <span className="badge ok busy">{ko.sync.syncing}</span>;
    case 'offline':
      return <span className="badge warn">{ko.sync.offline(status.pending)}</span>;
    case 'conflict':
      return <span className="badge danger">{ko.sync.conflicts(status.count)}</span>;
    case 'error':
      return <span className="badge danger" title={status.message}>{ko.sync.error}</span>;
  }
}
