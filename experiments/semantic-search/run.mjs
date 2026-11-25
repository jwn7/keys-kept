// node run.mjs <model-id> [dtype]
// 낱말 검색(지금 앱) 대 임베딩 검색. 메모 300개(정답 40 + 방해 260), 질의 60개.
import { pipeline, env } from '@huggingface/transformers';
import { writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { notes as gold, queries, distractors } from './data.mjs';

const modelId = process.argv[2];
const dtype = process.argv[3] ?? 'q8';
env.cacheDir = './models';
const notes = [...gold, ...distractors(260)];
const K = 5;

// ---- 지금 앱의 검색 (apps/web/src/app/util.ts searchScore를 그대로 옮김): 모든 조각이 들어 있어야 한다 ----
const tokens = (q) => q.toLowerCase().split(/\s+/).filter(Boolean);
function andScore(n, ts) {
  const title = n.title.toLowerCase(), body = n.body.toLowerCase(), tags = n.tags.map((t) => t.toLowerCase());
  let score = 0;
  for (const t of ts) {
    const s = (title.includes(t) ? 3 : 0) + (tags.some((x) => x.includes(t)) ? 2 : 0) + (body.includes(t) ? 1 : 0);
    if (s === 0) return 0;
    score += s;
  }
  return score;
}
// ---- 더 너그러운 낱말 검색: 조각이 하나라도 있으면 점수 (공정한 비교용) ----
function orScore(n, ts) {
  const title = n.title.toLowerCase(), body = n.body.toLowerCase(), tags = n.tags.map((t) => t.toLowerCase());
  let score = 0;
  for (const t of ts) score += (title.includes(t) ? 3 : 0) + (tags.some((x) => x.includes(t)) ? 2 : 0) + (body.includes(t) ? 1 : 0);
  return score;
}
const rankBy = (scoreFn, q) =>
  notes.map((n, i) => ({ id: n.id, i, s: scoreFn(n, tokens(q)) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.id);

// ---- 임베딩 ----
const isGemma = /gemma/i.test(modelId);
const docText = (n) => (isGemma ? `title: ${n.title || 'none'} | text: ${n.body}` : `passage: ${n.title}\n${n.body}`);
const queryText = (q) => (isGemma ? `task: search result | query: ${q}` : `query: ${q}`);

const t0 = performance.now();
const extractor = await pipeline('feature-extraction', modelId, { dtype });
const loadMs = performance.now() - t0;
const embed = async (texts) => (await extractor(texts, { pooling: 'mean', normalize: true })).tolist();

const t1 = performance.now();
const docVecs = [];
for (let i = 0; i < notes.length; i += 16) docVecs.push(...(await embed(notes.slice(i, i + 16).map(docText))));
const indexMs = performance.now() - t1;

const qTimes = [];
const semRank = async (q) => {
  const t = performance.now();
  const [v] = await embed([queryText(q)]);
  qTimes.push(performance.now() - t);
  return docVecs.map((d, i) => ({ id: notes[i].id, s: d.reduce((a, x, j) => a + x * v[j], 0) })).sort((a, b) => b.s - a.s).map((x) => x.id);
};
// 섞기: 순위의 역수를 더한다 (reciprocal rank fusion). 낱말이 정확히 맞은 것과 뜻이 가까운 것을 같이 올린다.
const fuse = (a, b) => {
  const s = new Map();
  for (const list of [a, b]) list.slice(0, 50).forEach((id, r) => s.set(id, (s.get(id) ?? 0) + 1 / (60 + r)));
  return [...s.entries()].sort((x, y) => y[1] - x[1]).map(([id]) => id);
};

const systems = ['and', 'or', 'semantic', 'hybrid', 'andFirst'];
const stat = Object.fromEntries(systems.map((s) => [s, { all: { hit: 0, rr: 0, n: 0 } }]));
const misses = [];
for (const { q, gold: g, type } of queries) {
  const sem = await semRank(q);
  const or = rankBy(orScore, q);
  const and = rankBy(andScore, q);
  // andFirst: 낱말이 전부 맞은 메모를 먼저, 그 뒤를 뜻이 가까운 순으로 채운다
  const ranks = { and, or, semantic: sem, hybrid: fuse(or, sem), andFirst: [...and, ...sem.filter((id) => !and.includes(id))] };
  for (const s of systems) {
    const pos = ranks[s].indexOf(g);
    for (const key of ['all', type]) {
      const b = (stat[s][key] ??= { hit: 0, rr: 0, n: 0 });
      b.n++;
      if (pos >= 0 && pos < K) b.hit++;
      if (pos >= 0) b.rr += 1 / (pos + 1);
    }
    if (s === 'andFirst' && !(pos >= 0 && pos < K)) misses.push({ q, type, gold: g, rank: pos + 1, top: ranks.andFirst.slice(0, 3).map((id) => notes.find((n) => n.id === id).title) });
  }
}
const pct = (b) => (b ? `${Math.round((b.hit / b.n) * 100)}%` : '-');
const table = systems.map((s) => ({ system: s, 'hit@5 all': pct(stat[s].all), para: pct(stat[s].para), cross: pct(stat[s].cross), key: pct(stat[s].key), MRR: (stat[s].all.rr / stat[s].all.n).toFixed(2) }));

const dirSize = (d) => readdirSync(d, { withFileTypes: true }).reduce((a, e) => a + (e.isDirectory() ? dirSize(join(d, e.name)) : statSync(join(d, e.name)).size), 0);
const mid = [...qTimes].sort((a, b) => a - b)[qTimes.length >> 1];
const result = {
  model: modelId, dtype, dim: docVecs[0].length, notes: notes.length, queries: queries.length,
  diskMB: +(dirSize(join('./models', modelId)) / 1e6).toFixed(0),
  loadSec: +(loadMs / 1000).toFixed(1),
  indexSec: +(indexMs / 1000).toFixed(1), perNoteMs: +(indexMs / notes.length).toFixed(1), est1000Sec: +((indexMs / notes.length) * 1000 / 1000).toFixed(0),
  queryMsMedian: +mid.toFixed(1), rssMB: Math.round(process.memoryUsage().rss / 1e6),
  table, misses,
};
console.table(table);
console.log(JSON.stringify({ ...result, table: undefined, misses: undefined }));
console.log('andFirst misses:', misses.length);
for (const m of misses) console.log(' ', m.type, JSON.stringify(m.q), '-> rank', m.rank || 'none', '| top:', m.top.join(' / '));
writeFileSync(`result-${modelId.replace(/[^\w.-]+/g, '_')}-${dtype}.json`, JSON.stringify(result, null, 2));
