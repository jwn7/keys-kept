/**
 * 키 알아보기 (docs/STRATEGY.md 계획 1).
 * 붙여 넣은 값의 모양만 보고 "어느 서비스의 무슨 키인지, 공개돼도 되는지, 운영용인지"를 짐작한다.
 *
 * - 값을 어디로도 보내지 않는다. 정규식과 (JWT의 경우) 가운데 조각을 기기 안에서 읽는 것이 전부다.
 * - 짐작이지 보증이 아니다. 서비스가 모양을 바꿀 수 있다. 모르는 모양은 null (추측해서 틀린 안내를 하지 않는다).
 * - 각 서비스가 공개 문서에 적어 둔 접두어만 쓴다.
 */

/** secret: 서버에만 있어야 한다. public: 브라우저 코드에 넣어도 되게 만들어진 키. */
export type KeyExposure = 'secret' | 'public';
export type KeyMode = 'live' | 'test' | null;

export type KeyDetection = {
  provider: string;
  kind: string;
  exposure: KeyExposure;
  /** 운영용/시험용을 모양으로 알 수 있을 때만 */
  mode: KeyMode;
  /** 이 키를 다시 발급하는 페이지. 모르면 null */
  rotateUrl: string | null;
};

type Rule = { re: RegExp; provider: string; kind: string; exposure?: KeyExposure; mode?: KeyMode; rotateUrl?: string };

const URL = {
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  github: 'https://github.com/settings/tokens',
  aws: 'https://console.aws.amazon.com/iam/home#/security_credentials',
  stripe: 'https://dashboard.stripe.com/apikeys',
  google: 'https://console.cloud.google.com/apis/credentials',
  slack: 'https://api.slack.com/apps',
  supabase: 'https://supabase.com/dashboard/project/_/settings/api',
  npm: 'https://www.npmjs.com/settings/~/tokens',
  sendgrid: 'https://app.sendgrid.com/settings/api_keys',
  resend: 'https://resend.com/api-keys',
  huggingface: 'https://huggingface.co/settings/tokens',
};

// 더 구체적인 것이 먼저 온다 (예: sk-ant- 는 sk- 보다 앞).
const RULES: Rule[] = [
  { re: /^sk-ant-[\w-]{20,}$/, provider: 'Anthropic', kind: 'API key', rotateUrl: URL.anthropic },
  { re: /^sk-(?:proj-|svcacct-|admin-)?[\w-]{20,}$/, provider: 'OpenAI', kind: 'API key', rotateUrl: URL.openai },
  { re: /^ghp_[A-Za-z0-9]{36,}$/, provider: 'GitHub', kind: 'personal access token', rotateUrl: URL.github },
  { re: /^github_pat_\w{22,}$/, provider: 'GitHub', kind: 'fine-grained token', rotateUrl: URL.github },
  { re: /^gh[ousr]_[A-Za-z0-9]{36,}$/, provider: 'GitHub', kind: 'token', rotateUrl: URL.github },
  { re: /^(?:AKIA|ASIA)[A-Z0-9]{16}$/, provider: 'AWS', kind: 'access key id', rotateUrl: URL.aws },
  { re: /^sk_live_\w{16,}$/, provider: 'Stripe', kind: 'secret key', mode: 'live', rotateUrl: URL.stripe },
  { re: /^sk_test_\w{16,}$/, provider: 'Stripe', kind: 'secret key', mode: 'test', rotateUrl: URL.stripe },
  { re: /^rk_live_\w{16,}$/, provider: 'Stripe', kind: 'restricted key', mode: 'live', rotateUrl: URL.stripe },
  { re: /^rk_test_\w{16,}$/, provider: 'Stripe', kind: 'restricted key', mode: 'test', rotateUrl: URL.stripe },
  { re: /^pk_live_\w{16,}$/, provider: 'Stripe', kind: 'publishable key', exposure: 'public', mode: 'live', rotateUrl: URL.stripe },
  { re: /^pk_test_\w{16,}$/, provider: 'Stripe', kind: 'publishable key', exposure: 'public', mode: 'test', rotateUrl: URL.stripe },
  { re: /^whsec_\w{16,}$/, provider: 'Stripe', kind: 'webhook secret', rotateUrl: 'https://dashboard.stripe.com/webhooks' },
  { re: /^AIza[\w-]{35}$/, provider: 'Google', kind: 'API key', rotateUrl: URL.google },
  { re: /^xox[baprs]-[\w-]{10,}$/, provider: 'Slack', kind: 'token', rotateUrl: URL.slack },
  { re: /^sb_publishable_[\w-]{16,}$/, provider: 'Supabase', kind: 'publishable key', exposure: 'public', rotateUrl: URL.supabase },
  { re: /^sb_secret_[\w-]{16,}$/, provider: 'Supabase', kind: 'secret key', rotateUrl: URL.supabase },
  { re: /^npm_[A-Za-z0-9]{36,}$/, provider: 'npm', kind: 'access token', rotateUrl: URL.npm },
  { re: /^hf_[A-Za-z0-9]{30,}$/, provider: 'Hugging Face', kind: 'access token', rotateUrl: URL.huggingface },
  { re: /^re_\w{20,}$/, provider: 'Resend', kind: 'API key', rotateUrl: URL.resend },
  { re: /^SG\.[\w-]{16,}\.[\w-]{16,}$/, provider: 'SendGrid', kind: 'API key', rotateUrl: URL.sendgrid },
  { re: /^-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+-----END [A-Z ]*PRIVATE KEY-----$/, provider: 'Private key', kind: 'PEM' },
];

const JWT_RE = /^eyJ[\w-]+\.([\w-]+)\.[\w-]+$/;

/** JWT의 가운데 조각(내용)을 읽는다. 서명은 확인하지 않는다: 알고 싶은 것은 "무슨 키인가"뿐이다. */
function jwtPayload(value: string): Record<string, unknown> | null {
  const m = JWT_RE.exec(value);
  if (!m) return null;
  try {
    const b64 = m[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function detectKey(input: string): KeyDetection | null {
  const value = input.trim().replace(/^(["'])([\s\S]*)\1$/, '$2').trim();
  if (!value) return null;

  for (const r of RULES) {
    if (r.re.test(value)) return { provider: r.provider, kind: r.kind, exposure: r.exposure ?? 'secret', mode: r.mode ?? null, rotateUrl: r.rotateUrl ?? null };
  }

  const payload = jwtPayload(value);
  if (payload) {
    // Supabase는 anon 키와 service_role 키가 같은 모양이고 role만 다르다. 헷갈려 공개하기 가장 쉬운 키다.
    if (payload.iss === 'supabase' && (payload.role === 'anon' || payload.role === 'service_role')) {
      const anon = payload.role === 'anon';
      return { provider: 'Supabase', kind: anon ? 'anon key' : 'service_role key', exposure: anon ? 'public' : 'secret', mode: null, rotateUrl: URL.supabase };
    }
    return { provider: 'JWT', kind: 'token', exposure: 'secret', mode: null, rotateUrl: null };
  }
  return null;
}

/** 빌드 도구가 브라우저 코드에 그대로 넣는 환경변수 이름의 접두어. */
const PUBLIC_PREFIXES = ['NEXT_PUBLIC_', 'VITE_', 'PUBLIC_', 'EXPO_PUBLIC_', 'REACT_APP_', 'NUXT_PUBLIC_', 'GATSBY_'];

export function isPublicEnvName(name: string): boolean {
  const n = name.trim().toUpperCase();
  return PUBLIC_PREFIXES.some((p) => n.startsWith(p));
}

/**
 * 브라우저로 나가는 이름에 비밀 키를 넣으려 하는가.
 * 값이 무엇인지 모를 때는 경고하지 않는다 (틀린 경고가 잦으면 진짜 경고를 안 보게 된다).
 */
export function publicNameWarning(name: string, value: string): boolean {
  return isPublicEnvName(name) && detectKey(value)?.exposure === 'secret';
}
