import fs from 'fs/promises';
import path from 'path';

export const DEFAULT_CONTACTS_FILE = '25k - Sheet1.csv';

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^0-9+]/g, '');
  if (!digits.startsWith('+')) return null;
  if (!/^\+[1-9]\d{7,14}$/.test(digits)) return null;
  return digits;
}

export async function readContacts(
  filePath: string,
  options: { dedupe?: boolean } = {}
): Promise<{ phones: string[]; rawCount: number; invalidCount: number; duplicateCount: number }> {
  const dedupe = options.dedupe ?? true;
  const ext = path.extname(filePath).toLowerCase();
  const raw = await fs.readFile(filePath, 'utf-8');

  let candidates: string[] = [];

  if (ext === '.json') {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed)
      ? parsed
      : parsed.contacts ?? parsed.phoneNumbers ?? parsed.phone_numbers ?? [];
    candidates = list
      .map((item: unknown) =>
        typeof item === 'string' ? item : (item as any).phone_number ?? (item as any).phone ?? null
      )
      .filter(Boolean) as string[];
  } else {
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const header = lines[0]?.toLowerCase() ?? '';
    const hasHeader =
      header.includes('phone') || header.includes('number') || header.includes('contact');
    const dataLines = hasHeader ? lines.slice(1) : lines;

    candidates = dataLines.map((line) => line.split(',')[0]?.trim() ?? '');
  }

  const rawCount = candidates.length;
  const normalized: string[] = [];
  let invalidCount = 0;

  for (const candidate of candidates) {
    const phone = normalizePhone(candidate);
    if (!phone) {
      invalidCount += 1;
      continue;
    }
    normalized.push(phone);
  }

  if (!dedupe) {
    return { phones: normalized, rawCount, invalidCount, duplicateCount: 0 };
  }

  const seen = new Set<string>();
  const phones: string[] = [];
  let duplicateCount = 0;

  for (const phone of normalized) {
    if (seen.has(phone)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(phone);
    phones.push(phone);
  }

  return { phones, rawCount, invalidCount, duplicateCount };
}

export function summarizeDestinations(phones: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const phone of phones) {
    // +1NANP style country/area: treat +1242 as Bahamas NANP
    const prefix = phone.startsWith('+1242')
      ? '+1242 (Bahamas)'
      : phone.startsWith('+1')
        ? '+1 (NANP)'
        : phone.slice(0, 3);
    counts[prefix] = (counts[prefix] ?? 0) + 1;
  }
  return counts;
}

export function estimateCampaign(params: {
  total: number;
  batchSize: number;
  batchDelayMs: number;
  messagesPerMinute: number;
}) {
  const { total, batchSize, batchDelayMs, messagesPerMinute } = params;
  const batches = Math.ceil(total / batchSize);
  const configuredMinutes =
    ((batches - 1) * batchDelayMs) / 60_000 + (batches * 0.5) / 60;
  const tierMinutes = total / messagesPerMinute;
  // Duration is whichever is slower: configured delay pacing or account tier cap.
  const estimatedMinutes = Math.max(configuredMinutes, tierMinutes);

  return {
    batches,
    estimatedMinutes: Number(estimatedMinutes.toFixed(1)),
    configuredMinutes: Number(configuredMinutes.toFixed(1)),
    tierMinutes: Number(tierMinutes.toFixed(1)),
    effectivePerMinute: Number((total / Math.max(estimatedMinutes, 0.1)).toFixed(1)),
  };
}
