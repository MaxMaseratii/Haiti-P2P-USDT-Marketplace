# Haiti P2P USDT Marketplace

A Haiti-only marketplace where people buy and sell USDT/USDC with gourdes (HTG).

- Sellers post ads. Buyers pay HTG straight to the seller (MonCash, NatCash or bank).
- The platform **locks the seller's USDT first**. A seller cannot take the gourdes and run.
- The seller checks their own app, presses "Confirm received", and the USDT is released.
- If something is wrong, a staff agent reads the proof and decides.
- **The platform never holds gourdes.**

This is an MVP built from the "Haiti P2P USDT Marketplace Spec". It runs on **fake money** by default (`ESCROW_MODE=MOCK`). A smart-contract escrow is included (`ESCROW_MODE=EVM`). It is **unaudited**.

> ## Read this before anything else
> - **Default mode is a simulation.** Money is a number in a database table. The smart-contract escrow exists (`contracts/`, `ESCROW_MODE=EVM`) and is tested on a local test chain only. **It has not been audited and has never run on a public network.** Do not put real USDT through this before an outside audit.
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

In test mode the login code is always `000000` (`SMS_PROVIDER=mock`). Use the Wallet page to add fake USDT.

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

```bash
cd contracts && npm install && npm test   # the contract, on a local test chain (12 tests)
```

The `npm test` at the top level includes the app against the real contract (`test/evm.test.js`, skipped if `contracts/` is not built). The tests make a throw-away database and check: the full trade, cancel, timeouts, auto-dispute, two-agent decisions, admin tie-break, fake-proof ban, buy ads, limits, closing ads (money adds up), and the database rules.

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
| Chat (blocks links and phone numbers), ratings | Built |
| Proof upload (image or PDF, checked by file signature, size cap, only the two traders and staff can open it) | Built and tested |
| SMS login (one-time code, hashed, expires in 10 min, one use, 5 tries, rate limits, Twilio adapter) | Built and tested with a **fake** provider. **Not tested against real Twilio, and not tested on Digicel or Natcom numbers.** Test delivery in Haiti before launch. Add a local provider in `src/sms.js` if needed |
| Smart contract escrow (`contracts/src/P2PEscrow.sol`) | Built. 12 contract tests + 7 app-to-contract tests pass on a local chain. **Unaudited. Never run on a public network** |
| Wallet connect, deposit, withdraw, and release-signing in the browser (`public/app.js`) | Written. **Not tested with a real wallet.** The server side (signature checks) is tested |
| Web app (phone-friendly, English / French / Haitian Creole menus) | Built. French and Creole text is a draft: have native speakers review it |
| ID check | **Stand-in.** Staff reviews by hand. A vendor can plug in at `src/services/users.js` |
| Sanctions screening | **Stand-in.** Exact name match against `data/sanctions.txt`. Load real lists or use a vendor |
| Haiti-only | Phone must be +509. Set `REQUIRE_HAITI_GEO=true` behind a CDN that sends the country header |

## Smart-contract escrow (ESCROW_MODE=EVM)

How it works:

- A user links a wallet by **signing a message** (proves it is theirs). Deposits to the contract are credited to the account that owns that wallet.
- Seller deposits USDT/USDC into `P2PEscrow`. When a sell ad is posted, the app key **reserves** that amount in the contract, so the seller cannot withdraw it while the ad is open.
- A new order **locks** amount + fee inside the contract. When the buyer presses "I paid", the contract is told (`markClaimed`).
- The seller releases by **signing a message with their wallet** (no gas). Anyone can send that signature (`releaseWithSig`). The buyer's and the fee's balances are credited inside the contract. The buyer withdraws to their own wallet.
- Dispute decisions are carried out by the **arbiter** address.

Who can move money (this is the important part):

| Key | Can | Cannot |
| --- | --- | --- |
| Operator (the app server key) | reserve, lock, mark paid, cancel an order the buyer never marked paid | release to a buyer, withdraw, move funds to itself |
| Seller | release their own order, withdraw free balance, take back an unpaid order after 1 day | touch someone else's order |
| Arbiter | release to buyer or refund to seller on any locked order | withdraw anyone's balance |
| Owner | pause new deposits/locks, change roles | take funds. Pause never blocks withdraw, release or refund |

If the operator key **and** the arbiter key are both stolen, funds can be stolen. So:

- **Do not put `ARBITER_PRIVATE_KEY` on the server.** Make the arbiter address a **multisig** (for example a Safe, 2 of 3, three different people). When staff decide a dispute, the order waits in RELEASING / REFUNDING until the multisig executes `release` / `refund`. The worker sees it on the chain and finishes the order. (This path is tested.)
- Make the owner a multisig too.
- Who holds the dispute keys is a **legal question** for your Haitian lawyer.

Books check: `GET /api/admin/reconcile` compares the tokens inside the contract with what the database says users own. They must match. A mismatch means stop and look. A deposit from a wallet nobody linked shows as a mismatch until it is claimed. That is on purpose.

Known limits:

- Only chains where USDT/USDC have **6 decimals** (Ethereum, Polygon, Arbitrum, Base). **TRON is not supported** (the contract is Solidity for EVM chains).
- Tokens that take a fee on transfer are rejected. A stablecoin issuer can freeze the contract's address. That risk cannot be removed.
- One server only for the reserve sync and chain scan. Do not run two copies of the worker.
- Seller signature lasts at most 7 days. If it expires before release, an arbiter must release.
- Set `EVM_CONFIRMATIONS` high enough for your chain (12 or more on Ethereum or Polygon). Deposits count only after that many blocks.

Deploy (test network first):

```bash
cd contracts && npm install && npm run build && cd ..
DEPLOYER_PRIVATE_KEY=0x... EVM_RPC_URL=https://... OPERATOR_ADDRESS=0x... \
ARBITER_ADDRESS=0x...multisig FEE_RECIPIENT=0x... node scripts/deploy-escrow.js
# put the printed lines and the TOKEN_* addresses in .env, set ESCROW_MODE=EVM, then npm start
```

## Going live (in this order)

1. Haitian lawyer's written opinion. Stop if it is a no.
2. Outside audit of `contracts/src/P2PEscrow.sol` and of the app-to-chain code (`src/escrow-evm.js`). No audit, no launch.
3. Deploy on a test network. Run a full trade with real wallets in a browser (the wallet screens are untested). Run the books check after every step.
4. Test real SMS delivery to Digicel and Natcom numbers. Pick an ID vendor and a sanctions vendor. Move uploads to real storage (the disk folder is fine for one server).
5. Arbiter and owner as multisigs held by different people.
6. Pilot with about 100 users and very low limits. Review every dispute and run the books check daily.

## Tunable numbers

Limits (`tier_limits` table, Admin page), timers, fee (`FEE_RATE`, 0.5% by default) and the two-agent size (`DUAL_AGENT_HTG`) are starting guesses from the spec. Change them after the pilot.

## Layout

```
db/schema.sql        tables, rules, triggers
src/services/        orders, disputes, ads, users, limits, screening, wallet
src/escrow.js        escrow adapter switch (mock or EVM)
src/escrow-evm.js    smart-contract adapter, chain scan, books check
src/sms.js           SMS providers (mock, Twilio)
contracts/           P2PEscrow.sol, build and tests (solcjs + ganache)
src/worker.js        timer loop
src/routes.js        API
public/              web app
test/flow.test.js    end-to-end tests
scripts/             migrate, make-staff
```
