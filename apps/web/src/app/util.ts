import { ko } from '../i18n/ko';
import type { Note } from '@vault/core';

export function relTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  const diff = now - t;
  if (diff < 60_000) return ko.time.justNow;
  if (diff < 3_600_000) return ko.time.minutesAgo(Math.floor(diff / 60_000));
  if (diff < 86_400_000 && new Date(t).getDate() === new Date(now).getDate()) return ko.time.hoursAgo(Math.floor(diff / 3_600_000));
  if (diff < 2 * 86_400_000) return ko.time.yesterday;
  const d = new Date(t);
  return ko.time.date(d.getMonth() + 1, d.getDate());
}

export function todayTitle(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function snippet(body: string, max = 80): string {
  return body.replace(/^#+\s.*$/m, '').replace(/[#*`>\[\]_-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function displayTitle(n: Pick<Note, 'title'>): string {
  return n.title.trim() || ko.main.untitled;
}

/** [[제목]] 링크 추출 */
export function wikiLinks(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) out.add((m[1] ?? '').trim());
  out.delete('');
  return [...out];
}

/** 백링크 인덱스: 제목 → 그 제목을 링크하는 메모 id[] (기기에서 계산, SPEC §2.2) */
export function backlinkIndex(notes: Note[]): Map<string, Note[]> {
  const byTitle = new Map<string, Note>();
  for (const n of notes) if (n.title.trim()) byTitle.set(n.title.trim(), n);
  const idx = new Map<string, Note[]>();
  for (const n of notes) {
    for (const t of wikiLinks(n.body)) {
      const target = byTitle.get(t);
      if (!target || target.id === n.id) continue;
      const arr = idx.get(target.id) ?? [];
      if (!arr.some((x) => x.id === n.id)) arr.push(n);
      idx.set(target.id, arr);
    }
  }
  return idx;
}

export function downloadBytes(name: string, bytes: Uint8Array, type = 'application/octet-stream'): void {
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 모바일: OS 공유 시트가 있으면 그걸로, 없으면 다운로드 */
export async function shareOrDownload(name: string, bytes: Uint8Array, type = 'application/octet-stream'): Promise<void> {
  const file = new File([bytes as BlobPart], name, { type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name });
      return;
    } catch {
      /* 취소 → 다운로드로 */
    }
  }
  downloadBytes(name, bytes, type);
}

export function pickFile(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(input.files ? Array.from(input.files) : []);
    input.click();
  });
}

export async function pickDirectoryFiles(): Promise<{ path: string; content: string }[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input') as HTMLInputElement & { webkitdirectory: boolean };
    input.type = 'file';
    input.webkitdirectory = true;
    input.multiple = true;
    input.onchange = async () => {
      const files = input.files ? Array.from(input.files) : [];
      const out: { path: string; content: string }[] = [];
      for (const f of files) {
        if (!f.name.toLowerCase().endsWith('.md')) continue;
        const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
        const parts = rel.split('/');
        parts.shift(); // 선택한 최상위 폴더 이름 제거
        out.push({ path: parts.join('/') || f.name, content: await f.text() });
      }
      resolve(out);
    };
    input.click();
  });
}

/** 간이 비밀번호 강도 0–4 (SPEC: zxcvbn 점수 3 이상 권장 — v1은 길이·다양성 기준 간이 추정) */
export function passwordScore(pw: string): number {
  if (!pw) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/, /[가-힣]/].filter((r) => r.test(pw)).length;
  const words = pw.trim().split(/\s+/).length;
  const len = pw.length;
  const repeated = /(.)\1{3,}/.test(pw) || /^(.{1,3})\1+$/.test(pw);
  let score = 0;
  if (len >= 8) score++;
  if (len >= 12) score++;
  if (len >= 16 || words >= 4) score++;
  if (classes >= 3 || (words >= 4 && len >= 20)) score++;
  if (repeated) score = Math.min(score, 1);
  return Math.min(4, score);
}
