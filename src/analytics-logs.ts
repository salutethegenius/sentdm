import fs from 'fs/promises';
import path from 'path';

export interface LoggedMessage {
  campaign: string;
  phone: string;
  messageId: string;
  sourceLog: string;
}

export interface CachedMessage {
  message_id: string;
  campaign: string;
  phone: string;
  status: string | null;
  channel: string | null;
  price: number | null;
  active_contact_price: number | null;
  total_cost: number | null;
  created_at: string | null;
  template_id: string | null;
  template_name: string | null;
  region_code: string | null;
  delivered_at: string | null;
  error: string | null;
  fetched_at: string;
}

const PHONE_LINE =
  /^phone=(\+[0-9]+)\s+message_id=([0-9a-fA-F-]{36})\s*$/;

export async function parseCampaignLog(filePath: string): Promise<LoggedMessage[]> {
  const raw = await fs.readFile(filePath, 'utf-8');
  const lines = raw.split(/\r?\n/);
  let campaign = path.basename(filePath, '.log');

  for (const line of lines.slice(0, 20)) {
    if (line.startsWith('Campaign: ')) {
      campaign = line.slice('Campaign: '.length).trim();
      break;
    }
  }

  const out: LoggedMessage[] = [];
  for (const line of lines) {
    const match = line.match(PHONE_LINE);
    if (!match) continue;
    out.push({
      campaign,
      phone: match[1],
      messageId: match[2],
      sourceLog: path.basename(filePath),
    });
  }
  return out;
}

export async function parseAllCampaignLogs(
  patterns: string[] = ['send-batch-campaign-*.log']
): Promise<LoggedMessage[]> {
  const files = new Set<string>();
  for (const pattern of patterns) {
    // Only support simple prefix/suffix glob used in this repo.
    if (pattern.includes('*')) {
      const [prefix, suffix] = pattern.split('*');
      const entries = await fs.readdir(process.cwd());
      for (const name of entries) {
        if (name.startsWith(prefix) && name.endsWith(suffix)) {
          files.add(name);
        }
      }
    } else {
      files.add(pattern);
    }
  }

  const sorted = [...files].sort();
  const all: LoggedMessage[] = [];
  for (const file of sorted) {
    const rows = await parseCampaignLog(file);
    all.push(...rows);
  }

  // Dedupe by message_id (keep first).
  const seen = new Set<string>();
  const unique: LoggedMessage[] = [];
  for (const row of all) {
    if (seen.has(row.messageId)) continue;
    seen.add(row.messageId);
    unique.push(row);
  }
  return unique;
}
