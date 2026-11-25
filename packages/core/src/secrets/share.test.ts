import { describe, expect, it } from 'vitest';
import { detectKey } from './detect';
import { sealEnv } from './envage';
import { isShareIdentity, isShareRecipient, newShareIdentity, openEnvWith, recipientFingerprint, recipientOf, sealEnvFor } from './share';

const ENTRIES = [
  { name: 'DATABASE_URL', value: 'postgres://u:p@host/db' },
  { name: 'SESSION_SECRET', value: 'share-test-session-secret' },
];

describe('팀 공유: 받는 사람의 공개키로 잠근다', () => {
  it('열쇠 한 쌍: 개인키에서 공개키가 나오고, 모양으로 구분된다', async () => {
    const me = await newShareIdentity();
    expect(isShareIdentity(me.identity)).toBe(true);
    expect(isShareRecipient(me.recipient)).toBe(true);
    expect(isShareRecipient(me.identity)).toBe(false);
    expect(await recipientOf(me.identity)).toBe(me.recipient);
    expect(me.identity).toContain('AGE-SECRET-KEY-PQ-1'); // 양자내성 혼합형
  });

  it('받는 사람은 열고, 받는 사람이 아니면 못 연다', async () => {
    const [alice, bob, eve] = await Promise.all([newShareIdentity(), newShareIdentity(), newShareIdentity()]);
    const bytes = await sealEnvFor(ENTRIES, [alice.recipient, bob.recipient]);
    expect(new TextDecoder().decode(bytes.subarray(0, 21))).toBe('age-encryption.org/v1'); // 표준 age 파일
    expect(new TextDecoder().decode(bytes)).not.toContain('share-test-session-secret');
    expect(await openEnvWith(bytes, alice.identity)).toEqual(ENTRIES);
    expect(await openEnvWith(bytes, bob.identity)).toEqual(ENTRIES);
    await expect(openEnvWith(bytes, eve.identity)).rejects.toThrow();
  });

  it('비밀번호로 잠근 파일은 개인키로 열리지 않는다 (두 방식이 섞이지 않는다)', async () => {
    const me = await newShareIdentity();
    await expect(openEnvWith(await sealEnv(ENTRIES, 'pw', { scryptWorkFactor: 10 }), me.identity)).rejects.toThrow();
  });

  it('받는 사람이 없거나 공개키가 아니면 잠그지 않는다 (개인키를 잘못 붙여 넣는 사고를 막는다)', async () => {
    const me = await newShareIdentity();
    await expect(sealEnvFor(ENTRIES, [])).rejects.toThrow();
    await expect(sealEnvFor(ENTRIES, ['hello'])).rejects.toThrow();
    await expect(sealEnvFor(ENTRIES, [me.identity])).rejects.toThrow();
  });

  it('지문: 같은 공개키는 같은 지문, 다른 공개키는 다른 지문', async () => {
    const [a, b] = await Promise.all([newShareIdentity(), newShareIdentity()]);
    const fa = await recipientFingerprint(a.recipient);
    expect(fa).toMatch(/^[0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4}$/);
    expect(await recipientFingerprint(` ${a.recipient}\n`)).toBe(fa);
    expect(await recipientFingerprint(b.recipient)).not.toBe(fa);
  });

  it('키 알아보기: 공유 개인키는 비밀, 공개키는 공개 가능으로 표시한다', async () => {
    const me = await newShareIdentity();
    expect(detectKey(me.identity)).toMatchObject({ provider: 'age', kind: 'identity', exposure: 'secret' });
    expect(detectKey(me.recipient)).toMatchObject({ provider: 'age', kind: 'public key', exposure: 'public' });
  });
});
