import { config } from './config.js';
import { runTimers } from './services/orders.js';
import { runQueue, selfTest } from './services/idcheck.js';

let busy = false;
export function startWorker() {
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const r = await runTimers();
      if (r.lockCancelled || r.refunded || r.autoDisputed) console.log('timers', r);
    } catch (e) { console.error('worker error', e.message); }
    finally { busy = false; }
  };
  const h = setInterval(tick, config.workerIntervalSec * 1000);
  h.unref();
  // Automatic ID check: looks for new IDs every 30 seconds, one at a time.
  let idBusy = false;
  const idTick = async () => {
    if (idBusy || process.env.IDCHECK === 'off') return;
    idBusy = true;
    try { const d = await runQueue(3); if (d.length) console.log('idcheck', d.map((x) => x.id + ' ' + x.status).join(', ')); }
    catch (e) { console.error('idcheck error', e.message); }
    finally { idBusy = false; }
  };
  if (process.env.IDCHECK !== 'off') setTimeout(() => { idBusy = true; selfTest().finally(() => { idBusy = false; }); }, 20 * 1000).unref();
  const h2 = setInterval(idTick, 30 * 1000);
  h2.unref();
  return () => { clearInterval(h); clearInterval(h2); };
}
