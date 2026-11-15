# Haiti P2P USDT Marketplace

A Haiti-only marketplace where people buy and sell USDT/USDC with gourdes (HTG).

- Sellers post ads. Buyers pay HTG straight to the seller (MonCash, NatCash or bank).
- The platform **locks the seller's USDT first**. A seller cannot take the gourdes and run.
- The seller checks their own app, presses "Confirm received", and the USDT is released.
- If something is wrong, a staff agent reads the proof and decides.
- **The platform never holds gourdes.**

This is an MVP built from the "Haiti P2P USDT Marketplace Spec". It runs on **fake money** (`ESCROW_MODE=MOCK`).

> ## Read this before anything else
> - **No real escrow exists yet.** The "chain" is a simulation (`src/escrow.js`). Money is a number in a database table. Do not put real USDT through this.
> - **Get a written opinion from a Haitian lawyer** before launch (BRH approval, UCREF reporting, who may hold the dispute keys). The spec has the checklist.
> - ID checks, SMS codes and sanctions screening are **simple stand-ins** (see "What is real, what is a stand-in").

## Run it

You need Node 20+ and PostgreSQL 16 (or Docker).

```bash
docker compose up -d          # PostgreSQL (or use your own)
cp .env.example .env          # then set TOKEN_SECRET
npm install
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/haiti_p2p
npm run migrate               # creates the tables
node scripts/make-staff.js +50930000001 "Admin Name" ADMIN
node scripts/make-staff.js +50930000002 "Agent Name" AGENT
npm start                     # http://localhost:3000
```

In test mode the login code is always `000000`. Use the Wallet page to add fake USDT.

Try a full trade with two browsers (one seller, one buyer):

1. Sign up both. Staff approves their ID check (Staff page). The name on the ID must match the account name.
2. Each adds a payment account (Profile). The name on it must match the ID.
3. Seller: Wallet, add fake USDT. My ads, post a sell ad.
4. Buyer: Market, press Buy USDT, enter an amount.
5. Buyer presses "I paid". Seller presses "Confirm received". Done.

## Tests

```bash
export TEST_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres
npm test
```

The tests make a throw-away database and check: the full trade, cancel, timeouts, auto-dispute, two-agent decisions, admin tie-break, fake-proof ban, buy ads, limits, closing ads (money adds up), and the database rules.

## How an order moves

```
ORDER_CREATED -> AWAITING_PAYMENT -> PAID_CLAIMED -> RELEASING -> COMPLETED
      |                 |                  |
CANCELLED_TIMEOUT   REFUNDING          DISPUTED -> RELEASING (buyer wins)
                        |                       -> REFUNDING (seller wins)
                    REFUNDED
```

- Only the **seller** or a **dispute agent** can release USDT. A timer never releases it.
- The seller cannot cancel after "I paid".
- The database blocks any other move (`order_transitions` + a trigger) and logs every change in `order_events` (append-only).
- Timers (set in `.env`): lock 10 min, buyer pays in 30 min (+10 min grace), seller answers in 30 min (then auto-dispute), proof in 24 h.

## What is real, what is a stand-in

| Part | Status |
| --- | --- |
| Order state machine, timers, disputes, strikes, bans, blocklist | Built and tested |
| Ads, buy ads and sell ads, price/limit rules, tier limits, fee from seller | Built and tested |
| Chat (blocks links and phone numbers), ratings, evidence | Built |
| Web app (phone-friendly, English / French / Haitian Creole menus) | Built. French and Creole text is a draft: have native speakers review it |
| Escrow | **Simulated.** Replace `src/escrow.js` with a smart-contract adapter. Then get an outside audit |
| SMS login | **Stand-in.** Code `000000`. Add an SMS provider in `src/auth.js` |
| ID check | **Stand-in.** Staff reviews by hand. A vendor can plug in at `src/services/users.js` |
| Sanctions screening | **Stand-in.** Exact name match against `data/sanctions.txt`. Load real lists or use a vendor |
| Proof upload | Stores a link or file name only. Add real file storage |
| Haiti-only | Phone must be +509. Set `REQUIRE_HAITI_GEO=true` behind a CDN that sends the country header |
| Withdrawals to a real wallet | Not built (needs the real escrow) |

## Going live (in this order)

1. Haitian lawyer's written opinion. Stop if it is a no.
2. Real escrow: a smart contract with `lock`, `release`, `refund` keyed by order id. Arbiter keys: 2 of 3, held by different people. Decide the network (TRON, Polygon, BNB) after a small test.
3. Outside audit of the contract. No audit, no launch.
4. Real SMS, ID vendor, sanctions vendor, file storage.
5. Pilot with about 100 users and low limits. Review every dispute.

## Tunable numbers

Limits (`tier_limits` table, Admin page), timers, fee (`FEE_RATE`, 0.5% by default) and the two-agent size (`DUAL_AGENT_HTG`) are starting guesses from the spec. Change them after the pilot.

## Layout

```
db/schema.sql        tables, rules, triggers
src/services/        orders, disputes, ads, users, limits, screening, wallet
src/escrow.js        escrow adapter (mock now)
src/worker.js        timer loop
src/routes.js        API
public/              web app
test/flow.test.js    end-to-end tests
scripts/             migrate, make-staff
```
