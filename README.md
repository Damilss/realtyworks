# RealtyWorks
RealtyWorks - Modern Solutions for Property Management

**RealtyWorks** is an enterprise work interface for property managers and landlords to run real-estate maintenance and repair operations end-to-end: work orders, vendor coordination, documentation, and audit-ready records.

> Status: MVP / in active development  
> License: Proprietary (see `LICENSE`)

---

## What it does

RealtyWorks focuses on the operational layer of property management—getting repairs done and keeping clean records.

Typical workflow:
1. Property/Unit exists in the system
2. A maintenance issue becomes a **work order**
3. Work order is assigned internally or to a vendor
4. Work is tracked through statuses with photos, notes, invoices
5. Everything stays documented for accountability and reporting

---

## MVP scope

- **Properties & units**: basic structure for organizing work
- **Work orders**: create, assign, update status, priority, due dates
- **Activity trail**: notes + timestamped history (who changed what)
- **Attachments**: photos, receipts, invoices, supporting docs
- **Vendor contacts**: assign vendors + store contact details
- **Basic reporting**: open work, aging work orders, cost summaries (minimal)

---

## Non-goals (for MVP)

- Full accounting / rent collection
- Tenant portal / messaging suite
- Full leasing pipeline
- Deep integrations (to be added later)

---

## Repo conventions

- This repository is **not open source**.
- Do not redistribute or deploy outside approved environments.
- Production data should never be used in local/dev environments.

---

## Getting started (local)

**TO BE DETERMINED**

### Prerequisites
- A local database (recommended: Postgres)
- Node.js (if using a JS/TS web stack) and/or Python (if using an API service)
- Docker (optional but recommended)

### Environment variables
Create an environment file:

- `cp .env.example .env` (if provided)
- Fill in required values (database URL, auth secrets, file storage, etc.)

Suggested baseline variables:
- `DATABASE_URL=`
- `APP_ENV=development`
- `FILE_STORAGE_PROVIDER=local` (or `s3`)
- `AUTH_SECRET=`
- `BASE_URL=http://localhost:3000`

### Run (example)
If this repo uses a Node/TS workflow:

```bash
npm install
npm run dev
