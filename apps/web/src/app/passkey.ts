/**
 * 패스키(지문·Windows Hello)로 잠금 해제 — WebAuthn PRF 확장.
 *
 * 인증기는 (패스키, salt)마다 항상 같은 32바이트 비밀값을 돌려준다. 그 값은 여기서 받아
 * VaultSession.enableDeviceUnlock / unlockWithDeviceSecret에 넘기고 바로 버린다. 저장하지 않는다.
 * 서버가 없으므로 challenge는 검증에 쓰지 않는다(로그인이 아니라 비밀값을 얻는 용도).
 */
export class PasskeyUnsupportedError extends Error {
  constructor() {
    super('passkey prf unsupported');
    this.name = 'PasskeyUnsupportedError';
  }
}

type PrfResults = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };
type Caps = Record<string, boolean | undefined>;

const toB64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer)));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toB64Url = (b: ArrayBuffer) => toB64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64Url = (s: string) => fromB64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

/** 이 브라우저·기기에서 쓸 수 있는지. 모르면 일단 true (실제 등록에서 가려진다). */
export async function passkeySupported(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential || !navigator.credentials) return false;
  const pkc = window.PublicKeyCredential as typeof PublicKeyCredential & { getClientCapabilities?: () => Promise<Caps> };
  try {
    const caps = await pkc.getClientCapabilities?.();
    if (caps && caps['extension:prf'] === false) return false;
    return await pkc.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

function prfExt(salt: Uint8Array): AuthenticationExtensionsClientInputs {
  return { prf: { eval: { first: salt } } } as unknown as AuthenticationExtensionsClientInputs;
}

/** 새 패스키를 만들고 비밀값을 얻는다. 사용자 제스처(버튼 클릭) 안에서 부른다. */
export async function createPasskey(label: string): Promise<{ credentialId: string; prfSalt: string; secret: Uint8Array }> {
  const salt = random(32);
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Vault' },
      user: { id: random(16), name: label, displayName: label },
      challenge: random(32),
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      extensions: prfExt(salt),
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new PasskeyUnsupportedError();
  const ext = cred.getClientExtensionResults() as PrfResults;
  if (!ext.prf?.enabled && !ext.prf?.results?.first) throw new PasskeyUnsupportedError();
  const credentialId = toB64Url(cred.rawId);
  const prfSalt = toB64(salt);
  // 만들 때 값을 같이 주는 인증기도 있고, 한 번 더 인증해야 주는 인증기도 있다.
  const first = ext.prf?.results?.first;
  const secret = first ? new Uint8Array(first) : await evaluatePasskey(credentialId, prfSalt);
  return { credentialId, prfSalt, secret };
}

/** 등록해 둔 패스키로 비밀값을 다시 얻는다 (지문·PIN 확인이 뜬다). */
export async function evaluatePasskey(credentialId: string, prfSalt: string): Promise<Uint8Array> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: random(32),
      allowCredentials: [{ type: 'public-key', id: fromB64Url(credentialId) }],
      userVerification: 'required',
      extensions: prfExt(fromB64(prfSalt)),
    },
  })) as PublicKeyCredential | null;
  const first = (cred?.getClientExtensionResults() as PrfResults | undefined)?.prf?.results?.first;
  if (!first) throw new PasskeyUnsupportedError();
  return new Uint8Array(first);
}
