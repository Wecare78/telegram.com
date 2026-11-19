import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, seedInitialDataIfEmpty } from './server/db.ts';
import {
  createMentionJob,
  extractCampaignCodeFromText,
  pauseJob,
  processTelegramUpdate,
  resumeJob,
  resumePendingJobsOnBoot,
  retryFailedForJob,
  syncTelegramPollingState,
} from './server/mentionEngine.ts';

seedInitialDataIfEmpty();
resumePendingJobsOnBoot();

const app = express();
app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// Public campaign mention link bridge
app.get('/m/:code', (req, res) => {
  const { code } = req.params;
  const campaign = db
    .prepare('SELECT id, name, destination_url, status FROM campaigns WHERE code = ?')
    .get(code) as { id: string; name: string; destination_url: string; status: string } | undefined;

  if (!campaign) {
    res.status(404).send('Campaign link not found or expired.');
    return;
  }

  try {
    const parsed = new URL(campaign.destination_url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      res.redirect(302, parsed.toString());
      return;
    }
  } catch {
    // Fallback to clean text response if URL invalid
  }
  res.status(200).send(`Redirecting to ${campaign.name}`);
});

// Dashboard summary payload
app.get('/api/dashboard', (_req, res) => {
  const campaignCounts = db
    .prepare(`
      SELECT
        COUNT(*) as total_campaigns,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_campaigns
      FROM campaigns
    `)
    .get() as { total_campaigns: number; active_campaigns: number | null };

  const groupCount = db.prepare('SELECT COUNT(*) as total_groups FROM groups').get() as { total_groups: number };
  const memberCount = db
    .prepare('SELECT COUNT(*) as total_indexed_members FROM group_members')
    .get() as { total_indexed_members: number };

  const jobTotals = db
    .prepare(`
      SELECT
        COALESCE(SUM(processed_count), 0) as members_processed,
        COALESCE(SUM(success_count), 0) as successful_notifications,
        COALESCE(SUM(failed_count), 0) as failed_attempts,
        SUM(CASE WHEN status IN ('queued', 'processing') THEN 1 ELSE 0 END) as active_jobs
      FROM mention_jobs
    `)
    .get() as {
    members_processed: number;
    successful_notifications: number;
    failed_attempts: number;
    active_jobs: number | null;
  };

  const processed = jobTotals.members_processed || 0;
  const deliveryRate = processed > 0 ? Number(((jobTotals.successful_notifications / processed) * 100).toFixed(1)) : 100;

  // 14-day time series
  const rawSeries = db
    .prepare(`
      SELECT
        substr(created_at, 1, 10) as day,
        SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM notification_logs
      WHERE date(created_at) >= date('now', '-13 days')
      GROUP BY day
      ORDER BY day ASC
    `)
    .all() as Array<{ day: string; delivered: number; failed: number }>;

  const seriesMap = new Map(rawSeries.map((r) => [r.day, r]));
  const timeseries = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const isoDay = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const entry = seriesMap.get(isoDay);
    timeseries.push({
      date: isoDay,
      label,
      delivered: entry ? entry.delivered : 0,
      failed: entry ? entry.failed : 0,
    });
  }

  const activeJobs = db
    .prepare(`
      SELECT j.*, c.name as campaign_name, c.code as campaign_code, g.title as group_title, g.username as group_username
      FROM mention_jobs j
      JOIN campaigns c ON c.id = j.campaign_id
      JOIN groups g ON g.id = j.group_id
      ORDER BY
        CASE WHEN j.status IN ('processing', 'queued', 'paused') THEN 0 ELSE 1 END,
        j.created_at DESC
      LIMIT 8
    `)
    .all();

  const recentLogs = db
    .prepare(`
      SELECT l.*, c.name as campaign_name, c.code as campaign_code, g.title as group_title
      FROM notification_logs l
      JOIN campaigns c ON c.id = l.campaign_id
      JOIN groups g ON g.id = l.group_id
      ORDER BY l.created_at DESC
      LIMIT 12
    `)
    .all();

  res.json({
    stats: {
      total_campaigns: campaignCounts.total_campaigns || 0,
      active_campaigns: campaignCounts.active_campaigns || 0,
      total_groups: groupCount.total_groups || 0,
      total_indexed_members: memberCount.total_indexed_members || 0,
      members_processed: processed,
      successful_notifications: jobTotals.successful_notifications || 0,
      failed_attempts: jobTotals.failed_attempts || 0,
      active_jobs: jobTotals.active_jobs || 0,
      delivery_rate: deliveryRate,
    },
    timeseries,
    activeJobs,
    recentLogs,
  });
});

// Campaigns CRUD
app.get('/api/campaigns', (_req, res) => {
  const rows = db
    .prepare(`
      SELECT
        c.*,
        COUNT(DISTINCT j.group_id) as groups_reached,
        COALESCE(SUM(j.processed_count), 0) as total_processed,
        COALESCE(SUM(j.success_count), 0) as total_success,
        COALESCE(SUM(j.failed_count), 0) as total_failed,
        COUNT(j.id) as jobs_count
      FROM campaigns c
      LEFT JOIN mention_jobs j ON j.campaign_id = c.id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `)
    .all();
  res.json(rows);
});

app.post('/api/campaigns', (req, res) => {
  const { name, destination_url, ad_copy, mention_mode, batch_size, delay_ms } = req.body as {
    name?: string;
    destination_url?: string;
    ad_copy?: string;
    mention_mode?: string;
    batch_size?: number;
    delay_ms?: number;
  };

  if (!name?.trim() || !destination_url?.trim() || !ad_copy?.trim()) {
    res.status(400).json({ error: 'Campaign name, destination URL, and ad copy are required.' });
    return;
  }

  try {
    new URL(destination_url.trim());
  } catch {
    res.status(400).json({ error: 'Please enter a valid http/https destination URL.' });
    return;
  }

  const id = `cmp-${crypto.randomUUID().slice(0, 8)}`;
  const code = `cmp_${crypto.randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();
  const mode = mention_mode === 'inline_anchor' ? 'inline_anchor' : 'zero_width_html';
  const safeBatch = Math.max(1, Math.min(15, Number(batch_size) || 5));
  const safeDelay = Math.max(200, Math.min(2500, Number(delay_ms) || 450));

  db.prepare(`
    INSERT INTO campaigns (id, name, code, destination_url, ad_copy, mention_mode, batch_size, delay_ms, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(id, name.trim(), code, destination_url.trim(), ad_copy.trim(), mode, safeBatch, safeDelay, now, now);

  const created = db
    .prepare(`
      SELECT
        c.*,
        0 as groups_reached,
        0 as total_processed,
        0 as total_success,
        0 as total_failed,
        0 as jobs_count
      FROM campaigns c
      WHERE c.id = ?
    `)
    .get(id);

  res.status(201).json(created);
});

app.patch('/api/campaigns/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Campaign not found.' });
    return;
  }

  const { name, destination_url, ad_copy, status, mention_mode, batch_size, delay_ms } = req.body as {
    name?: string;
    destination_url?: string;
    ad_copy?: string;
    status?: string;
    mention_mode?: string;
    batch_size?: number;
    delay_ms?: number;
  };

  const nextStatus =
    status && ['active', 'paused', 'completed'].includes(status) ? status : (existing.status as string);
  const nextMode =
    mention_mode && ['zero_width_html', 'inline_anchor'].includes(mention_mode)
      ? mention_mode
      : (existing.mention_mode as string);

  db.prepare(`
    UPDATE campaigns
    SET name = ?,
        destination_url = ?,
        ad_copy = ?,
        status = ?,
        mention_mode = ?,
        batch_size = ?,
        delay_ms = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    name?.trim() || (existing.name as string),
    destination_url?.trim() || (existing.destination_url as string),
    ad_copy?.trim() || (existing.ad_copy as string),
    nextStatus,
    nextMode,
    batch_size ? Math.max(1, Math.min(15, Number(batch_size))) : (existing.batch_size as number),
    delay_ms ? Math.max(200, Math.min(2500, Number(delay_ms))) : (existing.delay_ms as number),
    new Date().toISOString(),
    id
  );

  const updated = db
    .prepare(`
      SELECT
        c.*,
        COUNT(DISTINCT j.group_id) as groups_reached,
        COALESCE(SUM(j.processed_count), 0) as total_processed,
        COALESCE(SUM(j.success_count), 0) as total_success,
        COALESCE(SUM(j.failed_count), 0) as total_failed,
        COUNT(j.id) as jobs_count
      FROM campaigns c
      LEFT JOIN mention_jobs j ON j.campaign_id = c.id
      WHERE c.id = ?
      GROUP BY c.id
    `)
    .get(id);

  res.json(updated);
});

app.delete('/api/campaigns/:id', (req, res) => {
  const { id } = req.params;
  const result = db.prepare('DELETE FROM campaigns WHERE id = ?').run(id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Campaign not found.' });
    return;
  }
  res.json({ deleted: true });
});

// Groups & Auto-Indexed Members
app.get('/api/groups', (_req, res) => {
  const rows = db
    .prepare(`
      SELECT
        g.*,
        COUNT(m.id) as member_count,
        SUM(CASE WHEN m.reachability = 'reachable' THEN 1 ELSE 0 END) as reachable_count,
        SUM(CASE WHEN m.reachability != 'reachable' THEN 1 ELSE 0 END) as restricted_count,
        (SELECT COUNT(*) FROM mention_jobs j WHERE j.group_id = g.id) as mentions_triggered
      FROM groups g
      LEFT JOIN group_members m ON m.group_id = g.id
      GROUP BY g.id
      ORDER BY member_count DESC
    `)
    .all();
  res.json(rows);
});

app.post('/api/groups', (req, res) => {
  const { title, username, group_type, initial_members } = req.body as {
    title?: string;
    username?: string;
    group_type?: string;
    initial_members?: number;
  };

  if (!title?.trim()) {
    res.status(400).json({ error: 'Group title is required.' });
    return;
  }

  const groupId = `grp-${crypto.randomUUID().slice(0, 8)}`;
  const chatId = `-100${Math.floor(1000000000 + Math.random() * 8999999999)}`;
  const cleanUsername = username?.trim().replace(/^@/, '') || null;
  const gType = group_type === 'group' ? 'group' : 'supergroup';
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO groups (id, telegram_chat_id, title, username, group_type, auto_indexed, last_synced_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `).run(groupId, chatId, title.trim(), cleanUsername, gType, now);

  const count = Math.max(10, Math.min(120, Number(initial_members) || 30));
  const firstNames = ['Aria', 'Mateo', 'Yuki', 'Zain', 'Clara', 'Dev', 'Lina', 'Owen', 'Noor', 'Felix', 'Mina', 'Theo'];
  const lastNames = ['Park', 'Hassan', 'Rossi', 'Gomez', 'Singh', 'Miller', 'Keller', 'Sato', 'Bauer', 'Costa'];
  const insertMember = db.prepare(`
    INSERT INTO group_members (id, group_id, telegram_user_id, display_name, username, reachability, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < count; i++) {
    const fn = firstNames[(i * 3) % firstNames.length];
    const ln = lastNames[(i * 5) % lastNames.length];
    const tgId = String(620000000 + Math.floor(Math.random() * 90000000) + i);
    const uname = i % 4 === 0 ? null : `${fn.toLowerCase()}_${ln.toLowerCase()}_${i + 1}`;
    const reachability = i % 17 === 12 ? 'privacy_restricted' : i % 29 === 24 ? 'left_group' : 'reachable';
    insertMember.run(`mbr-${groupId}-${i + 1}`, groupId, tgId, `${fn} ${ln}`, uname, reachability, now);
  }

  const created = db
    .prepare(`
      SELECT
        g.*,
        COUNT(m.id) as member_count,
        SUM(CASE WHEN m.reachability = 'reachable' THEN 1 ELSE 0 END) as reachable_count,
        SUM(CASE WHEN m.reachability != 'reachable' THEN 1 ELSE 0 END) as restricted_count,
        0 as mentions_triggered
      FROM groups g
      LEFT JOIN group_members m ON m.group_id = g.id
      WHERE g.id = ?
      GROUP BY g.id
    `)
    .get(groupId);

  res.status(201).json(created);
});

app.get('/api/groups/:id/members', (req, res) => {
  const { id } = req.params;
  const members = db
    .prepare('SELECT * FROM group_members WHERE group_id = ? ORDER BY indexed_at DESC LIMIT 150')
    .all(id);
  res.json(members);
});

// Trigger background mention job (when ordinary member posts message with campaign link in group)
app.post('/api/trigger', (req, res) => {
  const { campaign_id, group_id, posted_by_label, message_text } = req.body as {
    campaign_id?: string;
    group_id?: string;
    posted_by_label?: string;
    message_text?: string;
  };

  if (!group_id) {
    res.status(400).json({ error: 'Target Telegram group is required.' });
    return;
  }

  let resolvedCampaignId = campaign_id;
  if (!resolvedCampaignId && message_text) {
    const code = extractCampaignCodeFromText(message_text);
    if (code) {
      const found = db.prepare('SELECT id FROM campaigns WHERE code = ?').get(code) as { id: string } | undefined;
      if (found) {
        resolvedCampaignId = found.id;
      }
    }
  }

  if (!resolvedCampaignId) {
    res.status(400).json({ error: 'No valid campaign or mention link code detected in the message.' });
    return;
  }

  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(resolvedCampaignId) as
    | { id: string; code: string; ad_copy: string }
    | undefined;
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found.' });
    return;
  }

  try {
    const preview =
      message_text?.trim() || `${campaign.ad_copy}\n\nhttps://pinglink.app/m/${campaign.code}`;
    const jobId = createMentionJob({
      campaignId: resolvedCampaignId,
      groupId: group_id,
      postedByLabel: posted_by_label?.trim() || 'Ordinary Group Member',
      triggerSource: 'group_post',
      messagePreview: preview,
    });

    const job = db
      .prepare(`
        SELECT j.*, c.name as campaign_name, c.code as campaign_code, g.title as group_title, g.username as group_username
        FROM mention_jobs j
        JOIN campaigns c ON c.id = j.campaign_id
        JOIN groups g ON g.id = j.group_id
        WHERE j.id = ?
      `)
      .get(jobId);

    res.status(202).json(job);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to start mention job.' });
  }
});

// Background Jobs management
app.get('/api/jobs', (_req, res) => {
  const jobs = db
    .prepare(`
      SELECT j.*, c.name as campaign_name, c.code as campaign_code, g.title as group_title, g.username as group_username
      FROM mention_jobs j
      JOIN campaigns c ON c.id = j.campaign_id
      JOIN groups g ON g.id = j.group_id
      ORDER BY j.created_at DESC
      LIMIT 40
    `)
    .all();
  res.json(jobs);
});

app.post('/api/jobs/:id/pause', (req, res) => {
  const ok = pauseJob(req.params.id);
  res.json({ ok });
});

app.post('/api/jobs/:id/resume', (req, res) => {
  const ok = resumeJob(req.params.id);
  res.json({ ok });
});

app.post('/api/jobs/:id/retry', (req, res) => {
  const result = retryFailedForJob(req.params.id);
  res.json(result);
});

// Notification Delivery Logs
app.get('/api/logs', (req, res) => {
  const status = String(req.query.status || 'all');
  const campaignId = String(req.query.campaign_id || '');
  const q = String(req.query.q || '').trim().toLowerCase();
  const limit = Math.max(10, Math.min(250, Number(req.query.limit) || 100));

  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (status === 'delivered' || status === 'failed') {
    conditions.push('l.status = ?');
    params.push(status);
  }
  if (campaignId && campaignId !== 'all') {
    conditions.push('l.campaign_id = ?');
    params.push(campaignId);
  }
  if (q) {
    conditions.push('(LOWER(l.member_label) LIKE ? OR LOWER(g.title) LIKE ? OR LOWER(c.name) LIKE ? OR l.telegram_user_id LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(`
      SELECT l.*, c.name as campaign_name, c.code as campaign_code, g.title as group_title
      FROM notification_logs l
      JOIN campaigns c ON c.id = l.campaign_id
      JOIN groups g ON g.id = l.group_id
      ${whereClause}
      ORDER BY l.created_at DESC
      LIMIT ?
    `)
    .all(...params, limit);

  res.json(rows);
});

// Bot Engine & Webhook Config (Server-Side Token Security)
app.get('/api/bot/config', (_req, res) => {
  const row = db.prepare('SELECT * FROM bot_settings WHERE id = 1').get() as {
    bot_token: string | null;
    bot_username: string | null;
    bot_display_name: string | null;
    webhook_secret: string;
    auto_detect_links: number;
    default_batch_size: number;
    default_delay_ms: number;
    live_mode: string;
    updated_at: string;
  };

  res.json({
    configured: Boolean(row.bot_token),
    bot_username: row.bot_username,
    bot_display_name: row.bot_display_name,
    webhook_secret: row.webhook_secret,
    auto_detect_links: Boolean(row.auto_detect_links),
    default_batch_size: row.default_batch_size,
    default_delay_ms: row.default_delay_ms,
    live_mode: row.live_mode === 'telegram_api' ? 'telegram_api' : 'hybrid',
    updated_at: row.updated_at,
  });
});

app.post('/api/bot/config', async (req, res) => {
  const { bot_token, clear_token, auto_detect_links, default_batch_size, default_delay_ms, live_mode } = req.body as {
    bot_token?: string;
    clear_token?: boolean;
    auto_detect_links?: boolean;
    default_batch_size?: number;
    default_delay_ms?: number;
    live_mode?: string;
  };

  const current = db.prepare('SELECT * FROM bot_settings WHERE id = 1').get() as {
    bot_token: string | null;
    bot_username: string | null;
    bot_display_name: string | null;
    auto_detect_links: number;
    default_batch_size: number;
    default_delay_ms: number;
    live_mode: string;
  };

  let nextToken = current.bot_token;
  let nextUsername = current.bot_username;
  let nextDisplayName = current.bot_display_name;

  if (clear_token) {
    nextToken = null;
    nextUsername = 'PingLinkRelayBot';
    nextDisplayName = 'PingLink Managed Relay';
  } else if (bot_token && bot_token.trim()) {
    try {
      const verifyResp = await fetch(`https://api.telegram.org/bot${bot_token.trim()}/getMe`);
      const verifyData = (await verifyResp.json()) as {
        ok: boolean;
        description?: string;
        result?: { username?: string; first_name?: string };
      };
      if (!verifyData.ok || !verifyData.result) {
        res.status(400).json({ error: verifyData.description || 'Telegram Bot Token verification failed.' });
        return;
      }
      nextToken = bot_token.trim();
      nextUsername = verifyData.result.username || 'TelegramRelayBot';
      nextDisplayName = verifyData.result.first_name || 'Connected Bot';
    } catch {
      res.status(400).json({ error: 'Could not reach api.telegram.org to verify token.' });
      return;
    }
  }

  const now = new Date().toISOString();
  const nextMode = live_mode === 'telegram_api' ? 'telegram_api' : 'hybrid';
  db.prepare(`
    UPDATE bot_settings
    SET bot_token = ?,
        bot_username = ?,
        bot_display_name = ?,
        auto_detect_links = ?,
        default_batch_size = ?,
        default_delay_ms = ?,
        live_mode = ?,
        updated_at = ?
    WHERE id = 1
  `).run(
    nextToken,
    nextUsername,
    nextDisplayName,
    auto_detect_links === undefined ? current.auto_detect_links : auto_detect_links ? 1 : 0,
    default_batch_size ? Math.max(1, Math.min(15, Number(default_batch_size))) : current.default_batch_size,
    default_delay_ms ? Math.max(200, Math.min(2500, Number(default_delay_ms))) : current.default_delay_ms,
    nextMode,
    now
  );

  if (nextToken && nextMode === 'telegram_api') {
    try {
      await fetch(`https://api.telegram.org/bot${nextToken}/deleteWebhook?drop_pending_updates=false`);
    } catch {
      // Non-fatal
    }
  }
  syncTelegramPollingState();

  res.json({
    configured: Boolean(nextToken),
    bot_username: nextUsername,
    bot_display_name: nextDisplayName,
    auto_detect_links: auto_detect_links === undefined ? Boolean(current.auto_detect_links) : Boolean(auto_detect_links),
    default_batch_size: default_batch_size || current.default_batch_size,
    default_delay_ms: default_delay_ms || current.default_delay_ms,
    live_mode: nextMode,
    updated_at: now,
  });
});

// Genuine Telegram Bot Webhook ingestion endpoint
app.post('/api/telegram/webhook/:secret', async (req, res) => {
  const settings = db
    .prepare('SELECT webhook_secret, bot_token FROM bot_settings WHERE id = 1')
    .get() as {
    webhook_secret: string;
    bot_token: string | null;
  };
  if (req.params.secret !== settings.webhook_secret) {
    res.status(403).json({ error: 'Invalid webhook secret' });
    return;
  }

  await processTelegramUpdate(req.body, settings.bot_token);
  res.json({ ok: true });
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`PingLink server running on http://0.0.0.0:${port}`);
  });
}

void startServer();
