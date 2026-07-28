import SentDm from '@sentdm/sentdm';
import { getApiKey, TEMPLATE_ID, TEST_PHONE } from './config.ts';

const client = new SentDm({ apiKey: getApiKey() });

async function sendSandbox(phone: string, templateId: string) {
  console.log(`\n[SANDBOX] Validating send to ${phone}...`);
  const response = await client.messages.send({
    to: [phone],
    template: {
      id: templateId,
      parameters: {},
    },
    sandbox: true,
  });
  console.log('Sandbox response:', response.data);
  return response;
}

async function sendReal(phone: string, templateId: string) {
  console.log(`\n[REAL] Sending live message to ${phone}...`);
  const response = await client.messages.send({
    to: [phone],
    template: {
      id: templateId,
      parameters: {},
    },
  }, {
    idempotencyKey: `test-${phone}-${Date.now()}`,
  });
  console.log('Live response:', response.data);
  return response;
}

async function main() {
  await sendSandbox(TEST_PHONE, TEMPLATE_ID);
  await sendReal(TEST_PHONE, TEMPLATE_ID);
  console.log('\nTest sequence complete.');
}

main().catch((err) => {
  console.error('Send test failed:', err.message ?? err);
  if (err instanceof SentDm.APIError) {
    console.error('Status:', err.status);
    console.error('Body:', err.response);
  }
  process.exit(1);
});
