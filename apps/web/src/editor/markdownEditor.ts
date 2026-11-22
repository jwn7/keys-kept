import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { Decoration, EditorView, MatchDecorator, ViewPlugin, keymap, placeholder as placeholderExt, drawSelection, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { autocompletion, completionKeymap, startCompletion, type CompletionContext, type CompletionResult, type Completion } from '@codemirror/autocomplete';
import { tags as t } from '@lezer/highlight';
import { ko } from '../i18n/ko';
import { todayTitle } from '../app/util';

/** 마크다운 표시 스타일. 색은 app.css의 .cm-md-* 클래스가 토큰으로 정한다. */
const mdHighlight = HighlightStyle.define([
  { tag: t.heading1, class: 'cm-md-heading cm-md-h1' },
  { tag: t.heading2, class: 'cm-md-heading cm-md-h2' },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], class: 'cm-md-heading' },
  { tag: t.monospace, class: 'cm-md-code' },
  { tag: [t.link, t.url], class: 'cm-md-link' },
  { tag: t.quote, class: 'cm-md-quote' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, class: 'cm-md-done' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], class: 'cm-md-mark' },
]);

/**
 * 마크다운 문법에 없는 이 앱의 표기 세 가지를 꾸민다: 체크박스 `[ ]`/`[x]`, `[[메모 링크]]`, `#태그`.
 * 글자는 그대로 두고 class만 입힌다 (문서 내용은 바뀌지 않음). 모양은 app.css의 .cm-md-* 가 정한다.
 */
const boxMark = Decoration.mark({ class: 'cm-md-box' });
const boxDoneMark = Decoration.mark({ class: 'cm-md-box cm-md-box-done' });
const doneLine = Decoration.line({ class: 'cm-md-done-line' });
const wikiMark = Decoration.mark({ class: 'cm-md-wiki' });
const tagMark = Decoration.mark({ class: 'cm-md-tag' });
const inlineMatcher = new MatchDecorator({
  // 1: 목록 머리(`- `, `1. `)  2: 체크박스  3: [[링크]]  4: 태그 앞 공백  5: #태그
  regexp: /(^\s*(?:[-*+]|\d+\.)\s+)(\[[ xX]\])|(\[\[[^\]\n]+\]\])|(^|\s)(#[\p{L}\p{N}_-]+)/gu,
  decorate: (add, from, _to, m) => {
    if (m[2] !== undefined) {
      const done = m[2] !== '[ ]';
      if (done) add(from, from, doneLine);
      const start = from + (m[1]?.length ?? 0);
      add(start, start + 3, done ? boxDoneMark : boxMark);
    } else if (m[3] !== undefined) {
      add(from, from + m[3].length, wikiMark);
    } else if (m[5] !== undefined) {
      const start = from + (m[4]?.length ?? 0);
      add(start, start + m[5].length, tagMark);
    }
  },
});
const inlineMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = inlineMatcher.createDeco(view);
    }
    update(u: ViewUpdate) {
      this.decorations = inlineMatcher.updateDeco(u, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);

/** `/` 명령 (SPEC §2.2) */
function slashSource(ctx: CompletionContext): CompletionResult | null {
  const m = ctx.matchBefore(/\/[\w가-힣]*$/);
  if (!m) return null;
  const line = ctx.state.doc.lineAt(ctx.pos);
  if (line.text.slice(0, m.from - line.from).trim() !== '') return null; // 줄 시작에서만
  const items: { label: string; detail: string; insert: string; cursor?: number }[] = [
    { label: '/h1', detail: ko.editor.slash.h1, insert: '# ' },
    { label: '/h2', detail: ko.editor.slash.h2, insert: '## ' },
    { label: '/h3', detail: ko.editor.slash.h3, insert: '### ' },
    { label: '/todo', detail: ko.editor.slash.todo, insert: '- [ ] ' },
    { label: '/bullet', detail: ko.editor.slash.bullet, insert: '- ' },
    { label: '/number', detail: ko.editor.slash.number, insert: '1. ' },
    { label: '/code', detail: ko.editor.slash.code, insert: '```\n\n```', cursor: 4 },
    { label: '/table', detail: ko.editor.slash.table, insert: '| 열 1 | 열 2 |\n| --- | --- |\n|  |  |\n', cursor: 2 },
    { label: '/hr', detail: ko.editor.slash.hr, insert: '---\n' },
    { label: '/date', detail: ko.editor.slash.date, insert: todayTitle() + ' ' },
  ];
  const options: Completion[] = items.map((it) => ({
    label: it.label,
    detail: it.detail,
    apply: (view, _c, from, to) => {
      view.dispatch({ changes: { from, to, insert: it.insert }, selection: { anchor: from + (it.cursor ?? it.insert.length) } });
    },
  }));
  return { from: m.from, options, filter: true, validFor: /^\/[\w가-힣]*$/ };
}

/** `[[` 메모 제목 자동완성 */
function wikiSource(titles: () => string[]) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/\[\[([^\]]*)$/);
    if (!m) return null;
    const from = m.from + 2;
    const options: Completion[] = titles().map((title) => ({
      label: title,
      apply: (view, _c, f, to) => {
        const after = view.state.sliceDoc(to, to + 2) === ']]' ? 2 : 0;
        view.dispatch({ changes: { from: f, to: to + after, insert: `${title}]]` }, selection: { anchor: f + title.length + 2 } });
      },
    }));
    return { from, options, filter: true, validFor: /^[^\]]*$/ };
  };
}

/** 체크박스 클릭 토글: `- [ ]` / `- [x]` 글자 위를 클릭하면 바꾼다 */
const checkboxClick = EditorView.domEventHandlers({
  mousedown(e, view) {
    if (e.button !== 0) return false;
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos === null) return false;
    const line = view.state.doc.lineAt(pos);
    const m = /^(\s*(?:[-*+]|\d+\.)\s+)\[( |x|X)\]/.exec(line.text);
    if (!m) return false;
    const start = line.from + m[1]!.length;
    const col = pos - line.from;
    if (col < m[1]!.length || col > m[1]!.length + 3) return false;
    const done = m[2] !== ' ';
    view.dispatch({ changes: { from: start + 1, to: start + 2, insert: done ? ' ' : 'x' } });
    e.preventDefault();
    return true;
  },
});

/** `[[제목]]` Ctrl+클릭 → onOpenLink(제목) */
function linkClick(onOpenLink: (title: string) => void) {
  return EditorView.domEventHandlers({
    click(e, view) {
      if (!(e.ctrlKey || e.metaKey)) return false;
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos === null) return false;
      const line = view.state.doc.lineAt(pos);
      for (const m of line.text.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
        const s = line.from + (m.index ?? 0);
        if (pos >= s && pos <= s + m[0].length) {
          onOpenLink((m[1] ?? '').trim());
          e.preventDefault();
          return true;
        }
      }
      return false;
    },
  });
}

export type EditorHandle = {
  view: EditorView;
  setDoc(text: string): void;
  insertAtLineStart(prefix: string): void;
  insert(text: string, cursorOffset?: number): void;
  openSlash(): void;
  /** 휴지통의 메모는 읽기만 */
  setReadOnly(readOnly: boolean): void;
  destroy(): void;
};

export function createMarkdownEditor(opts: {
  parent: HTMLElement;
  doc: string;
  onChange(text: string): void;
  titles(): string[];
  onOpenLink(title: string): void;
  onEscape?(): void;
}): EditorHandle {
  const readOnly = new Compartment();
  const extensions: Extension[] = [
    history(),
    drawSelection(),
    inlineMarks,
    markdown({ base: markdownLanguage }),
    syntaxHighlighting(mdHighlight),
    autocompletion({ override: [slashSource, wikiSource(opts.titles)], icons: false, activateOnTyping: true }),
    placeholderExt(ko.editor.bodyPlaceholder),
    EditorView.lineWrapping,
    checkboxClick,
    linkClick(opts.onOpenLink),
    keymap.of([
      ...completionKeymap,
      ...historyKeymap,
      indentWithTab,
      ...defaultKeymap,
      { key: 'Escape', run: () => (opts.onEscape?.(), true) },
    ]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) opts.onChange(u.state.doc.toString());
    }),
    readOnly.of([]),
  ];
  const view = new EditorView({ state: EditorState.create({ doc: opts.doc, extensions }), parent: opts.parent });
  return {
    view,
    setDoc(text) {
      if (view.state.doc.toString() === text) return;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    },
    insertAtLineStart(prefix) {
      const line = view.state.doc.lineAt(view.state.selection.main.head);
      view.dispatch({ changes: { from: line.from, insert: prefix } });
      view.focus();
    },
    insert(text, cursorOffset) {
      const { from, to } = view.state.selection.main;
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + (cursorOffset ?? text.length) } });
      view.focus();
    },
    openSlash() {
      const line = view.state.doc.lineAt(view.state.selection.main.head);
      const ins = line.text.trim() === '' ? '/' : '\n/';
      view.dispatch({ changes: { from: line.to, insert: ins }, selection: { anchor: line.to + ins.length } });
      view.focus();
      startCompletion(view);
    },
    setReadOnly(ro) {
      view.dispatch({ effects: readOnly.reconfigure(ro ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []) });
    },
    destroy() {
      view.destroy();
    },
  };
}
