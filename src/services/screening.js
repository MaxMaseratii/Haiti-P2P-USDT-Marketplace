import fs from 'node:fs';
import { config } from '../config.js';
import { normName } from './names.js';

let cache = null;
function sanctions() {
  if (cache) return cache;
  try {
    cache = fs.readFileSync(config.sanctionsFile, 'utf8')
      .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
      .map((l) => ({ raw: l, norm: normName(l) }));
  } catch { cache = []; }
  return cache;
}
export const reloadSanctions = () => { cache = null; };

// Checks a name against the local list. A hit freezes the account for staff review.
// This is a simple exact-name check. Replace with a screening vendor before going live.
export async function screenUser(c, userId, fullName) {
  const n = normName(fullName);
  const hit = sanctions().find((s) => s.norm === n);
  if (!hit) return false;
  await c.query('INSERT INTO screening_hits (user_id, list_name, matched_name) VALUES ($1,$2,$3)', [userId, 'local-list', hit.raw]);
  await c.query('UPDATE users SET banned = true WHERE id=$1', [userId]);
  return true;
}

export async function isBlocked(c, kind, value) {
  if (!value) return false;
  const r = await c.query('SELECT 1 FROM blocklist WHERE kind=$1 AND value=$2', [kind, value]);
  return r.rowCount > 0;
}

export async function addBlock(c, kind, value, reason) {
  if (!value) return;
  await c.query('INSERT INTO blocklist (kind, value, reason) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [kind, value, reason || null]);
}
