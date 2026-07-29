import fs from 'fs/promises';
import type { CachedMessage } from './analytics-logs.ts';

const CACHE_PATH = 'analytics-cache.jsonl';
const HTML_PATH = 'analytics-report.html';
const CSV_PATH = 'analytics-report.csv';

interface Summary {
  total: number;
  byStatus: Record<string, number>;
  byChannel: Record<string, number>;
  byCampaign: Record<
    string,
    { count: number; delivered: number; cost: number; failed: number }
  >;
  totalPrice: number;
  totalPlatform: number;
  totalCost: number;
  delivered: number;
  failed: number;
  fetchErrors: number;
  deliverabilityPct: number;
  avgCost: number;
  timeline: Array<{ hour: string; count: number; delivered: number }>;
  failures: CachedMessage[];
}

async function loadCache(cachePath: string): Promise<CachedMessage[]> {
  const raw = await fs.readFile(cachePath, 'utf-8');
  const byId = new Map<string, CachedMessage>();
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as CachedMessage;
      // Prefer latest successful fetch for each id.
      const prev = byId.get(row.message_id);
      if (!prev) {
        byId.set(row.message_id, row);
        continue;
      }
      if (prev.error && !row.error) {
        byId.set(row.message_id, row);
        continue;
      }
      if (row.fetched_at >= prev.fetched_at) {
        byId.set(row.message_id, row);
      }
    } catch {
      // skip
    }
  }
  return [...byId.values()];
}

function summarize(rows: CachedMessage[]): Summary {
  const byStatus: Record<string, number> = {};
  const byChannel: Record<string, number> = {};
  const byCampaign: Summary['byCampaign'] = {};
  const hourMap = new Map<string, { count: number; delivered: number }>();

  let totalPrice = 0;
  let totalPlatform = 0;
  let totalCost = 0;
  let delivered = 0;
  let failed = 0;
  let fetchErrors = 0;
  const failures: CachedMessage[] = [];

  for (const row of rows) {
    if (row.error) {
      fetchErrors += 1;
      continue;
    }

    const status = row.status ?? 'UNKNOWN';
    byStatus[status] = (byStatus[status] ?? 0) + 1;

    const channel = row.channel ?? 'unknown';
    byChannel[channel] = (byChannel[channel] ?? 0) + 1;

    const camp = byCampaign[row.campaign] ?? {
      count: 0,
      delivered: 0,
      cost: 0,
      failed: 0,
    };
    camp.count += 1;
    camp.cost += row.total_cost ?? 0;
    if (status === 'DELIVERED') {
      camp.delivered += 1;
      delivered += 1;
    }
    if (status === 'FAILED' || status === 'BLOCKED' || status === 'FILTERED') {
      camp.failed += 1;
      failed += 1;
      if (failures.length < 50) failures.push(row);
    }
    byCampaign[row.campaign] = camp;

    totalPrice += row.price ?? 0;
    totalPlatform += row.active_contact_price ?? 0;
    totalCost += row.total_cost ?? 0;

    if (row.created_at) {
      const hour = row.created_at.slice(0, 13) + ':00Z';
      const slot = hourMap.get(hour) ?? { count: 0, delivered: 0 };
      slot.count += 1;
      if (status === 'DELIVERED') slot.delivered += 1;
      hourMap.set(hour, slot);
    }
  }

  const countable = rows.length - fetchErrors;
  const deliverabilityPct = countable > 0 ? (delivered / countable) * 100 : 0;
  const avgCost = countable > 0 ? totalCost / countable : 0;

  const timeline = [...hourMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([hour, v]) => ({ hour, count: v.count, delivered: v.delivered }));

  return {
    total: rows.length,
    byStatus,
    byChannel,
    byCampaign,
    totalPrice,
    totalPlatform,
    totalCost,
    delivered,
    failed,
    fetchErrors,
    deliverabilityPct,
    avgCost,
    timeline,
    failures,
  };
}

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

function pct(n: number) {
  return `${n.toFixed(2)}%`;
}

function csvEscape(value: string | number | null | undefined) {
  const s = value == null ? '' : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsv(rows: CachedMessage[]): string {
  const header = [
    'message_id',
    'campaign',
    'phone',
    'status',
    'channel',
    'price',
    'active_contact_price',
    'total_cost',
    'created_at',
    'delivered_at',
    'template_name',
    'region_code',
    'error',
  ];
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.message_id,
        row.campaign,
        row.phone,
        row.status,
        row.channel,
        row.price,
        row.active_contact_price,
        row.total_cost,
        row.created_at,
        row.delivered_at,
        row.template_name,
        row.region_code,
        row.error,
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  return lines.join('\n') + '\n';
}

function buildHtml(summary: Summary, generatedAt: string): string {
  const statusRows = Object.entries(summary.byStatus)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([k, v]) =>
        `<tr><td>${k}</td><td>${v.toLocaleString()}</td><td>${pct((v / Math.max(summary.total - summary.fetchErrors, 1)) * 100)}</td></tr>`
    )
    .join('');

  const channelRows = Object.entries(summary.byChannel)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<tr><td>${k}</td><td>${v.toLocaleString()}</td></tr>`)
    .join('');

  const campaignRows = Object.entries(summary.byCampaign)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => {
      const deliv = v.count ? (v.delivered / v.count) * 100 : 0;
      return `<tr><td>${k}</td><td>${v.count.toLocaleString()}</td><td>${v.delivered.toLocaleString()}</td><td>${pct(deliv)}</td><td>${money(v.cost)}</td></tr>`;
    })
    .join('');

  const maxTimeline = Math.max(1, ...summary.timeline.map((t) => t.count));
  const timelineBars = summary.timeline
    .map((t) => {
      const h = Math.max(4, Math.round((t.count / maxTimeline) * 120));
      return `<div class="bar-wrap" title="${t.hour}: ${t.count}"><div class="bar" style="height:${h}px"></div><span>${t.hour.slice(11, 16)}</span></div>`;
    })
    .join('');

  const failureRows = summary.failures.length
    ? summary.failures
        .map(
          (f) =>
            `<tr><td>${f.phone}</td><td>${f.status ?? ''}</td><td>${f.message_id}</td><td>${f.created_at ?? ''}</td></tr>`
        )
        .join('')
    : `<tr><td colspan="4">No failed / blocked / filtered messages in cache.</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sent.dm Campaign Analytics</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet" />
<style>
  :root {
    --bg: #0f1419;
    --panel: #171e26;
    --line: #2a3441;
    --text: #e8eef5;
    --muted: #8b9aab;
    --accent: #3ecf8e;
    --warn: #f0b429;
    --danger: #ef6b6b;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "DM Sans", system-ui, sans-serif;
    background:
      radial-gradient(1200px 600px at 10% -10%, #1a2a22 0%, transparent 55%),
      radial-gradient(900px 500px at 100% 0%, #1a2230 0%, transparent 50%),
      var(--bg);
    color: var(--text);
    line-height: 1.5;
  }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 48px 24px 80px; }
  h1 {
    font-family: "Instrument Serif", Georgia, serif;
    font-weight: 400;
    font-size: clamp(2.2rem, 5vw, 3.4rem);
    margin: 0 0 8px;
    letter-spacing: -0.02em;
  }
  .sub { color: var(--muted); margin-bottom: 36px; }
  .grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 14px;
    margin-bottom: 28px;
  }
  @media (max-width: 800px) {
    .grid { grid-template-columns: repeat(2, 1fr); }
  }
  .card {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 18px 18px 16px;
  }
  .card .label { color: var(--muted); font-size: 0.85rem; margin-bottom: 6px; }
  .card .value { font-size: 1.7rem; font-weight: 700; letter-spacing: -0.02em; }
  .card .value.good { color: var(--accent); }
  .card .value.warn { color: var(--warn); }
  section {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 22px;
    margin-bottom: 18px;
  }
  h2 {
    font-size: 1.05rem;
    margin: 0 0 14px;
    font-weight: 500;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--muted);
  }
  table { width: 100%; border-collapse: collapse; font-size: 0.95rem; }
  th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--line); }
  th { color: var(--muted); font-weight: 500; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .timeline {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    min-height: 150px;
    overflow-x: auto;
    padding-top: 8px;
  }
  .bar-wrap { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 36px; }
  .bar {
    width: 22px;
    background: linear-gradient(180deg, #56e0a5, #2a9b6f);
    border-radius: 6px 6px 2px 2px;
  }
  .bar-wrap span { color: var(--muted); font-size: 0.7rem; }
  .note { color: var(--muted); font-size: 0.9rem; margin-top: 10px; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>Campaign analytics</h1>
    <p class="sub">Sent.dm NHI SMS campaign · generated ${generatedAt}</p>

    <div class="grid">
      <div class="card"><div class="label">Messages tracked</div><div class="value">${summary.total.toLocaleString()}</div></div>
      <div class="card"><div class="label">Delivered</div><div class="value good">${summary.delivered.toLocaleString()}</div></div>
      <div class="card"><div class="label">Deliverability</div><div class="value good">${pct(summary.deliverabilityPct)}</div></div>
      <div class="card"><div class="label">Total spend</div><div class="value">${money(summary.totalCost)}</div></div>
    </div>

    <div class="grid">
      <div class="card"><div class="label">Carrier / message fees</div><div class="value">${money(summary.totalPrice)}</div></div>
      <div class="card"><div class="label">Platform fees</div><div class="value">${money(summary.totalPlatform)}</div></div>
      <div class="card"><div class="label">Avg cost / msg</div><div class="value">${money(summary.avgCost)}</div></div>
      <div class="card"><div class="label">Failed / blocked</div><div class="value ${summary.failed ? 'warn' : ''}">${summary.failed.toLocaleString()}</div></div>
    </div>

    <section>
      <h2>Status breakdown</h2>
      <table>
        <thead><tr><th>Status</th><th>Count</th><th>Share</th></tr></thead>
        <tbody>${statusRows}</tbody>
      </table>
    </section>

    <section>
      <h2>Channels</h2>
      <table>
        <thead><tr><th>Channel</th><th>Count</th></tr></thead>
        <tbody>${channelRows}</tbody>
      </table>
    </section>

    <section>
      <h2>By campaign run</h2>
      <table>
        <thead><tr><th>Campaign</th><th>Sent</th><th>Delivered</th><th>Deliverability</th><th>Cost</th></tr></thead>
        <tbody>${campaignRows}</tbody>
      </table>
    </section>

    <section>
      <h2>Volume by hour (UTC)</h2>
      <div class="timeline">${timelineBars || '<p class="note">No timeline data.</p>'}</div>
    </section>

    <section>
      <h2>Failures sample</h2>
      <table>
        <thead><tr><th>Phone</th><th>Status</th><th>Message ID</th><th>Created</th></tr></thead>
        <tbody>${failureRows}</tbody>
      </table>
      ${summary.fetchErrors ? `<p class="note">Fetch errors (API): ${summary.fetchErrors.toLocaleString()} — re-run with --retry-errors</p>` : ''}
    </section>
  </div>
</body>
</html>`;
}

async function main() {
  const rows = await loadCache(CACHE_PATH);
  if (rows.length === 0) {
    console.error(`No rows in ${CACHE_PATH}. Run npm run analytics:fetch first.`);
    process.exit(1);
  }

  const summary = summarize(rows);
  const generatedAt = new Date().toISOString();

  await fs.writeFile(CSV_PATH, buildCsv(rows), 'utf-8');
  await fs.writeFile(HTML_PATH, buildHtml(summary, generatedAt), 'utf-8');

  console.log(`Loaded ${rows.length} cached message(s)`);
  console.log(`Delivered: ${summary.delivered} (${pct(summary.deliverabilityPct)})`);
  console.log(`Total spend: ${money(summary.totalCost)} (avg ${money(summary.avgCost)})`);
  console.log(`Wrote ${HTML_PATH}`);
  console.log(`Wrote ${CSV_PATH}`);
}

main().catch((err) => {
  console.error('Analytics report failed:', err.message ?? err);
  process.exit(1);
});
