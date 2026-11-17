// Automatic ID check, the heavy part. Runs in its own short-lived process so the app keeps its memory:
// the parent sends { files: { FRONT, BACK, FACE1, FACE2, FACE3 } } (paths on disk) and gets back
// what the photos say: the text on the ID (OCR) and, for every photo, the biggest face found
// (a 1024-number "face print", how sure, real-vs-screen score, and where the head is turned).
// Free and on our own server: Human (face) + Tesseract (text). Nothing leaves the server.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const NM = path.resolve(path.dirname(require.resolve('tesseract.js/package.json')), '..');

// The face library loads its model files with fetch(); Node's fetch cannot read file:// so we do it.
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => {
  const s = String(u?.url || u);
  if (!s.startsWith('file://')) return realFetch(u, o);
  const b = await fs.promises.readFile(fileURLToPath(s));
  return new Response(b, { status: 200, headers: { 'content-type': s.endsWith('.json') ? 'application/json' : s.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' } });
};

async function readText(files) {
  const { createWorker } = await import('tesseract.js');
  const langPath = path.join(NM, '@tesseract.js-data/fra/4.0.0_best_int');
  const w = await createWorker('fra', 1, { langPath, gzip: true, cachePath: path.join(process.env.TMPDIR || '/tmp', 'ayiti-tess') });
  let text = '';
  try { for (const f of files) if (f) text += (await w.recognize(f)).data.text + '\n'; } finally { await w.terminate(); }
  return text;
}

async function readFaces(files) {
  const sharp = (await import('sharp')).default;
  const H = require(require.resolve('@vladmandic/human').replace(/human\.node\.js$/, 'human.node-wasm.js'));
  const Human = H.Human || H.default;
  const human = new Human({
    backend: 'wasm', debug: false, cacheSensitivity: 0, async: false,
    wasmPath: 'file://' + path.join(NM, '@tensorflow/tfjs-backend-wasm/dist') + '/',
    modelBasePath: 'file://' + path.join(NM, '@vladmandic/human/models') + '/',
    face: { enabled: true, detector: { rotation: true, maxDetected: 4, minConfidence: 0.3 }, mesh: { enabled: true }, iris: { enabled: false },
      description: { enabled: true }, emotion: { enabled: false }, antispoof: { enabled: true }, liveness: { enabled: true } },
    body: { enabled: false }, hand: { enabled: false }, object: { enabled: false }, gesture: { enabled: false }, segmentation: { enabled: false },
  });
  await human.load();
  const out = {};
  for (const [kind, file] of Object.entries(files)) {
    if (!file) continue;
    try {
      const { data, info } = await sharp(file).rotate().removeAlpha().toColourspace('srgb')
        .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
      const t = human.tf.tensor3d(new Uint8Array(data), [info.height, info.width, info.channels]);
      const r = await human.detect(t); human.tf.dispose(t);
      const faces = (r.face || []).filter((f) => f.embedding?.length).sort((a, b) => b.box[2] * b.box[3] - a.box[2] * a.box[3]);
      const f = faces[0];
      out[kind] = f ? { found: faces.length, score: f.score, real: f.real ?? null, live: f.live ?? null,
        yaw: f.rotation?.angle?.yaw ?? null, size: Math.round(Math.max(f.box[2], f.box[3])), emb: Array.from(f.embedding) } : { found: 0 };
    } catch (e) { out[kind] = { found: 0, error: e.message }; }
  }
  return out;
}

export async function analyze({ files }) {
  const text = await readText([files.FRONT, files.BACK]);
  const faces = await readFaces({ FRONT: files.FRONT, FACE1: files.FACE1, FACE2: files.FACE2, FACE3: files.FACE3 });
  return { text, faces };
}

// When started as a child process: one job, answer, exit.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.once('message', async (job) => {
    try { process.send({ ok: true, result: await analyze(job) }, () => process.exit(0)); }
    catch (e) { process.send({ ok: false, error: e.message }, () => process.exit(1)); }
  });
}
