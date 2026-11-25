import { DriveBackend, FolderBackend, LocalStore, MemoryBackend, SyncScheduler, VaultSession, type SyncBackend } from '@vault/core';
import { browserFolderFs, folderSyncEnabled } from './folderSync';
import { GisDriveAuth } from './driveAuth';
import { ko } from '../i18n/ko';
import { createSupabaseBackend, proEnabled } from '../pro/supabase';

/**
 * 앱 전체가 잡는 단 하나의 핸들. 백엔드 선택(Supabase Pro / Drive / 로컬 전용)은 여기서만 안다.
 * UI는 session과 scheduler만 쓰고 어느 백엔드인지 모른다 (규칙 4).
 */
export type AppSession = {
  session: VaultSession;
  scheduler: SyncScheduler;
  driveAuth: GisDriveAuth | null;
  backendKind: SyncBackend['kind'];
  deviceId: string;
  deviceName: string;
};

const DEVICE_ID_KEY = 'vault.deviceId';
const DEVICE_NAME_KEY = 'vault.deviceName';

export const GOOGLE_CLIENT_ID: string = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '';

function deviceIdentity(): { deviceId: string; deviceName: string } {
  let id = '';
  let name = '';
  try {
    id = localStorage.getItem(DEVICE_ID_KEY) ?? '';
    name = localStorage.getItem(DEVICE_NAME_KEY) ?? '';
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    if (!name) {
      name = guessDeviceName();
      localStorage.setItem(DEVICE_NAME_KEY, name);
    }
  } catch {
    id = id || crypto.randomUUID();
    name = name || guessDeviceName();
  }
  return { deviceId: id, deviceName: name };
}

export function guessDeviceName(): string {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'PC';
  return /Android|iPhone|iPad/i.test(ua) ? ko.device.phone(os) : ko.device.pc(os);
}

export function setDeviceName(name: string): void {
  try {
    localStorage.setItem(DEVICE_NAME_KEY, name);
  } catch {
    /* ignore */
  }
}

export function isMobileProfile(): boolean {
  return /Android|iPhone|iPad/i.test(navigator.userAgent);
}

export function createAppSession(): AppSession {
  const { deviceId, deviceName } = deviceIdentity();
  const store = new LocalStore('vault');
  const useDrive = GOOGLE_CLIENT_ID !== '' && GisDriveAuth.isConnected();
  const driveAuth = GOOGLE_CLIENT_ID ? new GisDriveAuth(GOOGLE_CLIENT_ID) : null;
  const backend: SyncBackend = proEnabled()
    ? createSupabaseBackend()
    : folderSyncEnabled() // 사용자가 고른 폴더 (다른 동기화 도구와 같이 쓴다)
      ? new FolderBackend({ fs: browserFolderFs() })
    : useDrive && driveAuth
      ? new DriveBackend({ auth: driveAuth })
      : new MemoryBackend();
  const session = new VaultSession({
    store,
    backend,
    deviceId,
    deviceName,
    kdfProfile: isMobileProfile() ? 'mobile' : 'desktop',
    isOnline: () => navigator.onLine,
    versionWindowMs: 5 * 60_000,
  });
  const scheduler = new SyncScheduler({
    run: () => session.sync(),
    intervalMs: 30_000,
    target: window,
    isOnline: () => navigator.onLine && !session.isLocked,
  });
  return { session, scheduler, driveAuth, backendKind: backend.kind, deviceId, deviceName };
}
