// MonCash, NatCash and banks sometimes have outages: a payment shows "sent" but arrives late, or comes back.
// Staff can mark a provider as having problems. While it is marked, disputes on orders paid that way wait,
// and the "seller silent" timer does not open disputes, so nobody is punished for the provider's problem.
import { q } from '../db.js';
import { bad } from '../errors.js';

export const PROVIDERS = ['MONCASH', 'NATCASH', 'BANK'];

export async function alerts() {
  return (await q(`SELECT provider, note, updated_at FROM provider_status WHERE down ORDER BY provider`)).rows;
}

export async function isDown(provider) {
  return (await q(`SELECT 1 FROM provider_status WHERE provider=$1 AND down`, [provider])).rowCount > 0;
}

export async function set(user, { provider, down, note }) {
  if (!PROVIDERS.includes(provider)) throw bad('Provider must be MONCASH, NATCASH or BANK.');
  const n = String(note || '').trim().slice(0, 200) || null;
  await q(`INSERT INTO provider_status (provider, down, note, updated_by, updated_at) VALUES ($1,$2,$3,$4,now())
           ON CONFLICT (provider) DO UPDATE SET down=EXCLUDED.down, note=EXCLUDED.note, updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [provider, !!down, n, user.id]);
  return { ok: true };
}
