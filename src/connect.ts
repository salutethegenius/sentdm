import SentDm from '@sentdm/sentdm';
import { getApiKey, TEMPLATE_ID } from './config.ts';

async function main() {
  const client = new SentDm({ apiKey: getApiKey() });

  console.log('Listing Sent.dm templates...');
  const response = await client.templates.list({ page: 1, page_size: 100 });
  const templates = response.data?.templates ?? [];

  if (templates.length === 0) {
    console.log('No templates found in the account.');
    return;
  }

  console.log(`Found ${templates.length} template(s):`);
  for (const t of templates) {
    console.log(`  - ${t.name} (${t.status}): ${t.id} [channels: ${(t.channels ?? []).join(', ') || 'auto'}]`);
  }

  const selected = templates.find((t) => t.id === TEMPLATE_ID);
  if (!selected) {
    throw new Error(`Template ID ${TEMPLATE_ID} was not found in the account.`);
  }

  console.log(`\nSelected template is valid: ${selected.name} (${selected.status})`);
}

main().catch((err) => {
  console.error('Connection failed:', err.message ?? err);
  process.exit(1);
});
