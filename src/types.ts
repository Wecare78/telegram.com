export type CampaignStatus = 'active' | 'paused' | 'completed';
export type MentionMode = 'zero_width_html' | 'inline_anchor';
export type JobStatus = 'queued' | 'processing' | 'paused' | 'completed' | 'failed';
export type LogStatus = 'delivered' | 'failed';
export type ReachabilityStatus = 'reachable' | 'privacy_restricted' | 'left_group';

export interface Campaign {
  id: string;
  name: string;
  code: string;
  destination_url: string;
  ad_copy: string;
  mention_mode: MentionMode;
  batch_size: number;
  delay_ms: number;
  status: CampaignStatus;
  created_at: string;
  updated_at: string;
  groups_reached: number;
  total_processed: number;
  total_success: number;
  total_failed: number;
  jobs_count: number;
}

export interface TelegramGroup {
  id: string;
  telegram_chat_id: string;
  title: string;
  username: string | null;
  group_type: 'supergroup' | 'group';
  member_count: number;
  reachable_count: number;
  restricted_count: number;
  auto_indexed: number;
  last_synced_at: string;
  mentions_triggered: number;
}

export interface GroupMember {
  id: string;
  group_id: string;
  telegram_user_id: string;
  display_name: string;
  username: string | null;
  reachability: ReachabilityStatus;
  indexed_at: string;
}

export interface MentionJob {
  id: string;
  campaign_id: string;
  campaign_name: string;
  campaign_code: string;
  group_id: string;
  group_title: string;
  group_username: string | null;
  posted_by_label: string;
  trigger_source: 'group_post' | 'telegram_webhook' | 'manual_retry';
  message_preview: string;
  total_members: number;
  processed_count: number;
  success_count: number;
  failed_count: number;
  batch_size: number;
  current_batch: number;
  total_batches: number;
  status: JobStatus;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface NotificationLog {
  id: string;
  job_id: string;
  campaign_id: string;
  campaign_name: string;
  campaign_code: string;
  group_id: string;
  group_title: string;
  member_id: string;
  telegram_user_id: string;
  member_label: string;
  batch_number: number;
  status: LogStatus;
  error_reason: string | null;
  latency_ms: number;
  payload_snippet: string;
  created_at: string;
}

export interface TimeSeriesPoint {
  date: string;
  label: string;
  delivered: number;
  failed: number;
}

export interface DashboardStats {
  total_campaigns: number;
  active_campaigns: number;
  total_groups: number;
  total_indexed_members: number;
  members_processed: number;
  successful_notifications: number;
  failed_attempts: number;
  active_jobs: number;
  delivery_rate: number;
}

export interface DashboardPayload {
  stats: DashboardStats;
  timeseries: TimeSeriesPoint[];
  activeJobs: MentionJob[];
  recentLogs: NotificationLog[];
}

export interface BotConfigPublic {
  configured: boolean;
  bot_username: string | null;
  bot_display_name: string | null;
  webhook_secret: string;
  auto_detect_links: boolean;
  default_batch_size: number;
  default_delay_ms: number;
  live_mode: 'hybrid' | 'telegram_api';
  updated_at: string;
}
