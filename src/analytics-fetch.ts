import fs from 'fs/promises';
import SentDm from '@sentdm/sentdm';
import { getApiKey } from './config.ts';
import {
  parseAllCampaignLogs,
  type CachedMessage,
  type LoggedMessage,
} from './analytics-logs.ts';

const CACHE_PATH = 'analytics-cache.jsonl';
const TARGET_RPM = Number(process.env.ANALYTICS_RPM ?? 180);
const MIN_INTERVAL_MS = Math.ceil(60_000 / TARGET_RPM);
const CONCURRENCY = Number(process.env.ANALYTICS_CONCURRENCY ?? 4);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadCachedIds(cachePath: string): Promise<Set<string>> {
  try {
    const raw = await fs.readFile(cachePath, 'utf-8');
    const ids = new Set<string>();
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as CachedMessage;
        if (row.message_id && !row.error) ids.add(row.message_id);
      } catch {
        // skip corrupt lines
      }
    }
    return ids;
  } catch {
    return new Set();
  }
}

async function appendCache(cachePath: string, row: CachedMessage) {
  await fs.appendFile(cachePath, JSON.stringify(row) + '\n', 'utf-8');
}

function extractDeliveredAt(events: Array<{ status: string; timestamp: string }> | null | undefined) {
  if (!events?.length) return null;
  const delivered = events.find((e) => e.status === 'DELIVERED');
  return delivered?.timestamp ?? null;
}

async function fetchOne(
  client: SentDm,
  item: LoggedMessage
): Promise<CachedMessage> {
  const fetchedAt = new Date().toISOString();
  try {
    const response = await client.messages.retrieveStatus(item.messageId);
    const data = response.data;
    const price = data?.price ?? null;
    const active = data?.active_contact_price ?? null;
    const total =
      price == null && active == null
        ? null
        : Number(((price ?? 0) + (active ?? 0)).toFixed(6));

    return {
      message_id: item.messageId,
      campaign: item.campaign,
      phone: data?.phone ?? item.phone,
      status: data?.status ?? null,
      channel: data?.channel ?? null,
      price,
      active_contact_price: active,
      total_cost: total,
      created_at: data?.created_at ?? null,
      template_id: data?.template_id ?? null,
      template_name: data?.template_name ?? null,
      region_code: data?.region_code ?? null,
      delivered_at: extractDeliveredAt(data?.events ?? null),
      error: null,
      fetched_at: fetchedAt,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      message_id: item.messageId,
      campaign: item.campaign,
      phone: item.phone,
      status: null,
      channel: null,
      price: null,
      active_contact_price: null,
      total_cost: null,
      created_at: null,
      template_id: null,
      template_name: null,
      region_code: null,
      delivered_at: null,
      error: message,
      fetched_at: fetchedAt,
    };
  }
}

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;
  const retryErrors = process.argv.includes('--retry-errors');

  const client = new SentDm({ apiKey: getApiKey() });
  const all = await parseAllCampaignLogs();
  console.log(`Parsed ${all.length} message id(s) from campaign logs`);

  const cached = await loadCachedIds(CACHE_PATH);
  console.log(`Already cached (ok): ${cached.size}`);

  let pending = all.filter((row) => !cached.has(row.messageId));

  if (retryErrors) {
    // Re-fetch rows previously stored with errors by not skipping them —
    // loadCachedIds already excludes error rows, so they are in pending.
    console.log('Retry mode: will re-fetch previously failed ids');
  }

  if (typeof limit === 'number' && Number.isFinite(limit)) {
    pending = pending.slice(0, limit);
  }

  console.log(`Pending fetch: ${pending.length}`);
  console.log(`Rate target: ${TARGET_RPM}/min · concurrency ${CONCURRENCY}`);
  if (pending.length === 0) {
    console.log('Nothing to fetch.');
    return;
  }

  let completed = 0;
  let ok = 0;
  let failed = 0;
  let nextSlot = Date.now();
  const started = Date.now();

  async function worker(items: LoggedMessage[]) {
    for (const item of items) {
      const now = Date.now();
      const wait = Math.max(0, nextSlot - now);
      nextSlot = Math.max(nextSlot, now) + MIN_INTERVAL_MS;
      if (wait > 0) await sleep(wait);

      const row = await fetchOne(client, item);
      await appendCache(CACHE_PATH, row);

      completed += 1;
      if (row.error) failed += 1;
      else ok += 1;

      if (completed % 50 === 0 || completed === pending.length) {
        const elapsedMin = (Date.now() - started) / 60_000;
        const rate = completed / Math.max(elapsedMin, 0.001);
        const remaining = pending.length - completed;
        const etaMin = remaining / Math.max(rate, 0.001);
        console.log(
          `Progress ${completed}/${pending.length} ok=${ok} err=${failed} ~${rate.toFixed(0)}/min eta=${etaMin.toFixed(1)}m`
        );
      }

      // On 429-ish errors, back off harder.
      if (row.error && /429|rate/i.test(row.error)) {
        console.log('Rate limited — backing off 15s');
        await sleep(15_000);
      }
    }
  }

  const shards: LoggedMessage[][] = Array.from({ length: CONCURRENCY }, () => []);
  pending.forEach((item, i) => shards[i % CONCURRENCY].push(item));
  await Promise.all(shards.map((shard) => worker(shard)));

  console.log(`\nFetch complete: ok=${ok} err=${failed}`);
  console.log(`Cache: ${CACHE_PATH}`);
}

main().catch((err) => {
  console.error('Analytics fetch failed:', err.message ?? err);
  process.exit(1);
});
