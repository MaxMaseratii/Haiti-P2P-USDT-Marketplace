// Automatic ID check: our own robot, free, on our own server.
// For every ID sent, it reads the ID and looks at the faces, then:
//   - everything clear  -> approves by itself (when the owner leaves "auto-approve" ON)
//   - anything unsure   -> waits for the owner, with the reasons written down
// It never rejects by itself: a human always decides a "no".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { q } from '../db.js';
import { bad, conflict, notFound } from '../errors.js';
import { config } from '../config.js';
import { decideKyc } from './users.js';

const num = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? Number(process.env[k]) : d);
export const RULES = {
  match: num('IDCHECK_MATCH', 0.45),      // face on the ID vs face in the video: at or above = same person
  matchLow: num('IDCHECK_MATCH_LOW', 0.33), // below = looks like a different person
  sameFrames: 0.40,                       // the 3 video pictures must be the same person
  turn: 0.22,                             // head must turn (radians, about 13 degrees) between the pictures
  real: 0.30,                             // under this the camera may be filming a photo or a screen
  dupFace: 0.55,                          // same face already on another account
};

// ---------- settings ----------
export async function getSetting(key, def) {
  const r = (await q('SELECT value FROM app_settings WHERE key=$1', [key])).rows[0];
  return r ? r.value : def;
}
export async function settings() {
  return { auto_approve: (await getSetting('idcheck_auto', 'on')) === 'on', rules: RULES };
}
export async function setSettings({ auto_approve }) {
  await q(`INSERT INTO app_settings (key, value) VALUES ('idcheck_auto', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, [auto_approve ? 'on' : 'off']);
  return settings();
}

// ---------- reading names and numbers ----------
const clean = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const words = (s) => clean(s).replace(/[^A-Z]+/g, ' ').split(' ').filter(Boolean);
function lev(a, b) {
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
// Every part of the account name must be printed on the ID (small reading mistakes allowed).
export function nameOnId(fullName, text) {
  const need = words(fullName).filter((w) => w.length >= 2), have = words(text);
  const found = need.filter((w) => have.some((x) => x === w || (w.length >= 3 && x.includes(w)) || (w.length >= 3 && Math.abs(x.length - w.length) <= 1 && lev(w, x) <= (w.length >= 8 ? 2 : 1))));
  return { ok: need.length > 0 && found.length === need.length, found, missing: need.filter((w) => !found.includes(w)) };
}
const alnum = (s) => clean(s).replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^A-Z0-9]/g, '');
export function numberOnId(idNumber, text) {
  const n = alnum(idNumber);
  return n.length >= 4 && alnum(text).includes(n);
}

// ---------- faces ----------
// Same math as the face library: 1024 numbers per face, closer = more alike (0 to 1).
export function similarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  const dist = Math.round(100 * 25 * s) / 100; // order 2, multiplier 25, min 0.2, max 0.8 (the library defaults)
  if (dist === 0) return 1;
  const norm = (1 - Math.sqrt(dist) / 100 - 0.2) / 0.6;
  return Math.round(100 * Math.max(Math.min(norm, 1), 0)) / 100;
}

// ---------- the decision, from what the robot saw ----------
export async function judge(k, user, seen) {
  const F = seen.faces || {}, checks = [];
  const add = (key, ok, label, detail = '', blocking = true) => checks.push({ key, ok, label, detail, blocking });
  const frames = ['FACE1', 'FACE2', 'FACE3'].map((x) => F[x]).filter((f) => f && f.found && f.emb);
  const idFace = F.FRONT && F.FRONT.found && F.FRONT.emb ? F.FRONT : null;

  add('frames', frames.length >= 2, 'Face pictures taken during the video', frames.length + ' of 3' + (frames.length < 2 ? ' (old phone or upload: no live pictures)' : ''));
  add('idface', !!idFace, 'Face found on the ID photo', idFace ? 'yes' : 'no face found: photo blurry, cut or not an ID');

  let best = 0, vec = null;
  if (idFace && frames.length) for (const f of frames) { const s = similarity(idFace.emb, f.emb); if (s > best) { best = s; vec = f.emb; } }
  if (!vec && frames.length) vec = frames[0].emb;
  const pct = (x) => Math.round(x * 100) + '%';
  if (idFace && frames.length) add('match', best >= RULES.match, 'Face in the video = face on the ID', pct(best) + (best < RULES.matchLow ? ' (looks like a DIFFERENT person)' : best < RULES.match ? ' (not sure)' : ''));

  if (frames.length >= 2) {
    let low = 1;
    for (let i = 0; i < frames.length; i++) for (let j = i + 1; j < frames.length; j++) low = Math.min(low, similarity(frames[i].emb, frames[j].emb));
    add('same', low >= RULES.sameFrames, 'Same person in all video pictures', pct(low));
    const yaws = frames.map((f) => f.yaw).filter((y) => typeof y === 'number');
    const turn = yaws.length >= 2 ? Math.max(...yaws) - Math.min(...yaws) : 0;
    add('turn', turn >= RULES.turn, 'Head turned left and right (a live person, not a photo)', Math.round(turn * 57.3) + '° turn');
    const reals = frames.map((f) => f.real).filter((x) => typeof x === 'number');
    const real = reals.length ? reals.reduce((a, b) => a + b, 0) / reals.length : 1;
    add('real', real >= RULES.real, 'Real face, not a screen or printed photo', pct(real));
  }

  const nm = nameOnId(user.full_name, seen.text);
  add('name', nm.ok, 'Account name is printed on the ID', nm.ok ? nm.found.join(' ') : 'not read: ' + nm.missing.join(' '));
  add('number', numberOnId(k.id_number, seen.text), 'ID number is printed on the ID', k.id_number || '', false);

  // Same face or same ID on another account = one person with two accounts, or a stolen ID.
  let dup = null;
  if (vec) {
    const others = (await q(`SELECT k.face_vec, u.full_name, u.phone FROM kyc k JOIN users u ON u.id=k.user_id
                             WHERE k.user_id<>$1 AND k.face_vec IS NOT NULL AND k.status IN ('APPROVED','PENDING')`, [k.user_id])).rows;
    for (const o of others) { const s = similarity(vec, o.face_vec); if (s >= RULES.dupFace && (!dup || s > dup.s)) dup = { s, who: o.full_name + ' ' + o.phone }; }
  }
  add('dupface', !dup, 'Face not used on another account', dup ? 'SAME FACE as ' + dup.who + ' (' + pct(dup.s) + ')' : 'ok');
  const dupId = k.id_number ? (await q(`SELECT u.full_name, u.phone FROM kyc k JOIN users u ON u.id=k.user_id
       WHERE k.user_id<>$1 AND k.status IN ('APPROVED','PENDING') AND upper(regexp_replace(k.id_number,'[^A-Za-z0-9]','','g'))=upper(regexp_replace($2,'[^A-Za-z0-9]','','g')) LIMIT 1`, [k.user_id, k.id_number])).rows[0] : null;
  add('dupid', !dupId, 'ID number not used on another account', dupId ? 'SAME ID as ' + dupId.full_name + ' ' + dupId.phone : 'ok');
  const hits = (await q('SELECT count(*)::int n FROM screening_hits WHERE user_id=$1 AND NOT resolved', [k.user_id])).rows[0].n;
  add('screen', hits === 0, 'Not on a sanctions or block list', hits ? hits + ' hit(s): see Screening' : 'ok');

  const pass = checks.filter((c) => c.blocking).every((c) => c.ok);
  return { pass, best, vec, checks, text: String(seen.text || '').slice(0, 1500) };
}

// ---------- running the robot ----------
const HERE = path.dirname(fileURLToPath(import.meta.url));
let analyzer = (job) => new Promise((resolve, reject) => {
  const c = fork(path.join(HERE, '../idcheck/analyze.js'), [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  const t = setTimeout(() => { c.kill('SIGKILL'); reject(new Error('The check took too long.')); }, 4 * 60 * 1000);
  c.once('message', (m) => { clearTimeout(t); m.ok ? resolve(m.result) : reject(new Error(m.error)); });
  c.once('exit', (code) => { clearTimeout(t); if (code) reject(new Error('The check stopped (code ' + code + ').')); });
  c.send(job);
});
export const setAnalyzer = (fn) => { analyzer = fn; };

export async function checkOne(kycId) {
  const k = (await q('SELECT * FROM kyc WHERE id=$1', [kycId])).rows[0];
  if (!k) throw notFound();
  const user = (await q('SELECT * FROM users WHERE id=$1', [k.user_id])).rows[0];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idc-'));
  try {
    const files = {};
    for (const f of (await q(`SELECT DISTINCT ON (kind) kind, data FROM kyc_files WHERE kyc_id=$1 AND kind<>'VIDEO' ORDER BY kind, created_at DESC`, [kycId])).rows) {
      files[f.kind] = path.join(dir, f.kind.toLowerCase());
      fs.writeFileSync(files[f.kind], f.data);
    }
    const seen = await analyzer({ files });
    const r = await judge(k, user, seen);
    const auto = (await settings()).auto_approve;
    let status = r.pass && auto ? 'AUTO_APPROVED' : 'NEEDS_YOU', note = r.pass && !auto ? 'All checks passed. Auto-approve is OFF, so you decide.' : null;
    await q('UPDATE kyc SET face_vec=$2 WHERE id=$1', [kycId, r.vec]);
    if (status === 'AUTO_APPROVED') {
      try { await decideKyc({ id: config.platformUserId }, kycId, true); }
      catch (e) { status = 'NEEDS_YOU'; note = 'Could not approve by itself: ' + e.message; }
    }
    const result = { pass: r.pass, best: r.best, checks: r.checks, text: r.text, note };
    await q('UPDATE kyc SET auto_status=$2, auto_result=$3, auto_at=now() WHERE id=$1', [kycId, status, result]);
    return { status, ...result };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// One waiting ID at a time (the server is small). A check stuck for 10 minutes is tried again.
export async function runQueue(max = 3) {
  const done = [];
  for (let i = 0; i < max; i++) {
    const k = (await q(`UPDATE kyc SET auto_status='RUNNING', auto_at=now() WHERE id = (
        SELECT id FROM kyc WHERE status='PENDING' AND (auto_status IS NULL OR auto_status='QUEUED' OR (auto_status='RUNNING' AND auto_at < now() - interval '10 minutes'))
        ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id`)).rows[0];
    if (!k) break;
    try { done.push({ id: k.id, ...(await checkOne(k.id)) }); }
    catch (e) {
      console.error('idcheck', k.id, e.message);
      await q(`UPDATE kyc SET auto_status='NEEDS_YOU', auto_result=$2, auto_at=now() WHERE id=$1`, [k.id, { pass: false, checks: [], note: 'The robot could not check this one: ' + e.message }]);
      done.push({ id: k.id, status: 'NEEDS_YOU', error: e.message });
    }
  }
  return done;
}

export async function recheck(kycId) {
  const r = await q(`UPDATE kyc SET auto_status='QUEUED' WHERE id=$1 AND status='PENDING' RETURNING id`, [kycId]);
  if (!r.rowCount) throw conflict('Only an ID that is still waiting can be checked again.');
  return { id: kycId, auto_status: 'QUEUED' };
}

// The owner changes their mind on something the robot approved: back to "waiting", trading level back to 0.
export async function undoAuto(staff, kycId) {
  const k = (await q('SELECT * FROM kyc WHERE id=$1', [kycId])).rows[0];
  if (!k) throw notFound();
  if (k.status !== 'APPROVED') throw bad('This ID is not approved.');
  await q(`UPDATE kyc SET status='PENDING', auto_status='NEEDS_YOU', reviewed_by=NULL, reviewed_at=NULL,
           auto_result = coalesce(auto_result,'{}'::jsonb) || jsonb_build_object('note', 'Approval undone by the owner. Check it yourself.') WHERE id=$1`, [kycId]);
  await q('UPDATE users SET tier=0 WHERE id=$1 AND tier=1', [k.user_id]);
  return { id: kycId, status: 'PENDING' };
}

export async function recentAuto(limit = 20) {
  return (await q(`SELECT k.id, k.name_on_id, k.id_type, k.reviewed_at, k.auto_result, u.full_name, u.phone
                   FROM kyc k JOIN users u ON u.id=k.user_id WHERE k.auto_status='AUTO_APPROVED' AND k.status='APPROVED'
                   ORDER BY k.reviewed_at DESC LIMIT $1`, [limit])).rows;
}

// Once after each start: run the robot on a made-up card (no person, no user data) and write the result
// in the server log, so we know the face and text tools work on this server.
export async function selfTest() {
  const sharp = (await import('sharp')).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idc-'));
  try {
    const f = path.join(dir, 'card.jpg');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560"><rect width="900" height="560" fill="#e8eef5"/>' +
      '<text x="40" y="120" font-family="DejaVu Sans" font-size="44" font-weight="bold">REPUBLIQUE D HAITI</text><text x="40" y="220" font-family="DejaVu Sans" font-size="40">AYITI P2P TEST 4071</text></svg>';
    await sharp(Buffer.from(svg)).jpeg().toFile(f);
    const t = Date.now(), r = await analyzer({ files: { FRONT: f, FACE1: f } });
    const ok = /AYITI/.test(r.text) && r.faces.FRONT && r.faces.FRONT.found === 0;
    console.log(`idcheck self-test ${ok ? 'OK' : 'PROBLEM'}: read "${r.text.replace(/\s+/g, ' ').trim().slice(0, 60)}", faces tool ${r.faces.FRONT?.error ? 'error ' + r.faces.FRONT.error : 'ready'}, ${Date.now() - t} ms, robot memory ${r.rss_mb} MB`);
    return { ok, ms: Date.now() - t, rss_mb: r.rss_mb };
  } catch (e) { console.error('idcheck self-test PROBLEM:', e.message); return { ok: false, error: e.message }; }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
