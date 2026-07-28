# sentdm

Conservative Sent.dm bulk SMS sender for the `25k - Sheet1.csv` contact list.

## Setup

```bash
npm install
export SENT_DM_API_KEY=your_api_key_here
```

Optional overrides:

```bash
export SENT_DM_TEMPLATE_ID=c301f30e-534b-4d5a-bf10-ca51657cfa52
export SENT_DM_BATCH_SIZE=50
export SENT_DM_BATCH_DELAY_MS=60000
```

## Workflow

1. Validate the list and get top-up / duration estimates (no sends):

```bash
npm run prepare
# or: npm run prepare -- "25k - Sheet1.csv" --write-clean
```

2. Confirm account + template:

```bash
npm run connect
```

3. Optional single-number test:

```bash
npm run send-test
```

4. Sandbox dry-run (no live delivery):

```bash
npm run send-batch -- "25k - Sheet1.csv" --dry-run
# small sample: npm run send-batch -- "25k - Sheet1.csv" --dry-run --limit=5
```

5. Live send only after topping up and explicitly approving:

```bash
npm run send-batch -- "25k - Sheet1.csv"
```

Defaults dedupe numbers. Use `--keep-dupes` only if you intentionally want repeats.

## Safety defaults

- Batch size: 50
- Delay between batches: 60s (~50 recipients/min, under Starter 60/min)
- Idempotency keys per batch
- Sandbox mode via `--dry-run`
- 429 backoff when rate limited
