import { describe, expect, it } from 'vitest';
import { detectKey, isPublicEnvName, publicNameWarning } from './detect';
import { formatEnv, parseEnv } from './envfile';

// 진짜처럼 보이는 키가 저장소에 그대로 있으면 비밀 검사기가 막는다. 그래서 조각을 이어 붙여 만든다. 전부 가짜 값이다.
const fill = (n: number, ch = 'a') => ch.repeat(n);
const k = (...parts: string[]) => parts.join('');
const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (payload: unknown) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.${fill(43, 's')}`;

describe('detectKey: 값의 모양으로 어느 서비스의 무슨 키인지 알아본다', () => {
  it('자주 쓰는 서비스의 비밀 키', () => {
    expect(detectKey(k('sk-', 'proj-', fill(48)))).toMatchObject({ provider: 'OpenAI', exposure: 'secret' });
    expect(detectKey(k('sk-', 'ant-', 'api03-', fill(90)))).toMatchObject({ provider: 'Anthropic', exposure: 'secret' });
    expect(detectKey(k('gh', 'p_', fill(36)))).toMatchObject({ provider: 'GitHub', kind: 'personal access token' });
    expect(detectKey(k('github', '_pat_', fill(82)))).toMatchObject({ provider: 'GitHub' });
    expect(detectKey(k('AK', 'IA', fill(16, 'A')))).toMatchObject({ provider: 'AWS', kind: 'access key id' });
    expect(detectKey(k('AI', 'za', fill(35)))).toMatchObject({ provider: 'Google', kind: 'API key' });
    expect(detectKey(k('xo', 'xb-', '1234567890-', fill(24)))).toMatchObject({ provider: 'Slack' });
    expect(detectKey(k('np', 'm_', fill(36)))).toMatchObject({ provider: 'npm' });
    expect(detectKey(k('h', 'f_', fill(34)))).toMatchObject({ provider: 'Hugging Face' });
    expect(detectKey(k('r', 'e_', fill(32)))).toMatchObject({ provider: 'Resend' });
    expect(detectKey(k('S', 'G.', fill(22), '.', fill(43)))).toMatchObject({ provider: 'SendGrid' });
  });

  it('Stripe: 운영용과 시험용, 비밀 키와 공개해도 되는 키를 구분한다', () => {
    expect(detectKey(k('sk', '_live_', fill(24)))).toMatchObject({ provider: 'Stripe', exposure: 'secret', mode: 'live' });
    expect(detectKey(k('sk', '_test_', fill(24)))).toMatchObject({ provider: 'Stripe', exposure: 'secret', mode: 'test' });
    expect(detectKey(k('pk', '_live_', fill(24)))).toMatchObject({ provider: 'Stripe', exposure: 'public', mode: 'live' });
    expect(detectKey(k('rk', '_live_', fill(24)))).toMatchObject({ provider: 'Stripe', kind: 'restricted key', exposure: 'secret' });
  });

  it('Supabase: 같은 모양의 JWT라도 role을 읽어 anon(공개 가능)과 service_role(절대 공개 금지)을 가른다', () => {
    expect(detectKey(jwt({ iss: 'supabase', role: 'anon', ref: 'abc' }))).toMatchObject({ provider: 'Supabase', kind: 'anon key', exposure: 'public' });
    expect(detectKey(jwt({ iss: 'supabase', role: 'service_role', ref: 'abc' }))).toMatchObject({ provider: 'Supabase', kind: 'service_role key', exposure: 'secret' });
    expect(detectKey(k('sb', '_publishable_', fill(24)))).toMatchObject({ provider: 'Supabase', exposure: 'public' });
    expect(detectKey(k('sb', '_secret_', fill(24)))).toMatchObject({ provider: 'Supabase', exposure: 'secret' });
    expect(detectKey(jwt({ sub: '123', name: 'x' }))).toMatchObject({ provider: 'JWT', exposure: 'secret' });
  });

  it('개인 키 파일(PEM)', () => {
    expect(detectKey(k('-----BEGIN ', 'OPENSSH PRIVATE KEY-----\n', fill(40), '\n-----END OPENSSH PRIVATE KEY-----'))).toMatchObject({ provider: 'Private key', exposure: 'secret' });
  });

  it('재발급 페이지 주소를 같이 준다', () => {
    expect(detectKey(k('gh', 'p_', fill(36)))?.rotateUrl).toBe('https://github.com/settings/tokens');
    expect(detectKey(k('sk', '_live_', fill(24)))?.rotateUrl).toBe('https://dashboard.stripe.com/apikeys');
  });

  it('모르는 모양은 모른다고 한다 (추측하지 않는다)', () => {
    for (const v of ['', 'hello', 'password123', 'sk-', 'pk_live_', 'AKIA1', 'https://example.com', '12345678']) expect(detectKey(v)).toBeNull();
  });

  it('앞뒤 공백과 따옴표는 무시한다', () => {
    expect(detectKey(`  "${k('gh', 'p_', fill(36))}"  `)).toMatchObject({ provider: 'GitHub' });
  });
});

describe('공개되는 이름에 비밀 키 (바이브코더가 가장 자주 내는 사고)', () => {
  it('브라우저로 나가는 환경변수 이름을 안다', () => {
    for (const n of ['NEXT_PUBLIC_API_KEY', 'VITE_SUPABASE_KEY', 'PUBLIC_TOKEN', 'EXPO_PUBLIC_KEY', 'REACT_APP_KEY', 'NUXT_PUBLIC_KEY', 'GATSBY_KEY']) expect(isPublicEnvName(n)).toBe(true);
    for (const n of ['OPENAI_API_KEY', 'DATABASE_URL', 'MY_PUBLIC_KEY', 'VITEST_KEY']) expect(isPublicEnvName(n)).toBe(false);
  });

  it('공개 이름 + 비밀 키일 때만 경고한다', () => {
    expect(publicNameWarning('NEXT_PUBLIC_OPENAI_KEY', k('sk-', 'proj-', fill(48)))).toBe(true);
    expect(publicNameWarning('VITE_SUPABASE_KEY', jwt({ iss: 'supabase', role: 'service_role' }))).toBe(true);
    expect(publicNameWarning('VITE_SUPABASE_ANON_KEY', jwt({ iss: 'supabase', role: 'anon' }))).toBe(false); // 공개해도 되는 키
    expect(publicNameWarning('NEXT_PUBLIC_STRIPE_KEY', k('pk', '_live_', fill(24)))).toBe(false);
    expect(publicNameWarning('OPENAI_API_KEY', k('sk-', 'proj-', fill(48)))).toBe(false); // 서버에만 있는 이름
    expect(publicNameWarning('NEXT_PUBLIC_SITE_NAME', 'My App')).toBe(false); // 모르는 값은 경고하지 않는다
  });
});

describe('.env 읽기와 쓰기', () => {
  it('주석, 빈 줄, export, 따옴표, 줄 끝 주석을 처리한다', () => {
    const text = ['# 데이터베이스', 'DATABASE_URL=postgres://u:p@host/db', '', 'export API_KEY="abc def"', "NAME='한 글'", 'EMPTY=', 'WITH_COMMENT=value # 설명', 'HASH="a#b"', 'not a line', '  SPACED = x  '].join('\n');
    expect(parseEnv(text)).toEqual([
      { name: 'DATABASE_URL', value: 'postgres://u:p@host/db' },
      { name: 'API_KEY', value: 'abc def' },
      { name: 'NAME', value: '한 글' },
      { name: 'EMPTY', value: '' },
      { name: 'WITH_COMMENT', value: 'value' },
      { name: 'HASH', value: 'a#b' },
      { name: 'SPACED', value: 'x' },
    ]);
  });

  it('큰따옴표 안의 \\n은 줄바꿈으로 읽는다 (개인 키를 한 줄로 넣는 흔한 방식)', () => {
    expect(parseEnv('KEY="line1\\nline2"')).toEqual([{ name: 'KEY', value: 'line1\nline2' }]);
  });

  it('쓴 것을 다시 읽으면 같다', () => {
    const entries = [
      { name: 'A', value: 'plain' },
      { name: 'B', value: 'has space' },
      { name: 'C', value: 'a#b' },
      { name: 'D', value: 'line1\nline2' },
      { name: 'E', value: '' },
      { name: 'F', value: 'quote"inside' },
    ];
    expect(parseEnv(formatEnv(entries))).toEqual(entries);
    expect(formatEnv([{ name: 'A', value: 'plain' }])).toBe('A=plain\n');
  });
});
