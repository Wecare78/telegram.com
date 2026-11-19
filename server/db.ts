import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'pinglink.db');
export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    destination_url TEXT NOT NULL,
    ad_copy TEXT NOT NULL,
    mention_mode TEXT NOT NULL DEFAULT 'zero_width_html',
    batch_size INTEGER NOT NULL DEFAULT 5,
    delay_ms INTEGER NOT NULL DEFAULT 450,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    telegram_chat_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    username TEXT,
    group_type TEXT NOT NULL DEFAULT 'supergroup',
    auto_indexed INTEGER NOT NULL DEFAULT 1,
    last_synced_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS group_members (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    telegram_user_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    username TEXT,
    reachability TEXT NOT NULL DEFAULT 'reachable',
    indexed_at TEXT NOT NULL,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
    UNIQUE(group_id, telegram_user_id)
  );

  CREATE TABLE IF NOT EXISTS mention_jobs (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    posted_by_label TEXT NOT NULL,
    trigger_source TEXT NOT NULL DEFAULT 'group_post',
    message_preview TEXT NOT NULL,
    total_members INTEGER NOT NULL DEFAULT 0,
    processed_count INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    batch_size INTEGER NOT NULL DEFAULT 5,
    current_batch INTEGER NOT NULL DEFAULT 0,
    total_batches INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'queued',
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS notification_logs (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    telegram_user_id TEXT NOT NULL,
    member_label TEXT NOT NULL,
    batch_number INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL,
    error_reason TEXT,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    payload_snippet TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (job_id) REFERENCES mention_jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS bot_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    bot_token TEXT,
    bot_username TEXT,
    bot_display_name TEXT,
    webhook_secret TEXT NOT NULL,
    auto_detect_links INTEGER NOT NULL DEFAULT 1,
    default_batch_size INTEGER NOT NULL DEFAULT 5,
    default_delay_ms INTEGER NOT NULL DEFAULT 450,
    live_mode TEXT NOT NULL DEFAULT 'hybrid',
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON mention_jobs(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_campaign ON mention_jobs(campaign_id);
  CREATE INDEX IF NOT EXISTS idx_logs_created ON notification_logs(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_logs_job ON notification_logs(job_id);
  CREATE INDEX IF NOT EXISTS idx_logs_status ON notification_logs(status);
`);

// Safe migration for existing databases
const jobCols = db.prepare('PRAGMA table_info(mention_jobs)').all() as Array<{ name: string }>;
if (!jobCols.some((c) => c.name === 'reply_to_message_id')) {
  db.exec('ALTER TABLE mention_jobs ADD COLUMN reply_to_message_id INTEGER;');
}

function daysAgoIso(daysAgo: number, hourOffset = 10): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(hourOffset, Math.floor(Math.random() * 50), 12, 0);
  return d.toISOString();
}

export function seedInitialDataIfEmpty(): void {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM campaigns').get() as { cnt: number };
  if (row.cnt > 0) {
    return;
  }

  const now = new Date().toISOString();
  const webhookSecret = crypto.randomBytes(12).toString('hex');

  db.prepare(`
    INSERT INTO bot_settings (id, bot_token, bot_username, bot_display_name, webhook_secret, auto_detect_links, default_batch_size, default_delay_ms, live_mode, updated_at)
    VALUES (1, NULL, 'PingLinkRelayBot', 'PingLink Managed Relay', ?, 1, 5, 450, 'hybrid', ?)
  `).run(webhookSecret, now);

  const seedCampaigns = [
    {
      id: 'cmp-saas-launch',
      name: 'Q4 SaaS Founder Launch',
      code: 'cmp_7x92k',
      destination_url: 'https://cloudstack.example.com/early-access',
      ad_copy: 'Early access for our automated deployment pipeline is now open for founding teams. Claim 6 months of priority compute via the link below.',
      mention_mode: 'zero_width_html',
      batch_size: 5,
      delay_ms: 420,
      status: 'active',
      created_at: daysAgoIso(11, 9),
      updated_at: daysAgoIso(1, 14),
    },
    {
      id: 'cmp-talent-digest',
      name: 'Remote Engineering Digest',
      code: 'cmp_3m48p',
      destination_url: 'https://talentgrid.example.com/roles/2026',
      ad_copy: 'Curated senior backend and infrastructure roles across 40+ remote-first teams updated for this week.',
      mention_mode: 'zero_width_html',
      batch_size: 5,
      delay_ms: 450,
      status: 'active',
      created_at: daysAgoIso(8, 11),
      updated_at: daysAgoIso(0, 16),
    },
    {
      id: 'cmp-fintech-summit',
      name: 'APAC Fintech Summit Pass',
      code: 'cmp_9q15v',
      destination_url: 'https://fintechsummit.example.com/register',
      ad_copy: 'Complimentary builder passes for the Singapore Payments & Infrastructure Summit are live until Friday.',
      mention_mode: 'inline_anchor',
      batch_size: 6,
      delay_ms: 500,
      status: 'paused',
      created_at: daysAgoIso(6, 15),
      updated_at: daysAgoIso(2, 10),
    },
    {
      id: 'cmp-hardware-drop',
      name: 'Developer Workstation Drop',
      code: 'cmp_5w81r',
      destination_url: 'https://workbench.example.com/batch-04',
      ad_copy: 'Batch 04 anodized aluminum mechanical keypads and USB-C telemetry hubs are shipping this Monday.',
      mention_mode: 'zero_width_html',
      batch_size: 5,
      delay_ms: 400,
      status: 'completed',
      created_at: daysAgoIso(13, 8),
      updated_at: daysAgoIso(3, 18),
    },
  ];

  const insertCampaign = db.prepare(`
    INSERT INTO campaigns (id, name, code, destination_url, ad_copy, mention_mode, batch_size, delay_ms, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const c of seedCampaigns) {
    insertCampaign.run(c.id, c.name, c.code, c.destination_url, c.ad_copy, c.mention_mode, c.batch_size, c.delay_ms, c.status, c.created_at, c.updated_at);
  }

  const seedGroups = [
    {
      id: 'grp-saas-gtm',
      telegram_chat_id: '-1001948201142',
      title: 'SaaS Founders & GTM',
      username: 'saas_founders_gtm',
      group_type: 'supergroup',
      member_target: 46,
      last_synced_at: daysAgoIso(0, 18),
    },
    {
      id: 'grp-rust-infra',
      telegram_chat_id: '-1001827490311',
      title: 'Distributed Systems & Infra',
      username: 'systems_infra_chat',
      group_type: 'supergroup',
      member_target: 58,
      last_synced_at: daysAgoIso(0, 17),
    },
    {
      id: 'grp-apac-builders',
      telegram_chat_id: '-1001740293844',
      title: 'APAC Startup Operators',
      username: 'apac_operators',
      group_type: 'supergroup',
      member_target: 38,
      last_synced_at: daysAgoIso(1, 12),
    },
    {
      id: 'grp-remote-devs',
      telegram_chat_id: '-1001633849201',
      title: 'Remote Full-Stack Collective',
      username: 'remote_fullstack_hub',
      group_type: 'supergroup',
      member_target: 52,
      last_synced_at: daysAgoIso(0, 15),
    },
    {
      id: 'grp-product-design',
      telegram_chat_id: '-1001592837410',
      title: 'Product Engineering Circle',
      username: null,
      group_type: 'group',
      member_target: 32,
      last_synced_at: daysAgoIso(2, 9),
    },
  ];

  const firstNames = ['Aarav', 'Elena', 'Marcus', 'Nadia', 'Kenji', 'Sofia', 'Tariq', 'Hannah', 'Liam', 'Priya', 'Daniel', 'Chloe', 'Yusuf', 'Maya', 'Victor', 'Sora', 'Lucas', 'Amira', 'Noah', 'Zara'];
  const lastNames = ['Patel', 'Kowalski', 'Chen', 'Al-Mansoor', 'Tanaka', 'Morales', 'Lindqvist', 'Okafor', 'Jensen', 'Reyes', 'Novak', 'Ibrahim', 'Kim', 'Silva', 'Hassan', 'Weber'];

  const insertGroup = db.prepare(`
    INSERT INTO groups (id, telegram_chat_id, title, username, group_type, auto_indexed, last_synced_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `);
  const insertMember = db.prepare(`
    INSERT INTO group_members (id, group_id, telegram_user_id, display_name, username, reachability, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const membersByGroup: Record<string, Array<{ id: string; telegram_user_id: string; display_name: string; username: string | null; reachability: string }>> = {};

  for (let gIdx = 0; gIdx < seedGroups.length; gIdx++) {
    const g = seedGroups[gIdx];
    insertGroup.run(g.id, g.telegram_chat_id, g.title, g.username, g.group_type, g.last_synced_at);
    membersByGroup[g.id] = [];

    for (let i = 0; i < g.member_target; i++) {
      const fn = firstNames[(i * 7 + gIdx * 3) % firstNames.length];
      const ln = lastNames[(i * 5 + gIdx * 11) % lastNames.length];
      const displayName = `${fn} ${ln}`;
      const tgUserId = String(510000000 + gIdx * 100000 + i * 137 + 19);
      const hasUsername = i % 5 !== 0;
      const username = hasUsername ? `${fn.toLowerCase()}_${ln.toLowerCase().replace(/[^a-z]/g, '')}${i + 1}` : null;
      let reachability = 'reachable';
      if (i % 19 === 14) reachability = 'privacy_restricted';
      else if (i % 29 === 25) reachability = 'left_group';

      const mId = `mbr-${g.id}-${i + 1}`;
      insertMember.run(mId, g.id, tgUserId, displayName, username, reachability, daysAgoIso(12 - (i % 10), 11));
      membersByGroup[g.id].push({
        id: mId,
        telegram_user_id: tgUserId,
        display_name: displayName,
        username,
        reachability,
      });
    }
  }

  const historicalRuns = [
    { jobId: 'job-hist-01', campaignId: 'cmp-hardware-drop', groupId: 'grp-rust-infra', daysAgo: 9, postedBy: 'Alex M. (Member)', source: 'group_post' },
    { jobId: 'job-hist-02', campaignId: 'cmp-saas-launch', groupId: 'grp-saas-gtm', daysAgo: 7, postedBy: 'Jordan K. (Member)', source: 'group_post' },
    { jobId: 'job-hist-03', campaignId: 'cmp-fintech-summit', groupId: 'grp-apac-builders', daysAgo: 5, postedBy: 'Rina T. (Member)', source: 'telegram_webhook' },
    { jobId: 'job-hist-04', campaignId: 'cmp-talent-digest', groupId: 'grp-remote-devs', daysAgo: 3, postedBy: 'Samir N. (Member)', source: 'group_post' },
    { jobId: 'job-hist-05', campaignId: 'cmp-saas-launch', groupId: 'grp-product-design', daysAgo: 1, postedBy: 'Claire D. (Member)', source: 'telegram_webhook' },
  ];

  const insertJob = db.prepare(`
    INSERT INTO mention_jobs (
      id, campaign_id, group_id, posted_by_label, trigger_source, message_preview,
      total_members, processed_count, success_count, failed_count, batch_size,
      current_batch, total_batches, status, started_at, completed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertLog = db.prepare(`
    INSERT INTO notification_logs (
      id, job_id, campaign_id, group_id, member_id, telegram_user_id, member_label,
      batch_number, status, error_reason, latency_ms, payload_snippet, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const run of historicalRuns) {
    const campaign = seedCampaigns.find((c) => c.id === run.campaignId)!;
    const members = membersByGroup[run.groupId];
    const batchSize = campaign.batch_size;
    const totalBatches = Math.ceil(members.length / batchSize);
    const createdAt = daysAgoIso(run.daysAgo, 13);
    const completedAt = daysAgoIso(run.daysAgo, 14);
    let successCount = 0;
    let failedCount = 0;

    for (let idx = 0; idx < members.length; idx++) {
      const m = members[idx];
      const batchNumber = Math.floor(idx / batchSize) + 1;
      const isOk = m.reachability === 'reachable';
      if (isOk) successCount++;
      else failedCount++;

      const errorReason = isOk
        ? null
        : m.reachability === 'privacy_restricted'
          ? 'User privacy settings disallow mention alerts'
          : 'Member left group before dispatch';

      const latency = isOk ? 115 + ((idx * 23) % 140) : 290 + ((idx * 17) % 180);
      const snippet = `<a href="tg://user?id=${m.telegram_user_id}">&#8203;</a>`;

      insertLog.run(
        `log-${run.jobId}-${idx + 1}`,
        run.jobId,
        run.campaignId,
        run.groupId,
        m.id,
        m.telegram_user_id,
        m.username ? `${m.display_name} (@${m.username})` : m.display_name,
        batchNumber,
        isOk ? 'delivered' : 'failed',
        errorReason,
        latency,
        snippet,
        daysAgoIso(run.daysAgo, 13 + Math.floor(idx / 30))
      );
    }

    const preview = `${campaign.ad_copy}\n\nhttps://pinglink.app/m/${campaign.code}`;
    insertJob.run(
      run.jobId,
      run.campaignId,
      run.groupId,
      run.postedBy,
      run.source,
      preview,
      members.length,
      members.length,
      successCount,
      failedCount,
      batchSize,
      totalBatches,
      totalBatches,
      'completed',
      createdAt,
      completedAt,
      createdAt
    );
  }
}
