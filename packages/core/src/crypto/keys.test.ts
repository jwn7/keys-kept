import { beforeAll, describe, expect, it } from 'vitest';
import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { ready, sodium } from './sodium';
import { newItemsKey, newRecoveryPhrase, recoveryKey, unwrap, wrap } from './keys';
import { DecryptError } from './errors';
import { fastKdfParams } from '../test/params';

beforeAll(ready);

describe('keys', () => {
  it('newItemsKey: 32B 랜덤, 매번 다름', () => {
    const a = newItemsKey();
    expect(a).toHaveLength(32);
    expect(a).not.toEqual(newItemsKey());
  });

  it('wrap/unwrap 라운드트립 (base64 문자열, nonce||ciphertext)', () => {
    const root = sodium.randombytes_buf(32);
    const items = newItemsKey();
    const wrapped = wrap(root, items);
    expect(typeof wrapped).toBe('string');
    expect(sodium.from_base64(wrapped, sodium.base64_variants.ORIGINAL)).toHaveLength(24 + 32 + 16);
    expect(unwrap(root, wrapped)).toEqual(items);
  });

  it('다른 root key로 unwrap → DecryptError', () => {
    const wrapped = wrap(sodium.randombytes_buf(32), newItemsKey());
    expect(() => unwrap(sodium.randombytes_buf(32), wrapped)).toThrow(DecryptError);
  });

  it('잘린 wrapped 문자열 → DecryptError', () => {
    const root = sodium.randombytes_buf(32);
    const wrapped = wrap(root, newItemsKey());
    expect(() => unwrap(root, wrapped.slice(0, 20))).toThrow(DecryptError);
  });

  it('newRecoveryPhrase: BIP39 영단어 12개, 체크섬 유효, 매번 다름', () => {
    const phrase = newRecoveryPhrase();
    expect(phrase).toHaveLength(12);
    for (const w of phrase) expect(wordlist).toContain(w);
    expect(validateMnemonic(phrase.join(' '), wordlist)).toBe(true);
    expect(phrase.join(' ')).not.toBe(newRecoveryPhrase().join(' '));
  });

  it('recoveryKey: 같은 phrase + params → 같은 32B 키', async () => {
    const phrase = newRecoveryPhrase();
    const p = fastKdfParams();
    const a = await recoveryKey(phrase, p);
    expect(a).toHaveLength(32);
    expect(await recoveryKey(phrase, p)).toEqual(a);
  });

  it('recoveryKey: 대소문자·앞뒤 공백 차이는 같은 키 (사용자가 손으로 적는 값)', async () => {
    const phrase = newRecoveryPhrase();
    const p = fastKdfParams();
    const messy = phrase.map((w, i) => (i % 2 ? ` ${w.toUpperCase()} ` : w));
    expect(await recoveryKey(messy, p)).toEqual(await recoveryKey(phrase, p));
  });

  it('recoveryKey: 단어가 틀리면(체크섬 불일치) throw — 복구 시도 전에 오타를 잡는다', async () => {
    const phrase = newRecoveryPhrase();
    phrase[0] = phrase[0] === 'abandon' ? 'ability' : 'abandon';
    // 12단어 중 하나를 바꾸면 2^-4 확률로만 체크섬이 우연히 맞는다. 맞으면 다른 단어로 재시도.
    if (validateMnemonic(phrase.join(' '), wordlist)) phrase[1] = 'zoo';
    await expect(recoveryKey(phrase, fastKdfParams())).rejects.toThrow();
  });

  it('recoveryKey로 감싼 itemsKey는 같은 문구로만 풀린다', async () => {
    const phrase = newRecoveryPhrase();
    const p = fastKdfParams();
    const items = newItemsKey();
    const wrapped = wrap(await recoveryKey(phrase, p), items);
    expect(unwrap(await recoveryKey(phrase, p), wrapped)).toEqual(items);
    const other = await recoveryKey(newRecoveryPhrase(), p);
    expect(() => unwrap(other, wrapped)).toThrow(DecryptError);
  });
});
