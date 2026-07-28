import fs from 'fs/promises';
import path from 'path';
import SentDm from '@sentdm/sentdm';
import { getApiKey, TEMPLATE_ID, DEFAULT_BATCH_SIZE, DEFAULT_BATCH_DELAY_MS } from './config.ts';

const client = new SentDm({ apiKey: getApiKey() });

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^0-9+]/g, '');
  if (!digits.startsWith('+')) return null;
  return digits;
}

async function readContacts(filePath: string): Promise<string[]> {
  const ext = path.extname(filePath).toLowerCase();
  const raw = await fs.readFile(filePath, 'utf-8');

  if (ext === '.json') {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed.contacts ?? parsed.phoneNumbers ?? parsed.phone_numbers ?? [];
    return list
      .map((item: unknown) => (typeof item === 'string' ? item : (item as any).phone_number ?? (item as any).phone ?? null))
      .filter(Boolean) as string[];
  }

  // Treat everything else as CSV-ish: first column is phone number.
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const header = lines[0].toLowerCase();
  const hasHeader = header.includes('phone') || header.includes('number') || header.includes('contact');
  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dataLines
    .map((line) => {
      const firstCell = line.split(',')[0]?.trim() ?? '';
      return normalizePhone(firstCell);
    })
    .filter((phone): phone is string => phone !== null);
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
    }
    return { accepted: 0, failed: batch.length, ids: [] };
  }
}

async function main() {
  const filePath = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  const batchSize = Number(process.env.SENT_DM_BATCH_SIZE ?? DEFAULT_BATCH_SIZE);
  const batchDelayMs = Number(process.env.SENT_DM_BATCH_DELAY_MS ?? DEFAULT_BATCH_DELAY_MS);
  const campaignId = `campaign-${Date.now()}`;

  if (!filePath) {
    console.error('Usage: npm run send-batch -- <path-to-contacts.csv|json> [--dry-run]');
    process.exit(1);
  }

  const phones = await readContacts(filePath);
  console.log(`Loaded ${phones.length} valid phone number(s) from ${filePath}`);
  if (phones.length === 0) {
    console.error('No valid phone numbers found. Aborting.');
    process.exit(1);
  }

  const logPath = `send-batch-${campaignId}.log`;
  const logLines: string[] = [
    `Campaign: ${campaignId}`,
    `Template: ${TEMPLATE_ID}`,
    `Dry run: ${dryRun}`,
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
