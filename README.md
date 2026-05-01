POS + Inventory Management System for Bakery and Coffee Shop

A multilingual, offline-first point-of-sale and inventory platform built for
bakeries and cafés. Staffs ring orders on a tablet or laptop, the
system tracks finished goods + raw material consumption automatically, and
owners get live revenue, waste, and stock-health visibility from any device.

Designed for multi-tenet platform.

Highlights

- Offline-first cashier — sales keep ringing through network blips, drains
  in the background to a single source of truth.
- Bilingual by default — every UI string is keyed and translated.
- Receipt + sticker printing over USB / network, no spooler required.
- USB-HID barcode scanner — scan from any page, lands on POS with the item
  already in cart.
- Idempotent write contract on every endpoint — duplicate POSTs are no-ops
  by design, so retries never double-charge or double-deduct stock.
- Role-based access control with a clean per-role landing page.
- Per-batch expiry, sale void with compensating ledger movements, recipe
  versioning, and a full DMG / FOC adjustment log.
- A4 multi-page operations report — daily / weekly / monthly stock ledger
  PDF with slip details, top movers, by-category roll-up, and adjustments.


Tech Stack

- Next.js 16 (App Router) + TypeScript
- Prisma 6 schema-of-truth with Neon Postgres over the HTTP driver
- Dexie / IndexedDB for the offline outbox + catalog SWR cache
- jsPDF + jspdf-autotable for operations report generation
- ESC/POS over TCP for thermal receipts; TSPL for label stickers
- PWA with Background Sync for the cashier write loop
- Tailwind tokens with a single global stylesheet
- Deploys to Vercel; portable to a self-hosted VPS without code changes


Installation

```bash
git clone <repo-url>
cd <project>
npm install
cp .env.example .env          # then fill in DATABASE_URL + cookie secret
node --env-file=.env scripts/pushViaHttp.mjs    # push schema
node --env-file=.env scripts/seed.mjs           # seed tenant + owner
npm run dev
```

Default login (change after first sign-in): owner@<tenant>.local / changeMe123

Production:

```bash
npm run build
npm start
```


Project Layout

- app/             Next.js App Router routes + API handlers
- components/      UI components grouped by feature area
- lib/             Domain logic, data access, printing, PDF, i18n
- prisma/          Schema + targeted migration files
- scripts/         Seed, schema push, migration runner, credential rotation
- public/          Static assets and PWA manifest icons


License

Proprietary — contact the maintainer for licensing terms.
