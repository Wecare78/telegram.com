import { useState, useEffect } from 'react';
import { CheckCircle2, AlertCircle, Search, RefreshCw } from 'lucide-react';
import type { Campaign, NotificationLog } from '../types.ts';

interface LogsViewProps {
  campaigns: Campaign[];
}

export function LogsView({ campaigns }: LogsViewProps) {
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'delivered' | 'failed'>('all');
  const [campaignFilter, setCampaignFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        status: statusFilter,
        campaign_id: campaignFilter,
        q: search,
        limit: '120',
      });
      const resp = await fetch(`/api/logs?${params.toString()}`);
      if (resp.ok) {
        const rows = (await resp.json()) as NotificationLog[];
        setLogs(rows);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, campaignFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Notification Delivery Logs</h1>
          <p className="text-sm text-slate-600 mt-1">
            Per-member audit trail of invisible zero-width mention dispatches and Telegram delivery responses.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fetchLogs()}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(['all', 'delivered', 'failed'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setStatusFilter(tab)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === tab
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <select
            aria-label="Filter by campaign"
            value={campaignFilter}
            onChange={(e) => setCampaignFilter(e.target.value)}
            className="px-3 py-2 text-xs font-medium bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-sky-600"
          >
            <option value="all">All Campaigns</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void fetchLogs();
          }}
          className="flex items-center gap-2 w-full lg:w-80"
        >
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search member, ID, or group..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-sky-600"
            />
          </div>
          <button
            type="submit"
            className="px-3 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-lg whitespace-nowrap shrink-0"
          >
            Search
          </button>
        </form>
      </div>

      {/* Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                <th className="py-2.5 px-5">Member</th>
                <th className="py-2.5 px-4">Telegram ID</th>
                <th className="py-2.5 px-4">Group</th>
                <th className="py-2.5 px-4">Campaign</th>
                <th className="py-2.5 px-4">Batch</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4">Invisible Entity / Reason</th>
                <th className="py-2.5 px-5 text-right">Latency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {loading && logs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-500">
                    Loading notification logs...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-500">
                    No notification logs match the selected filters.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-2.5 px-5 font-medium text-slate-900 whitespace-nowrap">
                      {log.member_label}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                      {log.telegram_user_id}
                    </td>
                    <td className="py-2.5 px-4 text-slate-700 whitespace-nowrap">{log.group_title}</td>
                    <td className="py-2.5 px-4 text-slate-600 whitespace-nowrap">
                      <span>{log.campaign_name}</span>
                      <span className="font-mono text-slate-400 ml-1">{log.campaign_code}</span>
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                      #{log.batch_number}
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      {log.status === 'delivered' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Delivered
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-700 font-medium">
                          <AlertCircle className="w-3.5 h-3.5" />
                          Failed
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 max-w-xs truncate">
                      {log.error_reason ? (
                        <span className="text-rose-700">{log.error_reason}</span>
                      ) : (
                        <span className="font-mono text-slate-500">{log.payload_snippet}</span>
                      )}
                    </td>
                    <td className="py-2.5 px-5 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                      {log.latency_ms} ms
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
