import { tx, q } from '../db.js';
import { config } from '../config.js';
import { bad, conflict, forbidden, notFound } from '../errors.js';
import { beginRelease, beginRefund, confirmRelease, confirmRefund } from './orders.js';
import { banAndBlock } from './users.js';

export async function addEvidence(user, orderId, { kind, file_ref, note }) {
  if (!['RECEIPT', 'STATEMENT', 'CHAT_EXPORT', 'OTHER'].includes(kind)) throw bad('Kind must be RECEIPT, STATEMENT, CHAT_EXPORT or OTHER.');
  if (!file_ref || String(file_ref).length < 3) throw bad('Add a file reference (link or file name).');
  const d = (await q(
    `SELECT d.*, o.buyer_id, o.seller_id FROM disputes d JOIN orders o ON o.id=d.order_id WHERE d.order_id=$1`, [orderId])).rows[0];
  if (!d) throw notFound('No dispute on this order.');
  if (d.buyer_id !== user.id && d.seller_id !== user.id) throw forbidden();
  if (d.status !== 'OPEN') throw conflict('Dispute is closed.');
  if (new Date(d.evidence_due) < new Date()) throw conflict('Evidence time is over.', 'LATE');
  const r = await q(
    `INSERT INTO evidence (dispute_id, uploaded_by, kind, file_ref) VALUES ($1,$2,$3,$4) RETURNING *`,
    [d.id, user.id, kind, note ? `${file_ref} | ${note}` : file_ref]);
  return r.rows[0];
}

export async function queue(status = 'OPEN') {
  return (await q(
    `SELECT d.*, o.total_htg, o.amount, o.asset, o.buyer_id, o.seller_id, o.pay_reference,
            (SELECT COUNT(*)::int FROM dispute_votes v WHERE v.dispute_id=d.id) AS votes
     FROM disputes d JOIN orders o ON o.id=d.order_id
     WHERE d.status=$1 ORDER BY d.created_at`, [status])).rows;
}

export async function detail(id) {
  const d = (await q('SELECT * FROM disputes WHERE id=$1', [id])).rows[0];
  if (!d) throw notFound();
  const [ev, votes, chat, order] = await Promise.all([
    q('SELECT * FROM evidence WHERE dispute_id=$1 ORDER BY created_at', [id]),
    q('SELECT agent_id, decision, note, fake_proof, penalize, created_at FROM dispute_votes WHERE dispute_id=$1', [id]),
    q('SELECT sender_id, body, created_at FROM chat_messages WHERE order_id=$1 ORDER BY id', [d.order_id]),
    q('SELECT * FROM orders WHERE id=$1', [d.order_id]),
  ]);
  return { dispute: d, order: order.rows[0], evidence: ev.rows, votes: votes.rows, chat: chat.rows };
}

// Agent vote. Small orders: one agent decides. Orders at or above DUAL_AGENT_HTG: two agents must agree.
// If two agents disagree, an admin vote settles it. An admin vote is always final.
export async function vote(agent, disputeId, { decision, note, fake_proof = false, penalize: wantPenalty = true }) {
  if (!['BUYER', 'SELLER'].includes(decision)) throw bad('Decision must be BUYER or SELLER.');
  if (!note || note.trim().length < 5) throw bad('Write a short note about why.');

  const result = await tx(async (c) => {
    const d = (await c.query('SELECT * FROM disputes WHERE id=$1 FOR UPDATE', [disputeId])).rows[0];
    if (!d) throw notFound();
    if (d.status !== 'OPEN') throw conflict('Dispute is already decided.');
    const o = (await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [d.order_id])).rows[0];
    if (o.state !== 'DISPUTED') throw conflict('Order is not in dispute.');
    if (agent.id === o.buyer_id || agent.id === o.seller_id) throw forbidden('You are part of this trade.');
    try {
      await c.query(
        `INSERT INTO dispute_votes (dispute_id, agent_id, decision, note, fake_proof, penalize) VALUES ($1,$2,$3,$4,$5,$6)`,
        [disputeId, agent.id, decision, note.trim(), !!fake_proof, !!wantPenalty]);
    } catch (e) { if (e.code === '23505') throw conflict('You already voted.'); throw e; }

    const votes = (await c.query(
      `SELECT v.*, u.role FROM dispute_votes v JOIN users u ON u.id=v.agent_id WHERE v.dispute_id=$1`, [disputeId])).rows;
    const need = Number(o.total_htg) >= config.dualAgentHtg ? 2 : 1;
    const adminVote = votes.find((v) => v.role === 'ADMIN');
    let final = null;
    if (adminVote) final = adminVote.decision;
    else {
      for (const side of ['BUYER', 'SELLER']) if (votes.filter((v) => v.decision === side).length >= need) final = side;
    }
    if (!final) return { resolved: false, needs_admin: votes.length >= need, votes: votes.length, need };

    const winners = votes.filter((v) => v.decision === final);
    const fake = winners.some((v) => v.fake_proof);
    const penalize = winners.every((v) => v.penalize);
    const loserId = final === 'BUYER' ? o.seller_id : o.buyer_id;

    await c.query(
      `UPDATE disputes SET status=$2, agent_id=$3, decision_note=$4, decided_at=now() WHERE id=$1`,
      [disputeId, final === 'BUYER' ? 'RESOLVED_BUYER' : 'RESOLVED_SELLER', agent.id, note.trim()]);

    if (final === 'BUYER') await beginRelease(c, o, agent.id, 'Dispute decided: buyer wins');
    else await beginRefund(c, o, 'DISPUTE_SELLER_WINS', agent.id, 'Dispute decided: seller wins');

    if (penalize || fake) await strike(c, loserId, fake);
    return { resolved: true, decision: final, order_id: o.id };
  });

  if (result.resolved) {
    if (result.decision === 'BUYER') await confirmRelease(result.order_id);
    else await confirmRefund(result.order_id);
  }
  return result;
}

// 1st strike: warning and lower limits. 2nd: 30-day suspension. 3rd or fake proof: ban + blocklist.
async function strike(c, userId, fake) {
  const u = (await c.query('UPDATE users SET strikes = strikes + 1 WHERE id=$1 RETURNING *', [userId])).rows[0];
  if (fake || u.strikes >= 3) { await banAndBlock(c, u, fake ? 'Fake payment proof' : 'Three strikes'); return; }
  if (u.strikes === 2) await c.query(`UPDATE users SET suspended_until = now() + interval '30 days' WHERE id=$1`, [userId]);
}
