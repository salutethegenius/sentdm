export function getApiKey(): string {
  const key = process.env.SENT_DM_API_KEY;
  if (!key) {
    throw new Error(
      'SENT_DM_API_KEY is not set. Set it in your environment before running any script.'
    );
  }
  return key;
}

export const TEMPLATE_ID = process.env.SENT_DM_TEMPLATE_ID ?? 'c301f30e-534b-4d5a-bf10-ca51657cfa52';
export const TEST_PHONE = process.env.SENT_DM_TEST_PHONE ?? '+12424479692';
// Starter tier is ~60 messages/min. Default pacing stays under that.
export const DEFAULT_BATCH_SIZE = Number(process.env.SENT_DM_BATCH_SIZE ?? 50);
export const DEFAULT_BATCH_DELAY_MS = Number(process.env.SENT_DM_BATCH_DELAY_MS ?? 60_000);
