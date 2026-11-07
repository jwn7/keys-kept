import { AuthError, type DriveAuth } from '@vault/core';

/**
 * Google Identity Services 토큰 클라이언트 (브라우저용).
 * PWA에는 client secret을 둘 수 없어 refresh token 대신 1시간짜리 access token을 조용히 재발급한다.
 * 토큰은 메모리에만 (SPEC §3.2). "연결됨" 플래그만 localStorage에 둔다 — 비밀이 아니다.
 */
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const CONNECTED_KEY = 'vault.drive.connected';
const EMAIL_KEY = 'vault.drive.email';

type TokenClient = { requestAccessToken(opts?: { prompt?: string }): void };
type TokenResponse = { access_token?: string; expires_in?: number; error?: string };
type Gis = {
  accounts: {
    oauth2: {
      initTokenClient(cfg: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: (e: unknown) => void }): TokenClient;
      revoke(token: string, done?: () => void): void;
    };
  };
};
declare global {
  interface Window {
    google?: Gis;
  }
}

export class GisDriveAuth implements DriveAuth {
  private token: { value: string; exp: number } | null = null;
  private client: TokenClient | null = null;
  private pending: ((r: TokenResponse) => void) | null = null;

  constructor(private readonly clientId: string) {}

  static isConnected(): boolean {
    try {
      return localStorage.getItem(CONNECTED_KEY) === '1';
    } catch {
      return false;
    }
  }
  static email(): string | null {
    try {
      return localStorage.getItem(EMAIL_KEY);
    } catch {
      return null;
    }
  }

  /** 사용자 제스처 안에서 호출. 동의 화면을 띄운다. */
  async connect(): Promise<void> {
    await this.request('consent');
    try {
      localStorage.setItem(CONNECTED_KEY, '1');
      const email = await this.fetchEmail();
      if (email) localStorage.setItem(EMAIL_KEY, email);
    } catch {
      /* 이메일은 표시용일 뿐 */
    }
  }

  disconnect(): void {
    if (this.token && window.google) window.google.accounts.oauth2.revoke(this.token.value);
    this.token = null;
    try {
      localStorage.removeItem(CONNECTED_KEY);
      localStorage.removeItem(EMAIL_KEY);
    } catch {
      /* ignore */
    }
  }

  async getAccessToken(): Promise<string> {
    if (this.token && this.token.exp - 60_000 > Date.now()) return this.token.value;
    await this.request('');
    if (!this.token) throw new AuthError();
    return this.token.value;
  }

  private async request(prompt: '' | 'consent'): Promise<void> {
    await loadGis();
    if (!window.google) throw new AuthError('gis unavailable');
    if (!this.client) {
      this.client = window.google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: SCOPE,
        callback: (r) => this.pending?.(r),
        error_callback: (e) => this.pending?.({ error: String((e as { type?: string })?.type ?? e) }),
      });
    }
    const r = await new Promise<TokenResponse>((resolve) => {
      this.pending = resolve;
      this.client?.requestAccessToken({ prompt });
    });
    this.pending = null;
    if (!r.access_token) throw new AuthError(r.error ?? 'no token');
    this.token = { value: r.access_token, exp: Date.now() + (r.expires_in ?? 3600) * 1000 };
  }

  private async fetchEmail(): Promise<string | null> {
    if (!this.token) return null;
    const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', {
      headers: { authorization: `Bearer ${this.token.value}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { user?: { emailAddress?: string } };
    return data.user?.emailAddress ?? null;
  }
}

let gisLoading: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (window.google) return Promise.resolve();
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new AuthError('failed to load google identity services'));
      document.head.appendChild(s);
    });
  }
  return gisLoading;
}
