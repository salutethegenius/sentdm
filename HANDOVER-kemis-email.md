# Kemis.email Handover — Bulk Messaging Product

**Source session:** Sent.dm Bahamas NHI campaign (repo `salutethegenius/sentdm`)  
**Hand off to:** kemis.email agent / product build  
**Date:** 2026-07-29  
**Goal:** Productize what we proved here into a sellable https://kemis.email offering for large companies.

---

## 1. Mission

Turn the proven Sent.dm bulk-send + analytics workflow into a **kemis.email product**:

- Enterprise clients upload contact lists
- Kemis validates, quotes, funds, and sends (SMS / WhatsApp via Sent or equivalent)
- Clients get a white-labeled delivery + cost report
- Kemis keeps margin on top of carrier + provider costs

This session proved the full loop end-to-end on a real 20k+ Bahamas list with **100% deliverability**.

---

## 2. What we shipped in this session

### Campaign results (live)

| Metric | Value |
|---|---|
| Source rows | 24,999 (`25k - Sheet1.csv`) |
| Unique valid E.164 | **20,256** |
| Duplicates removed | 4,743 |
| Destination | Bahamas `+1242` only |
| Delivered | **20,256 (100%)** |
| Failed / blocked | 0 |
| Channel | SMS |
| Total spend (API actuals) | **$1,517.03** |
| Avg cost / msg | **~$0.075** |

### Send runs

| Run | Limit / count | Accepted | Cost (actual) | Notes |
|---|---|---|---|---|
| 1 | 12,000 | 12,000 | $898.41 | First funded tranche (~$1,000) |
| 2 | 4,000 | 4,000 | $299.72 | ~$300 top-up |
| 3 | 2,920 | 2,920 | $218.80 | ~$219 of remaining |
| 4 | 1,336 | 1,336 | $100.11 | Final ~$100 — finished list |

### Product-relevant capabilities built

- Conservative paced batch sender (Starter-safe)
- Contact validate / dedupe / destination summary (`prepare`)
- Resume-safe tracking: `sent.csv` + `remaining.csv` (no double-sends)
- Sandbox dry-run + `--limit=N` partial campaigns
- Analytics pipeline: poll Sent message status → HTML dashboard + CSV
- Client-facing report: `analytics-report.html`

### Repo PRs / branch

- Branch: `cursor/analytics-report-70b5` (includes prepare, tracking, analytics, this handover)
- Related PRs: sentdm `#2` (prepare/send), `#3` (analytics)
- Prior integration: PR `#1` Sent.dm connect / test / batch

---

## 3. Economics (real numbers — use these)

### Unit cost (Bahamas, corrected by Sent sales)

| Component | Amount |
|---|---|
| SMS pass-through (BS) | **$0.06 / msg** (website calculator was outdated at ~$0.03) |
| Sent platform fee | **$0.015 / contact messaged / month** |
| **All-in** | **~$0.075 / send** |

Observed API totals matched this closely:

- Carrier / message fees: **$1,213.94**
- Platform fees: **$303.09**
- Combined: **$1,517.03** for 20,256 msgs

### Proposed kemis list price: **$0.10 / send**

For this Bahamas-class traffic:

| | Per send | On 20,256 |
|---|---|---|
| Cost (Sent) | $0.075 | $1,519 |
| Kemis price | **$0.10** | **$2,026** |
| Gross margin | **$0.025 (25%)** | **~$507** |

**Verdict:** 10¢ is a solid **Caribbean / high-cost destination list price**. It leaves room for Sent.dm + kemis margin without being greedy on this corridor.

### Do not use flat 10¢ globally

| Destination class | Typical pass-through (order of magnitude) | Flat 10¢ effect |
|---|---|---|
| US / Canada SMS | ~$0.003–$0.01 + $0.015 platform | Very high kemis margin — fine as premium, but quote carefully |
| Bahamas / similar | ~$0.06 + $0.015 | Healthy ~25% margin at 10¢ |
| Expensive intl corridors | can exceed $0.06–$0.10+ | 10¢ can be **underwater** |

**Recommended kemis pricing model**

1. **Default list price:** $0.10/send for BS / Caribbean-like destinations  
2. **Floor price:** `provider_pass_through + provider_platform + kemis_margin`  
   - Target kemis margin: **+$0.02 to +$0.03** per send minimum  
3. **Enterprise quotes:** always compute from **destination mix** of the uploaded list, never a single global rate  
4. **Buffer:** quote with 10–20% contingency for rate changes (Sent warned BS moved $0.03 → $0.06)

Example floor for Bahamas: `0.06 + 0.015 + 0.025 = $0.10` (matches list price).

---

## 4. Architecture to reuse

### Stack (this repo)

- Node / TypeScript (`tsx`)
- Official SDK: `@sentdm/sentdm`
- Env: `SENT_DM_API_KEY` (never commit)
- Optional: `SENT_DM_TEMPLATE_ID`, `SENT_DM_BATCH_SIZE`, `SENT_DM_BATCH_DELAY_MS`

### Scripts

| Script | Purpose |
|---|---|
| `npm run connect` | List templates; verify selected template |
| `npm run prepare` | Validate list, dedupe stats, duration / top-up estimate |
| `npm run send-test` | Sandbox + live single-number test |
| `npm run send-batch` | Paced bulk send |
| `npm run analytics:fetch` | Poll `GET /v3/messages/{id}` → `analytics-cache.jsonl` (resumable) |
| `npm run analytics:report` | Build `analytics-report.html` + `.csv` |

### Send safety defaults (proved in production)

- Batch size: **50**
- Delay: **60s** (~50 recipients/min; under Sent Starter **60 msg/min**)
- Idempotency key per batch: `campaign-{ts}-{batchNumber}`
- `--dry-run` → `sandbox: true`
- 429 backoff
- After every batch: rewrite `sent.csv` / `remaining.csv`
- Skip phones already in `sent.csv` on resume

### Key source files

- [`src/send-batch.ts`](src/send-batch.ts) — live sender + tracking
- [`src/contacts.ts`](src/contacts.ts) — normalize / dedupe / estimates
- [`src/prepare.ts`](src/prepare.ts) — pre-flight for clients
- [`src/analytics-fetch.ts`](src/analytics-fetch.ts) — cost/status poller (~180 req/min)
- [`src/analytics-report.ts`](src/analytics-report.ts) — client HTML/CSV
- [`analytics-report.html`](analytics-report.html) — latest full-campaign dashboard

### Data flow

```text
CSV upload
  → prepare (validate, dedupe, quote)
  → fund / top-up
  → send-batch (paced, tracked)
  → campaign logs (phone + message_id)
  → analytics:fetch (status, price, platform fee)
  → analytics:report (HTML + CSV for client)
```

---

## 5. Sent.dm constraints (product must handle)

1. **No template analytics page** — Sent said it’s under construction. Volume / deliverability / per-message cost live under **Activities**. We built our own report; kemis should keep this as a first-class feature.
2. **Platform fee is not API-only** — $0.015/contact/month applies whether you send via API or dashboard.
3. **WhatsApp / Smart Router** — Sent onboarding often expects a WhatsApp Business Account for Smart Router. SMS can proceed without WA if they waive after fraud checks. This campaign was **SMS-only**.
4. **Out of balance** — v3 accepts sends with `202` but finalizes as `BLOCKED` (not charged). Product must size `--limit` to balance and leave buffer.
5. **Rate tiers** — Starter ~60 msg/min; Growth ~300. Pace accordingly. Max ~1000 recipients/request; we used 50 for safety.
6. **Published web rates can lag** — always confirm destination rates with Sent (or a live sample) before enterprise quotes.
7. **Templates must be APPROVED** — this campaign used marketing template  
   `c301f30e-534b-4d5a-bf10-ca51657cfa52` (“NHI annual physical + promo (full link)”), channels: sms, whatsapp.
8. **Contacts auto-created** — sending creates Contacts in Sent. Dashboard Contacts ≠ leftover list; kemis must keep its own sent/remaining ledger.

---

## 6. Product MVP for kemis.email

Ship this loop as the first sellable product:

1. **Upload** — CSV/JSON contacts (E.164)
2. **Validate** — normalize, dedupe, invalid count, destination mix
3. **Quote** — destination-aware price (default $0.10 for Caribbean-like); show cost floor + kemis margin
4. **Fund** — client prepaid balance or invoice; map to provider top-up
5. **Approve template** — compliance / content gate before live
6. **Send** — paced batches, idempotency, pause/resume, do-not-resend
7. **Report** — white-label HTML dashboard + CSV (deliverability, spend, by-run, timeline)
8. **Admin** — API keys, templates, rate card, campaign history

### Suggested kemis packaging

- **Product name:** Kemis Bulk Reach (or similar under kemis.email)
- **Positioning:** Compliant high-volume SMS for enterprises — upload, quote, send, prove
- **Proof point from this pilot:** 20,256 Bahamas SMS, 100% delivered, full cost transparency
- **Retail:** $0.10/send Caribbean default; custom quotes for mixed destinations
- **Moat:** pacing + resume + analytics (Sent doesn’t ship template analytics yet)

---

## 7. Checklist for the kemis.email agent

Copy this into the kemis repo and execute:

- [ ] Create product module: list upload → validate → quote → campaign
- [ ] Port / reimplement pacing sender with sent/remaining ledger (do not rely on provider Contacts alone)
- [ ] Build destination rate card table (start with BS @ $0.10 list; compute floor from provider rates)
- [ ] White-label the analytics HTML (kemis branding, client name, campaign name)
- [ ] Store `message_id` per recipient for audit + report refresh
- [ ] Env/secrets pattern: provider API key server-side only
- [ ] Template approval workflow before first live send
- [ ] Balance guard: refuse live send if `quoted_cost * 1.05 > available_balance`
- [ ] Dry-run / sandbox path for demos
- [ ] Ops runbook: top-up, resume from remaining, regenerate report
- [ ] Legal/compliance: STOP/HELP, marketing consent, Bahamas/local rules
- [ ] Do **not** commit raw phone lists or API keys

### Env reference (Sent pilot)

```bash
SENT_DM_API_KEY=...
SENT_DM_TEMPLATE_ID=c301f30e-534b-4d5a-bf10-ca51657cfa52
SENT_DM_BATCH_SIZE=50
SENT_DM_BATCH_DELAY_MS=60000
```

### Useful commands (this repo)

```bash
npm run prepare -- "contacts.csv"
npm run send-batch -- "contacts.csv" --dry-run --limit=5
npm run send-batch -- "contacts.csv" --limit=12000
npm run send-batch -- remaining.csv
npm run analytics:fetch
npm run analytics:report
```

---

## 8. Links & artifacts

| Item | Location |
|---|---|
| This pilot repo | https://github.com/salutethegenius/sentdm |
| Analytics PR | https://github.com/salutethegenius/sentdm/pull/3 |
| Client report (pull branch) | `analytics-report.html` on `cursor/analytics-report-70b5` |
| Sent docs | https://docs.sent.dm |
| Sent pricing | https://www.sent.dm/en/pricing |
| Sent rate limits | https://docs.sent.dm/reference/api/rate-limits |
| Product home | https://kemis.email |

### Message status API (for reports)

- `GET /v3/messages/{id}` → `status`, `channel`, `price`, `active_contact_price`, `created_at`, `events`
- No server-side filter by campaign/template — save IDs at send time (as we did in campaign logs)

---

## 9. One-paragraph brief for the kemis agent

We ran a full production SMS campaign through Sent.dm to 20,256 unique Bahamas numbers with 100% deliverability at ~$0.075/msg all-in ($1,517 total). We built paced sending, resume tracking, and a client analytics report because Sent lacks template analytics. Productize this under kemis.email: upload → destination-aware quote → fund → paced send → white-label report. Default retail **$0.10/send** for Caribbean-like traffic (~25% margin); never quote a flat global 10¢ without checking destination mix.

---

*End of handover. Open this file in the kemis.email repo and continue product implementation there.*
