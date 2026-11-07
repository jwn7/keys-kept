import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SupabaseBackend, type SupabaseLike } from '@vault/core';

/**
 * Pro 모듈. @supabase/supabase-js는 여기서만 import한다 (CLAUDE.md 규칙 8).
 * 서버에는 암호문만 간다 — 이 파일은 로그인과 클라이언트 생성만 담당한다.
 */
export const SUPABASE_URL: string = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
export const SUPABASE_ANON_KEY: string = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';
const PRO_KEY = 'vault.pro';

export function proAvailable(): boolean {
  return SUPABASE_URL !== '' && SUPABASE_ANON_KEY !== '';
}
export function proEnabled(): boolean {
  try {
    return proAvailable() && localStorage.getItem(PRO_KEY) === '1';
  } catch {
    return false;
  }
}

let client: SupabaseClient | null = null;
export function supabaseClient(): SupabaseClient {
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, flowType: 'pkce' } });
  return client;
}

export function createSupabaseBackend(): SupabaseBackend {
  // supabase-js 빌더는 SupabaseLike보다 넓은 타입이라 좁혀서 넘긴다.
  return new SupabaseBackend(supabaseClient() as unknown as SupabaseLike);
}

/** Google 로그인(Supabase Auth). 리다이렉트로 돌아오면 세션이 저장돼 있다. */
export async function proSignIn(): Promise<void> {
  const { error } = await supabaseClient().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin, queryParams: { access_type: 'offline', prompt: 'consent' } },
  });
  if (error) throw error;
}

export async function proSessionEmail(): Promise<string | null> {
  const { data } = await supabaseClient().auth.getSession();
  return data.session?.user.email ?? null;
}

export function setProEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(PRO_KEY, '1');
    else localStorage.removeItem(PRO_KEY);
  } catch {
    /* ignore */
  }
}

export async function proSignOut(): Promise<void> {
  setProEnabled(false);
  await supabaseClient().auth.signOut();
}
