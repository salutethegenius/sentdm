import fs from 'fs/promises';
import path from 'path';
import SentDm from '@sentdm/sentdm';
import { getApiKey, TEMPLATE_ID, DEFAULT_BATCH_SIZE, DEFAULT_BATCH_DELAY_MS } from './config.ts';
import { DEFAULT_CONTACTS_FILE, normalizePhone, readContacts } from './contacts.ts';

const client = new SentDm({ apiKey: getApiKey() });

const DEFAULT_SENT_FILE = 'sent.csv';
const DEFAULT_REMAINING_FILE = 'remaining.csv';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadSentSet(sentPath: string): Promise<Set<string>> {
  if (!(await fileExists(sentPath))) return new Set();
  const { phones } = await readContacts(sentPath, { dedupe: true });
  return new Set(phones);
}

async function writePhoneCsv(filePath: string, phones: string[]) {
  await fs.writeFile(filePath, ['phone_number', ...phones].join('\n') + '\n', 'utf-8');
}

async function sendBatch(
  batch: string[],
  batchNumber: number,
  campaignId: string,
  dryRun: boolean
): Promise<{ accepted: number; failed: number; phones: string[]; ids: string[] }> {
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
    const ids = recipients.map((r) => r.message_id).filter(Boolean) as string[];
    const phonesFromResponse = recipients
      .map((r) => (r.to ? normalizePhone(r.to) : null))
      .filter((p): p is string => p !== null);

    // Prefer explicit recipient phones; fall back to full batch if counts match.
    const phones =
      phonesFromResponse.length > 0
        ? phonesFromResponse
        : recipients.length === batch.length
          ? batch
          : [];

    console.log(`  Accepted: ${recipients.length}`);
    return { accepted: recipients.length, failed: batch.length - recipients.length, phones, ids };
  } catch (err) {
    console.error(`  Batch ${batchNumber} failed:`, (err as any).message ?? err);
    if (err instanceof SentDm.APIError) {
      console.error('  Status:', err.status);
      console.error('  Response:', err.response);

      if (err.status === 429) {
        const retryAfterHeader = (err as any).headers?.['retry-after'];
        const retryAfterSec = Number(retryAfterHeader ?? 60);
        console.log(`  Rate limited. Waiting ${retryAfterSec}s...`);
        await sleep(retryAfterSec * 1000);
      }
    }
    return { accepted: 0, failed: batch.length, phones: [], ids: [] };
  }
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const filePath = args[0] ?? DEFAULT_CONTACTS_FILE;
  const dryRun = process.argv.includes('--dry-run');
  const keepDupes = process.argv.includes('--keep-dupes');
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;
  const sentPath =
    process.argv.find((a) => a.startsWith('--sent-file='))?.split('=')[1] ?? DEFAULT_SENT_FILE;
  const remainingPath =
    process.argv
      .find((a) => a.startsWith('--remaining-file='))
      ?.split('=')[1] ?? DEFAULT_REMAINING_FILE;
  const batchSize = Number(process.env.SENT_DM_BATCH_SIZE ?? DEFAULT_BATCH_SIZE);
  const batchDelayMs = Number(process.env.SENT_DM_BATCH_DELAY_MS ?? DEFAULT_BATCH_DELAY_MS);
  const campaignId = `campaign-${Date.now()}`;

  if (!filePath) {
    console.error(
      'Usage: npm run send-batch -- [contacts.csv] [--dry-run] [--keep-dupes] [--limit=N] [--sent-file=sent.csv] [--remaining-file=remaining.csv]'
    );
    process.exit(1);
  }

  const previouslySent = await loadSentSet(sentPath);
  const { phones: allPhones, rawCount, invalidCount, duplicateCount } = await readContacts(
    filePath,
    { dedupe: !keepDupes }
  );

  const eligible = allPhones.filter((phone) => !previouslySent.has(phone));
  const skippedAlreadySent = allPhones.length - eligible.length;
  const phones =
    typeof limit === 'number' && Number.isFinite(limit) ? eligible.slice(0, limit) : eligible;

  console.log(`Loaded from ${filePath}`);
  console.log(`  Raw rows: ${rawCount}`);
  console.log(`  Unique valid: ${allPhones.length}`);
  console.log(`  Duplicates removed: ${duplicateCount}`);
  console.log(`  Invalid skipped: ${invalidCount}`);
  console.log(`  Already sent (skipped): ${skippedAlreadySent} from ${sentPath}`);
  console.log(`  Eligible remaining: ${eligible.length}`);
  if (limit) console.log(`  Sending limit this run: ${phones.length}`);
  console.log(`  Mode: ${dryRun ? 'DRY-RUN (sandbox)' : 'LIVE'}`);
  console.log(`  Tracking: ${sentPath} / ${remainingPath}`);

  if (phones.length === 0) {
    console.error('No eligible phone numbers to send. Aborting.');
    process.exit(1);
  }

  const logPath = `send-batch-${campaignId}.log`;
  const logLines: string[] = [
    `Campaign: ${campaignId}`,
    `Template: ${TEMPLATE_ID}`,
    `Dry run: ${dryRun}`,
    `Source: ${filePath}`,
    `Sent file: ${sentPath}`,
    `Remaining file: ${remainingPath}`,
    `Total this run: ${phones.length}`,
    `Batch size: ${batchSize}`,
    `Batch delay: ${batchDelayMs}ms`,
    '---',
  ];

  const sentThisRun: string[] = [];
  const sentAll = new Set(previouslySent);
  let totalAccepted = 0;
  let totalFailed = 0;
  let batchNumber = 1;

  const persistProgress = async () => {
    const sentList = [...sentAll];
    // Remaining = full unique source list minus everyone ever marked sent.
    const remaining = allPhones.filter((phone) => !sentAll.has(phone));
    // Also include eligible-not-yet-in-source edge cases by subtracting from master unique set.
    await writePhoneCsv(sentPath, sentList);
    await writePhoneCsv(remainingPath, remaining);
  };

  for (let i = 0; i < phones.length; i += batchSize) {
    const batch = phones.slice(i, i + batchSize);
    const result = await sendBatch(batch, batchNumber, campaignId, dryRun);

    totalAccepted += result.accepted;
    totalFailed += result.failed;

    for (const phone of result.phones) {
      sentThisRun.push(phone);
      sentAll.add(phone);
    }

    // Persist after every batch so a crash still leaves accurate leftovers.
    await persistProgress();

    logLines.push(
      `batch=${batchNumber} accepted=${result.accepted} failed=${result.failed} sent_phones=${result.phones.length}`
    );
    for (let idx = 0; idx < result.phones.length; idx++) {
      logLines.push(`phone=${result.phones[idx]} message_id=${result.ids[idx] ?? ''}`);
    }

    batchNumber += 1;

    if (i + batchSize < phones.length) {
      console.log(`  Waiting ${batchDelayMs}ms before next batch...`);
      await sleep(batchDelayMs);
    }
  }

  await persistProgress();

  logLines.push('---');
  logLines.push(`Summary: accepted=${totalAccepted} failed=${totalFailed}`);
  logLines.push(`Sent this run: ${sentThisRun.length}`);
  logLines.push(`Sent total tracked: ${sentAll.size}`);
  await fs.writeFile(logPath, logLines.join('\n') + '\n', 'utf-8');

  const remainingCount = allPhones.filter((phone) => !sentAll.has(phone)).length;
  console.log(`\nCampaign complete: ${totalAccepted} accepted, ${totalFailed} failed.`);
  console.log(`Sent this run: ${sentThisRun.length}`);
  console.log(`Sent total tracked: ${sentAll.size} → ${path.resolve(sentPath)}`);
  console.log(`Remaining: ${remainingCount} → ${path.resolve(remainingPath)}`);
  console.log(`Log written to ${logPath}`);
}

main().catch((err) => {
  console.error('Batch send failed:', err.message ?? err);
  process.exit(1);
});
