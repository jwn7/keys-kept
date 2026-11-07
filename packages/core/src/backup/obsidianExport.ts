import { strToU8, zipSync } from 'fflate';
import type { Note } from '../model/types';

/** 파일명 금지 문자(`/ \ : * ? " < > |`)는 `_`로. 빈 제목은 untitled. */
export function safeFileName(title: string): string {
  const s = title.replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
  return s.length ? s : 'untitled';
}

/**
 * 옵시디언 호환 평문 zip: `폴더/제목.md`, frontmatter(tags, created, updated).
 * `[[링크]]`와 `#태그`는 본문 그대로 — 옵시디언에서 그대로 동작한다. 평문이므로 UI는 경고를 띄운다.
 */
export function exportObsidianZip(notes: Note[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  for (const n of notes) {
    if (n.deletedAt !== null) continue;
    const dir = n.folder ? `${safeFileName(n.folder)}/` : '';
    const base = safeFileName(n.title);
    let path = `${dir}${base}.md`;
    for (let i = 2; used.has(path); i++) path = `${dir}${base} (${i}).md`;
    used.add(path);
    const fm = ['---', `tags: [${n.tags.join(', ')}]`, `created: ${n.createdAt}`, `updated: ${n.updatedAt}`, '---', ''].join('\n');
    files[path] = strToU8(fm + n.body + '\n');
  }
  return zipSync(files, { level: 6 });
}

export function obsidianZipName(date = new Date()): string {
  return `vault-export-${date.toISOString().slice(0, 10)}.zip`;
}
