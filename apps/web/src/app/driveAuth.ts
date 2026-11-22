import { AuthError, type DriveAuth } from '@vault/core';

/**
 * Google Identity Services 토큰 클라이언트 (브라우저용).
 * PWA에는 client secret을 둘 수 없어 refresh token 대신 1시간짜리 access token을 조용히 재발급한다.
 * 토큰은 탭 세션 저장소에만 (SPEC §3.2 "PC에선 메모리/세션"): 새로고침·잠금 해제 때 다시 묻지 않게.
 * 탭을 닫으면 사라진다. 메모 열쇠가 아니라 Drive 접근권(1시간)이다. "연결됨" 플래그와 이메일은 localStorage.
 *
 * 로그인 창은 사용자가 버튼을 누를 때만 연다(connect / reconnect). 백그라운드 동기화는 토큰이 없으면
 * AuthError를 던지고, 화면은 "Drive 다시 연결" 버튼을 보여준다.
 */
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const CONNECTED_KEY = 'vault.drive.connected';
const EMAIL_KEY = 'vault.drive.email';
const TOKEN_KEY = 'vault.drive.token';

type TokenClient = { requestAccessToken(opts?: { prompt?: string; login_hint?: string }): void };
type TokenResponse = { access_token?: string; expires_in?: number; error?: string };
type Gis = {
  accounts: {
    oauth2: {
      initTokenClient(cfg: { client_id: string; scope: string; login_hint?: string; callback: (r: TokenResponse) => void; error_callback?: (e: unknown) => void }): TokenClient;
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

  constructor(private readonly clientId: string) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(TOKEN_KEY) ?? 'null') as { value: string; exp: number } | null;
      if (saved && saved.exp > Date.now()) this.token = saved;
    } catch {
      /* 저장소가 막혀 있으면 메모리만 */
    }
  }

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
      sessionStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(CONNECTED_KEY);
      localStorage.removeItem(EMAIL_KEY);
    } catch {
      /* ignore */
    }
  }

  /** 동기화가 부른다. 로그인 창을 열지 않는다: 토큰이 없거나 끝났으면 AuthError → 화면이 다시 연결 버튼을 보여준다. */
  async getAccessToken(): Promise<string> {
    if (this.token && this.token.exp - 60_000 > Date.now()) return this.token.value;
    throw new AuthError('drive token expired');
  }

  /** 사용자 제스처 안에서 호출. 이미 허용한 계정이면 창이 잠깐 떴다가 바로 닫힌다. */
  async reconnect(): Promise<void> {
    await this.request('');
  }

  private async request(prompt: '' | 'consent'): Promise<void> {
    await loadGis();
    if (!window.google) throw new AuthError('gis unavailable');
    if (!this.client) {
      this.client = window.google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: SCOPE,
        // 연결했던 계정을 알려주면 계정 고르기 단계 없이 바로 진행된다
        ...(GisDriveAuth.email() ? { login_hint: GisDriveAuth.email() as string } : {}),
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
    try {
      sessionStorage.setItem(TOKEN_KEY, JSON.stringify(this.token));
    } catch {
      /* ignore */
    }
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
