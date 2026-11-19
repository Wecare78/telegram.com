import { useState } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  Pause,
  Play,
  RotateCw,
  Clock,
  ArrowUpRight,
  Loader2,
} from 'lucide-react';
import type { DashboardPayload, MentionJob } from '../types.ts';

interface OverviewViewProps {
  data: DashboardPayload | null;
  loading: boolean;
  onPauseJob: (jobId: string) => Promise<void>;
  onResumeJob: (jobId: string) => Promise<void>;
  onRetryJob: (jobId: string) => Promise<void>;
  onNavigateTab: (tab: 'campaigns' | 'groups' | 'logs') => void;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function JobStatusLabel({ status }: { status: MentionJob['status'] }) {
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        Completed
      </span>
    );
  }
  if (status === 'processing' || status === 'queued') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-700 whitespace-nowrap">
        <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
        {status === 'queued' ? 'Queued' : 'Processing'}
      </span>
    );
  }
  if (status === 'paused') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
        <Clock className="w-3.5 h-3.5 shrink-0" />
        Paused
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-700 whitespace-nowrap">
      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
      Failed
    </span>
  );
}

export function OverviewView({
  data,
  loading,
  onPauseJob,
  onResumeJob,
  onRetryJob,
  onNavigateTab,
}: OverviewViewProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((idx) => (
            <div key={idx} className="bg-white border border-slate-200 rounded-xl p-5 h-28 animate-pulse" />
          ))}
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-6 h-72 animate-pulse" />
      </div>
    );
  }

  if (!data) return null;

  const { stats, timeseries, activeJobs, recentLogs } = data;
  const maxTotal = Math.max(10, ...timeseries.map((d) => d.delivered + d.failed));
  const hoveredPoint = hoveredIdx !== null ? timeseries[hoveredIdx] : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Campaign Operations</h1>
          <p className="text-sm text-slate-600 mt-1">
            Automated background mention dispatch across indexed Telegram groups without visible username lists.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigateTab('groups')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <span>Simulate Group Post</span>
            <ArrowUpRight className="w-4 h-4 text-slate-400" />
          </button>
        </div>
      </div>

      {/* 4-Column KPI Strip */}
      <section aria-label="Campaign statistics" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Total Campaigns</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-3xl font-bold font-mono tabular-nums text-slate-900">
              {stats.total_campaigns.toLocaleString()}
            </span>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              {stats.active_campaigns} active
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Indexed Groups</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-3xl font-bold font-mono tabular-nums text-slate-900">
              {stats.total_groups.toLocaleString()}
            </span>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              {stats.total_indexed_members.toLocaleString()} members
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Successful Notifications</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-3xl font-bold font-mono tabular-nums text-emerald-700">
              {stats.successful_notifications.toLocaleString()}
            </span>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              {stats.delivery_rate}% rate
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Failed Attempts</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-3xl font-bold font-mono tabular-nums text-rose-700">
              {stats.failed_attempts.toLocaleString()}
            </span>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              {stats.members_processed.toLocaleString()} processed
            </span>
          </div>
        </div>
      </section>

      {/* Chart + Live Background Queue */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* 14-Day Stacked Delivery Chart */}
        <section className="xl:col-span-7 bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
            <div>
              <h2 className="text-base font-semibold text-slate-900">14-Day Mention Delivery Volume</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Daily successful Telegram member notifications vs. failed attempts
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-600 shrink-0">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-sky-600 inline-block" />
                Delivered
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-rose-500 inline-block" />
                Failed
              </span>
            </div>
          </div>

          <div className="relative h-56 flex items-end gap-1.5 sm:gap-2 pt-8 pb-2 border-b border-slate-200">
            {hoveredPoint && (
              <div className="absolute top-0 right-0 text-xs font-mono tabular-nums text-slate-700 bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1">
                {hoveredPoint.label}: {hoveredPoint.delivered} delivered · {hoveredPoint.failed} failed
              </div>
            )}

            {timeseries.map((pt, idx) => {
              const total = pt.delivered + pt.failed;
              const deliveredPct = total > 0 ? (pt.delivered / maxTotal) * 100 : 0;
              const failedPct = total > 0 ? (pt.failed / maxTotal) * 100 : 0;

              return (
                <div
                  key={pt.date}
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  className="flex-1 h-full flex flex-col justify-end items-center group cursor-default"
                >
                  <div className="w-full max-w-[28px] h-full flex flex-col justify-end gap-0.5">
                    {failedPct > 0 && (
                      <div
                        style={{ height: `${Math.max(2, failedPct)}%` }}
                        className="w-full bg-rose-500 rounded-t-xs transition-opacity group-hover:opacity-85"
                      />
                    )}
                    {deliveredPct > 0 ? (
                      <div
                        style={{ height: `${Math.max(3, deliveredPct)}%` }}
                        className={`w-full bg-sky-600 transition-opacity group-hover:opacity-85 ${
                          failedPct === 0 ? 'rounded-t-xs' : ''
                        }`}
                      />
                    ) : (
                      <div className="w-full h-[2px] bg-slate-100" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between pt-2 text-[11px] font-mono tabular-nums text-slate-400">
            <span>{timeseries[0]?.label}</span>
            <span>{timeseries[Math.floor(timeseries.length / 2)]?.label}</span>
            <span>{timeseries[timeseries.length - 1]?.label}</span>
          </div>
        </section>

        {/* Live Background Queue */}
        <section className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-6 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Background Mention Queue</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {stats.active_jobs} active · {activeJobs.length} recent dispatches
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('campaigns')}
              className="text-xs font-medium text-sky-700 hover:underline whitespace-nowrap shrink-0"
            >
              View Campaigns
            </button>
          </div>

          {activeJobs.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-8 text-center">
              <p className="text-sm text-slate-600">No background mention jobs have been triggered yet.</p>
              <button
                type="button"
                onClick={() => onNavigateTab('groups')}
                className="mt-3 px-3.5 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-lg"
              >
                Trigger First Group Post
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 -mx-6 px-6 overflow-y-auto max-h-72">
              {activeJobs.map((job) => {
                const pct =
                  job.total_members > 0
                    ? Math.round((job.processed_count / job.total_members) * 100)
                    : 0;

                return (
                  <div key={job.id} className="py-3.5 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-900 truncate">
                          {job.group_title}
                        </div>
                        <div className="text-xs text-slate-500 truncate mt-0.5">
                          <span>{job.campaign_name}</span>
                          <span aria-hidden="true"> · </span>
                          <span className="font-mono">{job.campaign_code}</span>
                        </div>
                      </div>
                      <JobStatusLabel status={job.status} />
                    </div>

                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-200 ${
                          job.status === 'paused' ? 'bg-amber-500' : 'bg-sky-600'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-xs text-slate-500 font-mono tabular-nums">
                      <span>
                        {job.processed_count}/{job.total_members} members · {job.success_count} ok · {job.failed_count} fail
                      </span>
                      <div className="flex items-center gap-1.5">
                        {(job.status === 'processing' || job.status === 'queued') && (
                          <button
                            type="button"
                            onClick={() => void onPauseJob(job.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-sans font-medium text-slate-700 hover:bg-slate-100 rounded border border-slate-200 whitespace-nowrap"
                          >
                            <Pause className="w-3 h-3" />
                            Pause
                          </button>
                        )}
                        {job.status === 'paused' && (
                          <button
                            type="button"
                            onClick={() => void onResumeJob(job.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-sans font-medium text-sky-700 hover:bg-sky-50 rounded border border-sky-200 whitespace-nowrap"
                          >
                            <Play className="w-3 h-3" />
                            Resume
                          </button>
                        )}
                        {job.status === 'completed' && job.failed_count > 0 && (
                          <button
                            type="button"
                            onClick={() => void onRetryJob(job.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-sans font-medium text-slate-700 hover:bg-slate-100 rounded border border-slate-200 whitespace-nowrap"
                          >
                            <RotateCw className="w-3 h-3" />
                            Retry
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Recent Delivery Activity Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Recent Member Notifications</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Latest invisible mention dispatches executed by the background worker
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('logs')}
            className="text-xs font-medium text-sky-700 hover:underline whitespace-nowrap shrink-0"
          >
            Full Audit Log
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/60 text-xs font-medium text-slate-500">
                <th className="py-2.5 px-6">Member</th>
                <th className="py-2.5 px-4">Group</th>
                <th className="py-2.5 px-4">Campaign</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4 text-right">Latency</th>
                <th className="py-2.5 px-6 text-right">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {recentLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No notification attempts recorded yet.
                  </td>
                </tr>
              ) : (
                recentLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-2.5 px-6 font-medium text-slate-900 whitespace-nowrap">
                      {log.member_label}
                    </td>
                    <td className="py-2.5 px-4 text-slate-600 whitespace-nowrap">{log.group_title}</td>
                    <td className="py-2.5 px-4 text-slate-600 whitespace-nowrap">
                      <span>{log.campaign_name}</span>
                      <span className="text-slate-400 font-mono text-xs ml-1.5">{log.campaign_code}</span>
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      {log.status === 'delivered' ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Delivered
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-700">
                          <AlertCircle className="w-3.5 h-3.5" />
                          Failed
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                      {log.latency_ms} ms
                    </td>
                    <td className="py-2.5 px-6 text-right font-mono tabular-nums text-xs text-slate-500 whitespace-nowrap">
                      {formatTime(log.created_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
