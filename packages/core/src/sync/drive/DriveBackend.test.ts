import { beforeEach, describe, expect, it } from 'vitest';
import { DriveBackend } from './DriveBackend';
import { ConflictError, OfflineError } from '../SyncBackend';
import { AuthError } from './DriveBackend';
import type { EncryptedItem, ItemsKeyRecord } from '../../model/types';

/** Google Drive v3의 아주 작은 가짜. 우리가 쓰는 엔드포인트만 흉내 낸다. */
class FakeDrive {
  files = new Map<string, { id: string; name: string; mimeType: string; parents: string[]; modifiedTime: string; content: string; trashed: boolean }>();
  seq = 0;
  clock = Date.UTC(2026, 0, 10); // 서버 시계. 테스트 항목의 updatedAt(2026-01-01~03)보다 뒤
  offline = false;
  unauthorized = false;
  calls: string[] = [];

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    this.calls.push(`${method} ${url.pathname}${url.search}`);
    if (this.offline) throw new TypeError('Failed to fetch');
    if (this.unauthorized) return json({ error: { code: 401 } }, 401);
    const now = () => new Date((this.clock += 1000)).toISOString();

    // files.list
    if (method === 'GET' && url.pathname === '/drive/v3/files') {
      const q = url.searchParams.get('q') ?? '';
      let rows = [...this.files.values()].filter((f) => !f.trashed);
      const name = /name\s*=\s*'([^']+)'/.exec(q)?.[1];
      if (name) rows = rows.filter((f) => f.name === name);
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      if (parent) rows = rows.filter((f) => f.parents.includes(parent));
      const mime = /mimeType\s*=\s*'([^']+)'/.exec(q)?.[1];
      if (mime) rows = rows.filter((f) => f.mimeType === mime);
      const mt = /modifiedTime\s*>\s*'([^']+)'/.exec(q)?.[1];
      if (mt) rows = rows.filter((f) => f.modifiedTime > mt);
      return json({ files: rows.map(({ id, name, mimeType, modifiedTime }) => ({ id, name, mimeType, modifiedTime })) });
    }
    // files.get media
    const getMedia = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
    if (method === 'GET' && getMedia && url.searchParams.get('alt') === 'media') {
      const f = this.files.get(getMedia[1]!);
      return f ? new Response(f.content, { status: 200 }) : json({ error: { code: 404 } }, 404);
    }
    // files.create (metadata only: folders)
    if (method === 'POST' && url.pathname === '/drive/v3/files') {
      const meta = JSON.parse(String(init?.body)) as { name: string; mimeType: string; parents?: string[] };
      const id = `f${++this.seq}`;
      this.files.set(id, { id, ...meta, parents: meta.parents ?? [], modifiedTime: now(), content: '', trashed: false });
      return json({ id, name: meta.name });
    }
    // multipart create / update
    if (url.pathname === '/upload/drive/v3/files' || url.pathname.startsWith('/upload/drive/v3/files/')) {
      const { meta, content } = parseMultipart(String(init?.body), init?.headers);
      if (method === 'POST') {
        const id = `f${++this.seq}`;
        this.files.set(id, { id, name: meta.name!, mimeType: meta.mimeType ?? 'application/json', parents: meta.parents ?? [], modifiedTime: now(), content, trashed: false });
        return json({ id });
      }
      if (method === 'PATCH') {
        const id = url.pathname.split('/').pop()!;
        const f = this.files.get(id);
        if (!f) return json({ error: { code: 404 } }, 404);
        f.content = content;
        f.modifiedTime = now();
        return json({ id });
      }
    }
    // files.delete
    const del = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
    if (method === 'DELETE' && del) {
      const id = del[1]!;
      const victims = [id, ...[...this.files.values()].filter((f) => f.parents.includes(id)).map((f) => f.id)];
      for (const v of victims) {
        for (const g of this.files.values()) if (g.parents.includes(v)) this.files.delete(g.id);
        this.files.delete(v);
      }
      return new Response(null, { status: 204 });
    }
    return json({ error: { code: 400, message: `unhandled ${method} ${url.pathname}` } }, 400);
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function parseMultipart(body: string, headers: HeadersInit | undefined): { meta: { name?: string; mimeType?: string; parents?: string[] }; content: string } {
  const ct = new Headers(headers).get('content-type') ?? '';
  const boundary = /boundary=(.+)$/.exec(ct)?.[1];
  if (!boundary) throw new Error('no boundary');
  const parts = body.split(`--${boundary}`).filter((p) => p.trim() && p.trim() !== '--');
  const strip = (p: string) => p.replace(/^\r?\n/, '').split(/\r?\n\r?\n/).slice(1).join('\n\n').replace(/\r?\n$/, '');
  return { meta: JSON.parse(strip(parts[0]!)), content: strip(parts[1]!) };
}

const blob = (id: string, version: number, updatedAt: string): EncryptedItem => ({
  id, type: 'note', itemsKeyId: 'k', nonce: 'A', ciphertext: 'B',
  aad: { v: 1, id, type: 'note' }, version, updatedAt, deletedAt: null, deviceId: 'd',
});
const keyRecord: ItemsKeyRecord = {
  id: 'k', wrappedKey: 'w', wrappedKeyRecovery: 'r',
  kdf: { alg: 'argon2id', salt: 's', opslimit: 3, memlimit: 1 },
  kdfRecovery: { alg: 'argon2id', salt: 's', opslimit: 3, memlimit: 1 },
  protocol: 1, createdAt: 'now',
};

describe('DriveBackend', () => {
  let drive: FakeDrive;
  let backend: DriveBackend;
  beforeEach(() => {
    drive = new FakeDrive();
    backend = new DriveBackend({ auth: { getAccessToken: async () => 'tok' }, fetch: drive.fetch });
  });

  it('ping: Vault 폴더와 notes 폴더를 만들고, 두 번째 ping은 재사용', async () => {
    await backend.ping();
    const names = [...drive.files.values()].map((f) => `${f.mimeType}:${f.name}`).sort();
    expect(names).toEqual(['application/vnd.google-apps.folder:Vault', 'application/vnd.google-apps.folder:notes']);
    const n = drive.calls.length;
    await backend.ping();
    expect(drive.calls.length).toBe(n); // 캐시된 폴더 id
  });

  it('putKeys/getKeys: vault.json 왕복, 없으면 []', async () => {
    expect(await backend.getKeys()).toEqual([]);
    await backend.putKeys([keyRecord]);
    expect(await backend.getKeys()).toEqual([keyRecord]);
    const file = [...drive.files.values()].find((f) => f.name === 'vault.json');
    expect(file).toBeDefined();
    expect(JSON.parse(file!.content)).toMatchObject({ protocol: 1, itemsKeys: [keyRecord] });
    await backend.putKeys([{ ...keyRecord, wrappedKey: 'w2' }]);
    expect((await backend.getKeys())[0]?.wrappedKey).toBe('w2');
    expect([...drive.files.values()].filter((f) => f.name === 'vault.json')).toHaveLength(1);
  });

  it('put/get/list: notes/<id>.enc 파일 하나 = 항목 하나, 평문 필드 없음', async () => {
    await backend.put(blob('a', 1, '2026-01-01T00:00:00.000Z'));
    await backend.put(blob('b', 1, '2026-01-02T00:00:00.000Z'));
    const files = [...drive.files.values()].filter((f) => f.name.endsWith('.enc'));
    expect(files.map((f) => f.name).sort()).toEqual(['a.enc', 'b.enc']);
    expect(await backend.get('a')).toEqual(blob('a', 1, '2026-01-01T00:00:00.000Z'));
    expect(await backend.get('zzz')).toBeNull();
    expect((await backend.list(null)).map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('put 같은 id는 같은 파일을 갱신 (중복 파일 없음)', async () => {
    await backend.put(blob('a', 1, '2026-01-01T00:00:00.000Z'));
    await backend.put(blob('a', 2, '2026-01-03T00:00:00.000Z'));
    expect([...drive.files.values()].filter((f) => f.name === 'a.enc')).toHaveLength(1);
    expect((await backend.get('a'))?.version).toBe(2);
  });

  it('put: 원격 version이 더 높으면 ConflictError + remote', async () => {
    await backend.put(blob('a', 3, '2026-01-01T00:00:00.000Z'));
    const other = new DriveBackend({ auth: { getAccessToken: async () => 'tok' }, fetch: drive.fetch });
    const err = await other.put(blob('a', 2, '2026-01-05T00:00:00.000Z')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).remote.version).toBe(3);
  });

  it('list(since): modifiedTime 질의 + updatedAt > since 필터', async () => {
    await backend.put(blob('a', 1, '2026-01-01T00:00:00.000Z'));
    await backend.put(blob('b', 1, '2026-01-02T00:00:00.000Z'));
    await backend.put(blob('c', 1, '2026-01-03T00:00:00.000Z'));
    const r = await backend.list('2026-01-02T00:00:00.000Z');
    expect(r.map((i) => i.id)).toEqual(['c']);
    expect(drive.calls.some((c) => c.includes('modifiedTime'))).toBe(true);
  });

  it('delete: tombstone으로 덮어쓴다 (파일 삭제 아님)', async () => {
    await backend.put(blob('a', 1, '2026-01-01T00:00:00.000Z'));
    await backend.delete('a', '2026-01-09T00:00:00.000Z');
    const r = await backend.get('a');
    expect(r?.deletedAt).toBe('2026-01-09T00:00:00.000Z');
    expect(r?.version).toBe(2);
    expect([...drive.files.values()].some((f) => f.name === 'a.enc')).toBe(true);
  });

  it('네트워크 실패 → OfflineError, 401 → AuthError', async () => {
    drive.offline = true;
    await expect(backend.list(null)).rejects.toThrow(OfflineError);
    drive.offline = false;
    drive.unauthorized = true;
    await expect(backend.list(null)).rejects.toThrow(AuthError);
  });

  it('purgeAll: Vault 폴더째 삭제', async () => {
    await backend.put(blob('a', 1, '2026-01-01T00:00:00.000Z'));
    await backend.putKeys([keyRecord]);
    await backend.purgeAll();
    expect(drive.files.size).toBe(0);
    // 다시 쓰면 폴더를 새로 만든다
    await backend.put(blob('b', 1, '2026-01-01T00:00:00.000Z'));
    expect([...drive.files.values()].some((f) => f.name === 'Vault')).toBe(true);
  });
});
