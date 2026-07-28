import fs from 'fs/promises';
import SentDm from '@sentdm/sentdm';
import { getApiKey, TEMPLATE_ID, DEFAULT_BATCH_SIZE, DEFAULT_BATCH_DELAY_MS } from './config.ts';
import { DEFAULT_CONTACTS_FILE, readContacts } from './contacts.ts';

const client = new SentDm({ apiKey: getApiKey() });

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendBatch(
  batch: string[],
  batchNumber: number,
  campaignId: string,
  dryRun: boolean
): Promise<{ accepted: number; failed: number; ids: string[] }> {
  console.log(`\nBatch ${batchNumber}: ${batch.length} recipient(s)${dryRun ? ' (sandbox)' : ''}`);

  try {
    const response = await client.messages.send(
      {
        to: batch,
        template: { id: TEMPLATE_ID, parameters: {} },
        sandbox: dryRun,
      },
      {
        idempotencyKey: `${campaignId}-${batchNumber}`,
      }
    );

    const recipients = response.data?.recipients ?? [];
    const ids = recipients.map((r) => r.message_id);
    console.log(`  Accepted: ${recipients.length}`);
    return { accepted: recipients.length, failed: 0, ids };
  } catch (err) {
    console.error(`  Batch ${batchNumber} failed:`, (err as any).message ?? err);
    if (err instanceof SentDm.APIError) {
      console.error('  Status:', err.status);
      console.error('  Response:', err.response);

      // Back off on rate limits before caller continues.
      if (err.status === 429) {
        const retryAfterHeader = (err as any).headers?.['retry-after'];
        const retryAfterSec = Number(retryAfterHeader ?? 60);
        console.log(`  Rate limited. Waiting ${retryAfterSec}s...`);
        await sleep(retryAfterSec * 1000);
      }
    }
    return { accepted: 0, failed: batch.length, ids: [] };
  }
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const filePath = args[0] ?? DEFAULT_CONTACTS_FILE;
  const dryRun = process.argv.includes('--dry-run');
  const keepDupes = process.argv.includes('--keep-dupes');
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;
  const batchSize = Number(process.env.SENT_DM_BATCH_SIZE ?? DEFAULT_BATCH_SIZE);
  const batchDelayMs = Number(process.env.SENT_DM_BATCH_DELAY_MS ?? DEFAULT_BATCH_DELAY_MS);
  const campaignId = `campaign-${Date.now()}`;

  if (!filePath) {
    console.error(
      'Usage: npm run send-batch -- [path-to-contacts.csv|json] [--dry-run] [--keep-dupes] [--limit=N]'
    );
    process.exit(1);
  }

  const { phones: allPhones, rawCount, invalidCount, duplicateCount } = await readContacts(
    filePath,
    { dedupe: !keepDupes }
  );
  const phones = typeof limit === 'number' && Number.isFinite(limit) ? allPhones.slice(0, limit) : allPhones;

  console.log(`Loaded from ${filePath}`);
  console.log(`  Raw rows: ${rawCount}`);
  console.log(`  Unique valid: ${allPhones.length}`);
  console.log(`  Duplicates removed: ${duplicateCount}`);
  console.log(`  Invalid skipped: ${invalidCount}`);
  if (limit) console.log(`  Sending limit: ${phones.length}`);
  console.log(`  Mode: ${dryRun ? 'DRY-RUN (sandbox)' : 'LIVE'}`);

  if (phones.length === 0) {
    console.error('No valid phone numbers found. Aborting.');
    process.exit(1);
  }

  const logPath = `send-batch-${campaignId}.log`;
  const logLines: string[] = [
    `Campaign: ${campaignId}`,
    `Template: ${TEMPLATE_ID}`,
    `Dry run: ${dryRun}`,
    `Source: ${filePath}`,
    `Total contacts: ${phones.length}`,
    `Batch size: ${batchSize}`,
    `Batch delay: ${batchDelayMs}ms`,
    '---',
  ];

  let totalAccepted = 0;
  let totalFailed = 0;
  let batchNumber = 1;

  for (let i = 0; i < phones.length; i += batchSize) {
    const batch = phones.slice(i, i + batchSize);
    const result = await sendBatch(batch, batchNumber, campaignId, dryRun);

    totalAccepted += result.accepted;
    totalFailed += result.failed;

    logLines.push(`batch=${batchNumber} accepted=${result.accepted} failed=${result.failed}`);
    for (const id of result.ids) {
      logLines.push(`message_id=${id}`);
    }

    batchNumber += 1;

    if (i + batchSize < phones.length) {
      console.log(`  Waiting ${batchDelayMs}ms before next batch...`);
      await sleep(batchDelayMs);
    }
  }

  logLines.push('---');
  logLines.push(`Summary: accepted=${totalAccepted} failed=${totalFailed}`);
  await fs.writeFile(logPath, logLines.join('\n') + '\n', 'utf-8');

  console.log(`\nCampaign complete: ${totalAccepted} accepted, ${totalFailed} failed.`);
  console.log(`Log written to ${logPath}`);
}

main().catch((err) => {
  console.error('Batch send failed:', err.message ?? err);
  process.exit(1);
});
