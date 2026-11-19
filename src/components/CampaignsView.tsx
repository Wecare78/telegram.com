import { useState } from 'react';
import {
  Copy,
  Check,
  Pause,
  Play,
  Pencil,
  Trash2,
  Search,
  Send,
  Plus,
  ExternalLink,
} from 'lucide-react';
import type { Campaign, CampaignStatus } from '../types.ts';

interface CampaignsViewProps {
  campaigns: Campaign[];
  loading: boolean;
  onCreateNew: () => void;
  onEdit: (campaign: Campaign) => void;
  onToggleStatus: (campaign: Campaign) => Promise<void>;
  onDelete: (campaignId: string) => Promise<void>;
  onTriggerInGroup: (campaign: Campaign) => void;
  onCopySuccess: (text: string) => void;
}

export function CampaignsView({
  campaigns,
  loading,
  onCreateNew,
  onEdit,
  onToggleStatus,
  onDelete,
  onTriggerInGroup,
  onCopySuccess,
}: CampaignsViewProps) {
  const [filter, setFilter] = useState<'all' | CampaignStatus>('all');
  const [search, setSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://pinglink.app';

  const filtered = campaigns.filter((c) => {
    if (filter !== 'all' && c.status !== filter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.destination_url.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleCopy = async (key: string, value: string, toastLabel: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(key);
      onCopySuccess(toastLabel);
      setTimeout(() => setCopiedId((prev) => (prev === key ? null : prev)), 1800);
    } catch {
      onCopySuccess('Copy failed — please select and copy manually.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Mention Link Campaigns</h1>
          <p className="text-sm text-slate-600 mt-1">
            Generate unique campaign links and copy ready-to-post Telegram messages with zero visible @mentions.
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateNew}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Create Campaign</span>
        </button>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
          {(['all', 'active', 'paused', 'completed'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilter(tab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors whitespace-nowrap shrink-0 ${
                filter === tab
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search campaigns or codes..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-sky-600"
          />
        </div>
      </div>

      {loading && campaigns.length === 0 ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-xl h-40 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
          <p className="text-sm font-medium text-slate-900">No campaigns match your current filter</p>
          <p className="text-xs text-slate-500 mt-1">
            Create a new campaign to generate a unique Telegram mention link.
          </p>
          <button
            type="button"
            onClick={onCreateNew}
            className="mt-4 px-4 py-2 text-sm font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-lg"
          >
            Generate First Link
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((cmp) => {
            const mentionUrl = `${origin}/m/${cmp.code}`;
            const fullAdText = `${cmp.ad_copy}\n\n${mentionUrl}`;
            const rate =
              cmp.total_processed > 0
                ? ((cmp.total_success / cmp.total_processed) * 100).toFixed(1)
                : '—';

            return (
              <article
                key={cmp.id}
                className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4"
              >
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <h2 className="text-lg font-semibold text-slate-900">{cmp.name}</h2>
                      <span
                        className={`text-xs font-medium capitalize ${
                          cmp.status === 'active'
                            ? 'text-emerald-700'
                            : cmp.status === 'paused'
                              ? 'text-amber-700'
                              : 'text-slate-500'
                        }`}
                      >
                        {cmp.status}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                      <span className="font-mono text-slate-700">{cmp.code}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {cmp.mention_mode === 'zero_width_html'
                          ? 'Zero-Width HTML'
                          : 'Inline Anchor'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">Batch {cmp.batch_size}</span>
                      <span aria-hidden="true">·</span>
                      <a
                        href={cmp.destination_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-sky-700 hover:underline truncate max-w-xs"
                      >
                        <span>{cmp.destination_url}</span>
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={cmp.status === 'paused'}
                      onClick={() => onTriggerInGroup(cmp)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-45 rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Post in Group</span>
                    </button>

                    {cmp.status !== 'completed' && (
                      <button
                        type="button"
                        onClick={() => void onToggleStatus(cmp)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                      >
                        {cmp.status === 'active' ? (
                          <>
                            <Pause className="w-3.5 h-3.5" />
                            <span>Pause</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3.5 h-3.5" />
                            <span>Resume</span>
                          </>
                        )}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onEdit(cmp)}
                      aria-label={`Edit ${cmp.name}`}
                      className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>

                    {confirmDeleteId === cmp.id ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            void onDelete(cmp.id);
                            setConfirmDeleteId(null);
                          }}
                          className="px-2.5 py-1 text-xs font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-md whitespace-nowrap"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2 py-1 text-xs text-slate-600 hover:text-slate-900"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(cmp.id)}
                        aria-label={`Delete ${cmp.name}`}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Ad Copy & Generated Mention Link Bar */}
                <div className="pt-3 border-t border-slate-100 grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
                  <div className="lg:col-span-6 text-sm text-slate-700 line-clamp-2">
                    {cmp.ad_copy}
                  </div>

                  <div className="lg:col-span-6 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <div className="flex-1 min-w-0 flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                      <span className="font-mono text-xs text-slate-800 truncate">{mentionUrl}</span>
                      <button
                        type="button"
                        onClick={() => void handleCopy(`link-${cmp.id}`, mentionUrl, 'Mention link copied to clipboard.')}
                        className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-800 whitespace-nowrap shrink-0"
                      >
                        {copiedId === `link-${cmp.id}` ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                            <span className="text-emerald-700">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy Link</span>
                          </>
                        )}
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        void handleCopy(
                          `msg-${cmp.id}`,
                          fullAdText,
                          'Full ad message + mention link copied.'
                        )
                      }
                      className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0"
                    >
                      {copiedId === `msg-${cmp.id}` ? 'Message Copied' : 'Copy Ad Message'}
                    </button>
                  </div>
                </div>

                {/* Metrics Strip */}
                <div className="pt-3 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-5 gap-4 text-xs">
                  <div>
                    <div className="text-slate-500">Groups Reached</div>
                    <div className="font-mono tabular-nums text-sm font-semibold text-slate-900 mt-0.5">
                      {cmp.groups_reached}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Members Processed</div>
                    <div className="font-mono tabular-nums text-sm font-semibold text-slate-900 mt-0.5">
                      {cmp.total_processed.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Successful</div>
                    <div className="font-mono tabular-nums text-sm font-semibold text-emerald-700 mt-0.5">
                      {cmp.total_success.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Failed</div>
                    <div className="font-mono tabular-nums text-sm font-semibold text-rose-700 mt-0.5">
                      {cmp.total_failed.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Delivery Rate</div>
                    <div className="font-mono tabular-nums text-sm font-semibold text-slate-900 mt-0.5">
                      {rate === '—' ? '—' : `${rate}%`}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
