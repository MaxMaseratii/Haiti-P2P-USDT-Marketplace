import { config } from './config.js';
import { runTimers } from './services/orders.js';

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
  return () => clearInterval(h);
}
