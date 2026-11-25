import { Decrypter, Encrypter } from 'age-encryption';
import { formatEnv, parseEnv, type EnvEntry } from './envfile';

/**
 * 암호화된 .env (docs/STRATEGY.md 계획 4).
 * 내용은 그냥 .env 글이고, 겉은 표준 age 패스프레이즈 파일이다. 자체 포맷이 아니므로 이 앱이 없어도 `age -d .env.age`로 풀린다 (규칙 7).
 * 평문 .env를 디스크에 두지 않으려는 것이다: 디스크의 .env는 악성 패키지가 가장 먼저 훑어 가는 파일이다.
 */
export async function sealEnv(entries: EnvEntry[], passphrase: string, opts: { scryptWorkFactor?: number } = {}): Promise<Uint8Array> {
  const e = new Encrypter();
  e.setPassphrase(passphrase);
  if (opts.scryptWorkFactor !== undefined) e.setScryptWorkFactor(opts.scryptWorkFactor);
  return e.encrypt(formatEnv(entries));
}

export class EnvPassphraseError extends Error {
  constructor() {
    super('wrong passphrase or not an age file');
    this.name = 'EnvPassphraseError';
  }
}

export async function openEnv(bytes: Uint8Array, passphrase: string): Promise<EnvEntry[]> {
  const d = new Decrypter();
  d.addPassphrase(passphrase);
  try {
    return parseEnv(await d.decrypt(bytes, 'text'));
  } catch {
    throw new EnvPassphraseError();
  }
}

export function envAgeFileName(env: string | null): string {
  return env ? `.env.${env}.age` : '.env.age';
}
