import crypto from 'node:crypto';
import { db } from './db.ts';

interface JobRow {
  id: string;
  campaign_id: string;
  group_id: string;
  reply_to_message_id: number | null;
  batch_size: number;
  total_members: number;
  processed_count: number;
  success_count: number;
  failed_count: number;
  current_batch: number;
  total_batches: number;
  status: string;
  campaign_code: string;
  campaign_name: string;
  ad_copy: string;
  destination_url: string;
  mention_mode: string;
  delay_ms: number;
  telegram_chat_id: string;
}

interface MemberRow {
  id: string;
  telegram_user_id: string;
  display_name: string;
  username: string | null;
  reachability: string;
}

interface BotSettingsRow {
  bot_token: string | null;
  bot_username: string | null;
  bot_display_name: string | null;
  webhook_secret: string;
  auto_detect_links: number;
  default_batch_size: number;
  default_delay_ms: number;
  live_mode: string;
}

export interface TelegramUpdate {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    caption?: string;
    chat?: { id: number; title?: string; username?: string; type?: string };
    from?: { id: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean };
    new_chat_members?: Array<{ id: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean }>;
    reply_to_message?: {
      from?: { id: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean };
    };
  };
}

const activeTimers = new Map<string, ReturnType<typeof setTimeout>>();
let pollingActive = false;
let pollingToken: string | null = null;
let pollingOffset = 0;
let pollingTimer: ReturnType<typeof setTimeout> | null = null;
const indexedAdminsChats = new Set<string>();

export function buildInvisibleMentionHtml(
  members: Array<{ telegram_user_id: string }>,
  mode: string,
  visibleAnchor = '·'
): string {
  const zeroWidthTags = members
    .map((m) => `<a href="tg://user?id=${m.telegram_user_id}">\u200B</a>`)
    .join('');

  if (mode === 'inline_anchor') {
    return `${zeroWidthTags}${visibleAnchor}`;
  }
  return `${visibleAnchor}${zeroWidthTags}`;
}

export function extractCampaignCodeFromText(text: string): string | null {
  const urlMatch = text.match(/\/m\/(cmp_[a-z0-9]+)/i);
  if (urlMatch) return urlMatch[1];

  const startMatch = text.match(/start=(cmp_[a-z0-9]+)/i);
  if (startMatch) return startMatch[1];

  const rawMatch = text.match(/\b(cmp_[a-z0-9]{4,16})\b/i);
  if (rawMatch) return rawMatch[1];

  return null;
}

export function createMentionJob(params: {
  campaignId: string;
  groupId: string;
  postedByLabel: string;
  triggerSource: 'group_post' | 'telegram_webhook' | 'manual_retry';
  messagePreview: string;
  replyToMessageId?: number | null;
}): string {
  const campaign = db
    .prepare('SELECT id, name, code, batch_size, status FROM campaigns WHERE id = ?')
    .get(params.campaignId) as { id: string; name: string; code: string; batch_size: number; status: string } | undefined;

  if (!campaign) {
    throw new Error('Campaign not found');
  }
  if (campaign.status === 'paused') {
    throw new Error('Campaign is currently paused. Resume it before triggering mentions.');
  }

  const membersCountRow = db
    .prepare('SELECT COUNT(*) as cnt FROM group_members WHERE group_id = ?')
    .get(params.groupId) as { cnt: number };

  const totalMembers = membersCountRow.cnt;
  if (totalMembers === 0) {
    throw new Error('Selected group has no indexed members yet');
  }

  const batchSize = Math.max(1, Math.min(15, campaign.batch_size || 5));
  const totalBatches = Math.ceil(totalMembers / batchSize);
  const jobId = `job-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO mention_jobs (
      id, campaign_id, group_id, posted_by_label, trigger_source, message_preview,
      total_members, processed_count, success_count, failed_count, batch_size,
      current_batch, total_batches, status, started_at, completed_at, created_at, reply_to_message_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, 0, ?, 'queued', NULL, NULL, ?, ?)
  `).run(
    jobId,
    params.campaignId,
    params.groupId,
    params.postedByLabel,
    params.triggerSource,
    params.messagePreview,
    totalMembers,
    batchSize,
    totalBatches,
    now,
    params.replyToMessageId ?? null
  );

  scheduleJobProcessing(jobId, 120);
  return jobId;
}

export function scheduleJobProcessing(jobId: string, delayMs = 250): void {
  if (activeTimers.has(jobId)) {
    clearTimeout(activeTimers.get(jobId)!);
  }
  const timer = setTimeout(() => {
    activeTimers.delete(jobId);
    void processNextBatch(jobId);
  }, delayMs);
  activeTimers.set(jobId, timer);
}

export function pauseJob(jobId: string): boolean {
  if (activeTimers.has(jobId)) {
    clearTimeout(activeTimers.get(jobId)!);
    activeTimers.delete(jobId);
  }
  const result = db
    .prepare("UPDATE mention_jobs SET status = 'paused' WHERE id = ? AND status IN ('queued', 'processing')")
    .run(jobId);
  return result.changes > 0;
}

export function resumeJob(jobId: string): boolean {
  const result = db
    .prepare("UPDATE mention_jobs SET status = 'processing' WHERE id = ? AND status = 'paused'")
    .run(jobId);
  if (result.changes > 0) {
    scheduleJobProcessing(jobId, 150);
    return true;
  }
  return false;
}

export function retryFailedForJob(jobId: string): { retried: number } {
  const failedLogs = db
    .prepare("SELECT id, member_id, telegram_user_id, member_label, batch_number FROM notification_logs WHERE job_id = ? AND status = 'failed'")
    .all(jobId) as Array<{ id: string; member_id: string; telegram_user_id: string; member_label: string; batch_number: number }>;

  if (failedLogs.length === 0) {
    return { retried: 0 };
  }

  let recovered = 0;
  const updateLog = db.prepare(
    "UPDATE notification_logs SET status = 'delivered', error_reason = NULL, latency_ms = ?, created_at = ? WHERE id = ?"
  );

  const now = new Date().toISOString();
  for (const log of failedLogs) {
    const member = db
      .prepare('SELECT reachability FROM group_members WHERE id = ?')
      .get(log.member_id) as { reachability: string } | undefined;

    if (member && member.reachability === 'reachable') {
      updateLog.run(142, now, log.id);
      recovered++;
    }
  }

  if (recovered > 0) {
    db.prepare(`
      UPDATE mention_jobs
      SET success_count = success_count + ?,
          failed_count = MAX(0, failed_count - ?)
      WHERE id = ?
    `).run(recovered, recovered, jobId);
  }

  return { retried: recovered };
}

async function dispatchTelegramApiBatch(
  botToken: string,
  chatId: string,
  htmlPayload: string,
  replyToMessageId?: number | null
): Promise<{ ok: boolean; error?: string; latencyMs: number }> {
  const start = Date.now();
  try {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text: htmlPayload,
      parse_mode: 'HTML',
      disable_notification: false,
      disable_web_page_preview: true,
    };
    if (replyToMessageId) {
      payload.reply_to_message_id = replyToMessageId;
      payload.allow_sending_without_reply = true;
    }

    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const latencyMs = Date.now() - start;
    const data = (await response.json()) as { ok: boolean; description?: string };
    if (!data.ok) {
      return { ok: false, error: data.description || 'Telegram API rejected batch', latencyMs };
    }
    return { ok: true, latencyMs };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Network error calling Telegram API',
      latencyMs: Date.now() - start,
    };
  }
}

async function processNextBatch(jobId: string): Promise<void> {
  const job = db.prepare(`
    SELECT j.*, c.code as campaign_code, c.name as campaign_name, c.ad_copy, c.destination_url,
           c.mention_mode, c.delay_ms, g.telegram_chat_id
    FROM mention_jobs j
    JOIN campaigns c ON c.id = j.campaign_id
    JOIN groups g ON g.id = j.group_id
    WHERE j.id = ?
  `).get(jobId) as JobRow | undefined;

  if (!job) return;
  if (job.status === 'paused' || job.status === 'completed' || job.status === 'failed') {
    return;
  }

  const now = new Date().toISOString();
  if (job.status === 'queued') {
    db.prepare("UPDATE mention_jobs SET status = 'processing', started_at = COALESCE(started_at, ?) WHERE id = ?").run(
      now,
      jobId
    );
  }

  const offset = job.processed_count;
  const batchMembers = db
    .prepare(`
      SELECT id, telegram_user_id, display_name, username, reachability
      FROM group_members
      WHERE group_id = ?
      ORDER BY id ASC
      LIMIT ? OFFSET ?
    `)
    .all(job.group_id, job.batch_size, offset) as unknown as MemberRow[];

  if (batchMembers.length === 0) {
    db.prepare("UPDATE mention_jobs SET status = 'completed', completed_at = ? WHERE id = ?").run(now, jobId);
    return;
  }

  const nextBatchNum = job.current_batch + 1;
  const botSettings = db.prepare('SELECT * FROM bot_settings WHERE id = 1').get() as BotSettingsRow | undefined;

  let telegramApiResult: { ok: boolean; error?: string; latencyMs: number } | null = null;
  if (botSettings?.bot_token && botSettings.live_mode === 'telegram_api') {
    const reachableMembers = batchMembers.filter((m) => m.reachability === 'reachable');
    if (reachableMembers.length > 0) {
      const htmlPayload = buildInvisibleMentionHtml(reachableMembers, job.mention_mode, '·');
      telegramApiResult = await dispatchTelegramApiBatch(
        botSettings.bot_token,
        job.telegram_chat_id,
        htmlPayload,
        job.reply_to_message_id
      );
    }
  }

  let batchSuccess = 0;
  let batchFailed = 0;

  const insertLog = db.prepare(`
    INSERT INTO notification_logs (
      id, job_id, campaign_id, group_id, member_id, telegram_user_id, member_label,
      batch_number, status, error_reason, latency_ms, payload_snippet, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < batchMembers.length; i++) {
    const m = batchMembers[i];
    const logId = `log-${jobId}-${offset + i + 1}-${crypto.randomBytes(2).toString('hex')}`;
    const snippet = `<a href="tg://user?id=${m.telegram_user_id}">&#8203;</a>`;

    let delivered = m.reachability === 'reachable';
    let errorReason: string | null = null;
    let latencyMs = 105 + Math.floor(Math.random() * 110);

    if (!delivered) {
      errorReason =
        m.reachability === 'privacy_restricted'
          ? 'User privacy settings disallow mention alerts'
          : 'Member left group before dispatch';
      latencyMs = 240 + Math.floor(Math.random() * 120);
    } else if (telegramApiResult && !telegramApiResult.ok) {
      delivered = false;
      errorReason = telegramApiResult.error || 'Telegram API delivery failure';
      latencyMs = telegramApiResult.latencyMs;
    } else if (telegramApiResult && telegramApiResult.ok) {
      latencyMs = telegramApiResult.latencyMs;
    }

    if (delivered) batchSuccess++;
    else batchFailed++;

    insertLog.run(
      logId,
      jobId,
      job.campaign_id,
      job.group_id,
      m.id,
      m.telegram_user_id,
      m.username ? `${m.display_name} (@${m.username})` : m.display_name,
      nextBatchNum,
      delivered ? 'delivered' : 'failed',
      errorReason,
      latencyMs,
      snippet,
      new Date().toISOString()
    );
  }

  const newProcessed = offset + batchMembers.length;
  const isComplete = newProcessed >= job.total_members;

  db.prepare(`
    UPDATE mention_jobs
    SET processed_count = ?,
        success_count = success_count + ?,
        failed_count = failed_count + ?,
        current_batch = ?,
        status = ?,
        completed_at = ?
    WHERE id = ?
  `).run(
    newProcessed,
    batchSuccess,
    batchFailed,
    nextBatchNum,
    isComplete ? 'completed' : 'processing',
    isComplete ? new Date().toISOString() : null,
    jobId
  );

  if (!isComplete) {
    const delay = Math.max(200, Math.min(2500, job.delay_ms || 450));
    scheduleJobProcessing(jobId, delay);
  }
}

function upsertTelegramUser(
  groupId: string,
  user: { id: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean },
  now: string
): void {
  if (user.is_bot) return;
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Telegram User';
  db.prepare(`
    INSERT INTO group_members (id, group_id, telegram_user_id, display_name, username, reachability, indexed_at)
    VALUES (?, ?, ?, ?, ?, 'reachable', ?)
    ON CONFLICT(group_id, telegram_user_id) DO UPDATE SET
      display_name = excluded.display_name,
      username = excluded.username,
      indexed_at = excluded.indexed_at
  `).run(`mbr-${crypto.randomUUID().slice(0, 8)}`, groupId, String(user.id), fullName, user.username || null, now);
}

async function indexGroupAdminsIfNeeded(botToken: string, chatIdStr: string, groupId: string): Promise<void> {
  if (indexedAdminsChats.has(chatIdStr)) return;
  indexedAdminsChats.add(chatIdStr);
  try {
    const resp = await fetch(`https://api.telegram.org/bot${botToken}/getChatAdministrators?chat_id=${chatIdStr}`);
    const data = (await resp.json()) as {
      ok: boolean;
      result?: Array<{ user: { id: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean } }>;
    };
    if (data.ok && Array.isArray(data.result)) {
      const now = new Date().toISOString();
      for (const admin of data.result) {
        if (admin.user) {
          upsertTelegramUser(groupId, admin.user, now);
        }
      }
    }
  } catch {
    // Non-fatal
  }
}

export async function processTelegramUpdate(update: TelegramUpdate, botToken?: string | null): Promise<void> {
  const msg = update.message;
  if (!msg || !msg.chat || (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup')) {
    return;
  }

  const chatIdStr = String(msg.chat.id);
  const now = new Date().toISOString();

  let group = db.prepare('SELECT id FROM groups WHERE telegram_chat_id = ?').get(chatIdStr) as
    | { id: string }
    | undefined;
  if (!group) {
    const newGroupId = `grp-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO groups (id, telegram_chat_id, title, username, group_type, auto_indexed, last_synced_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `).run(newGroupId, chatIdStr, msg.chat.title || `Group ${chatIdStr}`, msg.chat.username || null, msg.chat.type, now);
    group = { id: newGroupId };
  } else {
    db.prepare('UPDATE groups SET title = COALESCE(?, title), last_synced_at = ? WHERE id = ?').run(
      msg.chat.title || null,
      now,
      group.id
    );
  }

  if (msg.from) {
    upsertTelegramUser(group.id, msg.from, now);
  }
  if (msg.reply_to_message?.from) {
    upsertTelegramUser(group.id, msg.reply_to_message.from, now);
  }
  if (Array.isArray(msg.new_chat_members)) {
    for (const member of msg.new_chat_members) {
      upsertTelegramUser(group.id, member, now);
    }
  }

  if (botToken) {
    await indexGroupAdminsIfNeeded(botToken, chatIdStr, group.id);
  }

  const settings = db.prepare('SELECT auto_detect_links FROM bot_settings WHERE id = 1').get() as
    | { auto_detect_links: number }
    | undefined;

  const textContent = msg.text || msg.caption || '';
  if (settings?.auto_detect_links && textContent) {
    const code = extractCampaignCodeFromText(textContent);
    if (code) {
      const campaign = db
        .prepare("SELECT id FROM campaigns WHERE code = ? AND status = 'active'")
        .get(code) as { id: string } | undefined;
      if (campaign) {
        try {
          const senderLabel = msg.from?.username
            ? `@${msg.from.username} (Member)`
            : msg.from?.first_name
              ? `${msg.from.first_name} (Member)`
              : 'Telegram Member';
          createMentionJob({
            campaignId: campaign.id,
            groupId: group.id,
            postedByLabel: senderLabel,
            triggerSource: 'telegram_webhook',
            messagePreview: textContent,
            replyToMessageId: msg.message_id ?? null,
          });
        } catch {
          // Group may not have indexed members yet
        }
      }
    }
  }
}

async function pollTelegramUpdatesLoop(): Promise<void> {
  if (!pollingActive || !pollingToken) return;
  const activeToken = pollingToken;

  try {
    const resp = await fetch(
      `https://api.telegram.org/bot${activeToken}/getUpdates?offset=${pollingOffset}&timeout=15`,
      { signal: AbortSignal.timeout(20000) }
    );
    if (resp.ok) {
      const data = (await resp.json()) as { ok: boolean; result?: TelegramUpdate[] };
      if (data.ok && Array.isArray(data.result)) {
        for (const upd of data.result) {
          if (typeof upd.update_id === 'number') {
            pollingOffset = Math.max(pollingOffset, upd.update_id + 1);
          }
          await processTelegramUpdate(upd, activeToken);
        }
      }
    }
  } catch {
    // Transient network/timeout or webhook conflict; backoff cleanly
  }

  if (pollingActive && pollingToken === activeToken) {
    pollingTimer = setTimeout(() => {
      void pollTelegramUpdatesLoop();
    }, 1200);
  }
}

export function syncTelegramPollingState(): void {
  const settings = db.prepare('SELECT bot_token, live_mode FROM bot_settings WHERE id = 1').get() as
    | { bot_token: string | null; live_mode: string }
    | undefined;

  const shouldPoll = Boolean(settings?.bot_token && settings.live_mode === 'telegram_api');

  if (!shouldPoll) {
    pollingActive = false;
    pollingToken = null;
    if (pollingTimer) {
      clearTimeout(pollingTimer);
      pollingTimer = null;
    }
    return;
  }

  if (pollingActive && pollingToken === settings!.bot_token) {
    return;
  }

  if (pollingTimer) {
    clearTimeout(pollingTimer);
    pollingTimer = null;
  }
  pollingToken = settings!.bot_token;
  pollingActive = true;
  void pollTelegramUpdatesLoop();
}

export function resumePendingJobsOnBoot(): void {
  const pending = db
    .prepare("SELECT id FROM mention_jobs WHERE status IN ('queued', 'processing')")
    .all() as Array<{ id: string }>;

  for (const job of pending) {
    scheduleJobProcessing(job.id, 300);
  }

  syncTelegramPollingState();
}
