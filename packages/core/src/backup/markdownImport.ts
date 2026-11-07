import type { NoteInput } from '../session/VaultSession';

export type MarkdownFile = { path: string; content: string };

/**
 * `.md` 파일들 → NoteInput[]. 폴더 = 첫 경로 조각, 제목 = 첫 `# ` 줄 또는 파일명.
 * frontmatter는 `tags: [a, b]` 한 형태만 읽는다 (옵시디언 내보내기와 왕복되는 최소).
 */
export function parseMarkdownFiles(files: MarkdownFile[]): NoteInput[] {
  const out: NoteInput[] = [];
  for (const f of files) {
    if (!f.path.toLowerCase().endsWith('.md')) continue;
    const parts = f.path.replace(/\\/g, '/').split('/').filter(Boolean);
    const fileName = parts.pop() ?? 'untitled.md';
    const folder = parts[0] ?? null;
    let body = f.content.replace(/\r\n/g, '\n');
    let tags: string[] | undefined;

    const fm = /^---\n([\s\S]*?)\n---\n?/.exec(body);
    if (fm) {
      body = body.slice(fm[0].length);
      const t = /^tags:\s*\[([^\]]*)\]/m.exec(fm[1] ?? '');
      if (t) tags = (t[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    }

    let title = fileName.replace(/\.md$/i, '');
    const h1 = /^#\s+(.+)$/m.exec(body);
    if (h1 && body.trimStart().startsWith('#')) {
      title = (h1[1] ?? title).trim();
      body = body.replace(h1[0], '').replace(/^\n+/, '');
    }
    const input: NoteInput = { title, body: body.trimEnd(), folder };
    if (tags) input.tags = tags;
    out.push(input);
  }
  return out;
}
