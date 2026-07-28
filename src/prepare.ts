import fs from 'fs/promises';
import {
  DEFAULT_CONTACTS_FILE,
  estimateCampaign,
  readContacts,
  summarizeDestinations,
} from './contacts.ts';
import { DEFAULT_BATCH_DELAY_MS, DEFAULT_BATCH_SIZE, TEMPLATE_ID } from './config.ts';

const PLATFORM_FEE_PER_CONTACT = 0.015;

async function main() {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const filePath = positional[0] ?? DEFAULT_CONTACTS_FILE;
  const batchSize = Number(process.env.SENT_DM_BATCH_SIZE ?? DEFAULT_BATCH_SIZE);
  const batchDelayMs = Number(process.env.SENT_DM_BATCH_DELAY_MS ?? DEFAULT_BATCH_DELAY_MS);
  const writeClean = process.argv.includes('--write-clean');

  console.log(`Preparing contact list: ${filePath}`);
  const { phones, rawCount, invalidCount, duplicateCount } = await readContacts(filePath, {
    dedupe: true,
  });

  const destinations = summarizeDestinations(phones);
  const configured = estimateCampaign({
    total: phones.length,
    batchSize,
    batchDelayMs,
    messagesPerMinute: 60,
  });
  const starterFloor = estimateCampaign({
    total: phones.length,
    batchSize: 50,
    batchDelayMs: 60_000,
    messagesPerMinute: 60,
  });
  const growthFloor = estimateCampaign({
    total: phones.length,
    batchSize: 100,
    batchDelayMs: 20_000,
    messagesPerMinute: 300,
  });

  const platformFee = phones.length * PLATFORM_FEE_PER_CONTACT;

  console.log('\nList validation');
  console.log(`  Raw rows:     ${rawCount}`);
  console.log(`  Unique:       ${phones.length}`);
  console.log(`  Duplicates:   ${duplicateCount}`);
  console.log(`  Invalid:      ${invalidCount}`);
  console.log(`  Template:     ${TEMPLATE_ID}`);
  console.log(`  Batch size:   ${batchSize}`);
  console.log(`  Batch delay:  ${batchDelayMs}ms`);

  console.log('\nDestinations');
  for (const [dest, count] of Object.entries(destinations).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${dest}: ${count}`);
  }

  console.log('\nSend estimate');
  console.log(`  Batches (current settings): ${configured.batches}`);
  console.log(
    `  Current pacing:             ~${configured.estimatedMinutes} min (~${configured.effectivePerMinute}/min)`
  );
  console.log(`  Starter-safe floor:         ~${starterFloor.estimatedMinutes} min`);
  console.log(
    `  Growth-optimized (if tier):  ~${growthFloor.estimatedMinutes} min (batch 100 / 20s delay)`
  );

  console.log('\nTop-up guidance');
  console.log(`  Platform fee (~$${PLATFORM_FEE_PER_CONTACT}/contact): ~$${platformFee.toFixed(2)}`);
  console.log('  Carrier pass-through: charged separately by destination.');
  console.log('  These numbers are Bahamas (+1242) — check Sent.dm dashboard rates before topping up.');
  console.log('  Tip: add a buffer (e.g. 20–30%) above the dashboard estimate.');

  console.log('\nReady when funded');
  console.log('  1) Top up in the Sent.dm dashboard');
  console.log(`  2) Dry-run:  npm run send-batch -- "${filePath}" --dry-run`);
  console.log(`  3) Live:     npm run send-batch -- "${filePath}"`);
  console.log('  Do not run live until you explicitly confirm after topping up.');

  if (writeClean) {
    const outPath = 'contacts.unique.csv';
    await fs.writeFile(outPath, ['phone_number', ...phones].join('\n') + '\n', 'utf-8');
    console.log(`\nWrote deduped list to ${outPath} (${phones.length} numbers)`);
  }

  if (phones.length === 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Prepare failed:', err.message ?? err);
  process.exit(1);
});
