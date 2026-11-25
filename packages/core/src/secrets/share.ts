import { Decrypter, Encrypter, generateHybridIdentity, identityToRecipient } from 'age-encryption';
import { formatEnv, parseEnv, type EnvEntry } from './envfile';
import { EnvPassphraseError } from './envage';

/**
 * 팀 공유 1판: 파일로 주고받기 (docs/TEAM.md, docs/STRATEGY.md 계획 12).
 *
 * 비밀번호를 같이 쓰지 않는다. 사람마다 공유 열쇠 한 쌍이 있다:
 *   - 공개키(`age1…`): 남에게 알려 줘도 된다. 이것으로 "그 사람만 풀 수 있게" 잠근다.
 *   - 개인키(`AGE-SECRET-KEY-…`): 내 금고 안에만 둔다. 이것으로 나에게 온 파일을 푼다.
 * 프로젝트의 값을 받는 사람들의 공개키로 잠근 표준 age 파일을 만든다. 서버가 없고, 파일이 어디를 거치든 받는 사람만 연다.
 *
 * 암호는 직접 만들지 않았다. age 포맷과 `age-encryption` 라이브러리의 수신자 모드다(규칙 7의 연장).
 * 열쇠는 양자내성 혼합형(ML-KEM + X25519)으로 만든다: 지금 훔친 파일을 나중에 양자컴퓨터로 푸는 공격을 피하려는 것이다.
 */
export type ShareIdentity = { identity: string; recipient: string };

export async function newShareIdentity(): Promise<ShareIdentity> {
  const identity = await generateHybridIdentity();
  return { identity, recipient: await identityToRecipient(identity) };
}

export function recipientOf(identity: string): Promise<string> {
  return identityToRecipient(identity.trim());
}

/** age 공개키처럼 생겼는가 (형식만 본다. 누구의 것인지는 알 수 없다). */
export function isShareRecipient(s: string): boolean {
  return /^age1[a-z0-9]{20,}$/.test(s.trim());
}
export function isShareIdentity(s: string): boolean {
  return /^AGE-SECRET-KEY-(?:PQ-)?1[A-Z0-9]{20,}$/.test(s.trim());
}

/**
 * 공개키를 사람이 비교하기 쉬운 짧은 지문으로. 전화나 화면으로 "앞 여덟 자리가 맞나"를 확인하는 용도다.
 * 공개키를 메신저로 받았다면, 중간에서 바꿔치기되지 않았는지 다른 경로로 지문을 맞춰 봐야 한다.
 */
export async function recipientFingerprint(recipient: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(recipient.trim())));
  const hex = [...hash.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex.replace(/(.{4})/g, '$1 ').trim();
}

/** 받는 사람들의 공개키로 잠근다. 보내는 사람 자신도 열 수 있으려면 자기 공개키를 목록에 넣는다. */
export async function sealEnvFor(entries: EnvEntry[], recipients: string[]): Promise<Uint8Array> {
  const list = [...new Set(recipients.map((r) => r.trim()).filter(Boolean))];
  if (list.length === 0) throw new Error('no recipients');
  for (const r of list) if (!isShareRecipient(r)) throw new Error(`not an age recipient: ${r.slice(0, 12)}…`);
  const e = new Encrypter();
  for (const r of list) e.addRecipient(r);
  return e.encrypt(formatEnv(entries));
}

/** 내 개인키로 연다. 나에게 보낸 파일이 아니면 던진다. */
export async function openEnvWith(bytes: Uint8Array, identity: string): Promise<EnvEntry[]> {
  const d = new Decrypter();
  d.addIdentity(identity.trim());
  try {
    return parseEnv(await d.decrypt(bytes, 'text'));
  } catch {
    throw new EnvPassphraseError();
  }
}
