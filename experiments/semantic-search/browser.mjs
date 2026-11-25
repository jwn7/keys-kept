// 브라우저(Chrome)에서 같은 모델의 속도를 잰다. 모델과 런타임은 전부 이 폴더에서 내려주고, 바깥 요청은 막는다.
// node browser.mjs <model-id> <dtype> <wasm|webgpu>
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from '../../apps/web/node_modules/@playwright/test/index.mjs'; // 저장소의 Playwright를 빌려 쓴다
import { notes as gold, distractors } from './data.mjs';

const [modelId, dtype = 'q4', device = 'wasm'] = process.argv.slice(2);
const root = process.cwd();
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.html': 'text/html' };
const page_html = `<!doctype html><meta charset="utf-8"><script type="module">
import { pipeline, env } from '/node_modules/@huggingface/transformers/dist/transformers.js';
env.allowRemoteModels = false; env.allowLocalModels = true; env.localModelPath = '/models/'; env.useBrowserCache = false;
env.backends.onnx.wasm.wasmPaths = '/node_modules/onnxruntime-web/dist/';
window.bench = async (modelId, dtype, device, docs, query) => {
  const t0 = performance.now();
  const ex = await pipeline('feature-extraction', modelId, { dtype, device });
  const loadMs = performance.now() - t0;
  const run = async (texts) => (await ex(texts, { pooling: 'mean', normalize: true })).dims;
  await run([docs[0]]); // 첫 실행(준비)은 빼고 잰다
  const t1 = performance.now();
  for (let i = 0; i < docs.length; i += 8) await run(docs.slice(i, i + 8));
  const indexMs = performance.now() - t1;
  const qs = [];
  for (let i = 0; i < 10; i++) { const t = performance.now(); await run([query]); qs.push(performance.now() - t); }
  qs.sort((a, b) => a - b);
  return { loadSec: +(loadMs / 1000).toFixed(1), perNoteMs: +(indexMs / docs.length).toFixed(1), queryMs: +qs[5].toFixed(1), threads: navigator.hardwareConcurrency, isolated: crossOriginIsolated, gpu: !!navigator.gpu };
};
window.ready = true;
</script>`;

const server = http.createServer((req, res) => {
  const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }; // 여러 스레드 wasm에 필요
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url === '/') return res.writeHead(200, { ...headers, 'Content-Type': 'text/html' }).end(page_html);
  const file = normalize(join(root, url));
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) return res.writeHead(404, headers).end();
  res.writeHead(200, { ...headers, 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Content-Length': statSync(file).size });
  createReadStream(file).pipe(res);
}).listen(0);
const port = server.address().port;

const isGemma = /gemma/i.test(modelId);
const docs = [...gold, ...distractors(24)].map((n) => (isGemma ? `title: ${n.title} | text: ${n.body}` : `passage: ${n.title}\n${n.body}`));
const query = isGemma ? 'task: search result | query: 집세 올려 달라는 얘기' : 'query: 집세 올려 달라는 얘기';

const browser = await chromium.launch({ channel: 'chrome', args: device === 'webgpu' ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan'] : [] });
const page = await browser.newPage();
const outside = [];
await page.route('**/*', (r) => (r.request().url().startsWith(`http://localhost:${port}/`) ? r.continue() : (outside.push(r.request().url()), r.abort())));
page.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 300)));
await page.goto(`http://localhost:${port}/`);
await page.waitForFunction(() => window.ready, null, { timeout: 60000 });
try {
  const r = await page.evaluate(([m, d, dev, docs, q]) => window.bench(m, d, dev, docs, q), [modelId, dtype, device, docs, query]);
  console.log(JSON.stringify({ model: modelId, dtype, device, notes: docs.length, ...r, est1000Sec: Math.round(r.perNoteMs), outsideRequests: outside.length }));
} catch (e) {
  console.log(JSON.stringify({ model: modelId, dtype, device, error: String(e.message).slice(0, 400), outsideRequests: outside }));
}
await browser.close();
server.close();
