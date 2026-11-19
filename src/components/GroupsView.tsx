import { useState, useEffect, type FormEvent } from 'react';
import {
  Send,
  Users,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Plus,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from 'lucide-react';
import type { Campaign, GroupMember, MentionJob, TelegramGroup } from '../types.ts';

interface GroupsViewProps {
  campaigns: Campaign[];
  groups: TelegramGroup[];
  activeJobs: MentionJob[];
  initialCampaignId?: string | null;
  onTriggerPost: (payload: {
    campaign_id?: string;
    group_id: string;
    posted_by_label: string;
    message_text: string;
  }) => Promise<MentionJob>;
  onCreateGroup: (payload: {
    title: string;
    username: string;
    group_type: 'supergroup' | 'group';
    initial_members: number;
  }) => Promise<void>;
  onFetchMembers: (groupId: string) => Promise<GroupMember[]>;
}

export function GroupsView({
  campaigns,
  groups,
  activeJobs,
  initialCampaignId,
  onTriggerPost,
  onCreateGroup,
  onFetchMembers,
}: GroupsViewProps) {
  const activeCampaigns = campaigns.filter((c) => c.status !== 'paused');
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(
    initialCampaignId || activeCampaigns[0]?.id || ''
  );
  const [selectedGroupId, setSelectedGroupId] = useState<string>(groups[0]?.id || '');
  const [senderLabel, setSenderLabel] = useState('Ordinary Group Member');
  const [messageText, setMessageText] = useState('');
  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [lastTriggeredJobId, setLastTriggeredJobId] = useState<string | null>(null);

  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [membersCache, setMembersCache] = useState<Record<string, GroupMember[]>>({});
  const [loadingMembersId, setLoadingMembersId] = useState<string | null>(null);

  const [showAddGroup, setShowAddGroup] = useState(false);
  const [newGroupTitle, setNewGroupTitle] = useState('');
  const [newGroupUsername, setNewGroupUsername] = useState('');
  const [newGroupType, setNewGroupType] = useState<'supergroup' | 'group'>('supergroup');
  const [newGroupMembers, setNewGroupMembers] = useState(35);
  const [addingGroup, setAddingGroup] = useState(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://pinglink.app';

  useEffect(() => {
    if (initialCampaignId) {
      setSelectedCampaignId(initialCampaignId);
    }
  }, [initialCampaignId]);

  useEffect(() => {
    if (!selectedGroupId && groups.length > 0) {
      setSelectedGroupId(groups[0].id);
    }
  }, [groups, selectedGroupId]);

  useEffect(() => {
    const cmp = campaigns.find((c) => c.id === selectedCampaignId);
    if (cmp) {
      setMessageText(`${cmp.ad_copy}\n\n${origin}/m/${cmp.code}`);
    }
  }, [selectedCampaignId, campaigns, origin]);

  const selectedCampaign = campaigns.find((c) => c.id === selectedCampaignId);
  const selectedGroup = groups.find((g) => g.id === selectedGroupId);
  const trackedJob = lastTriggeredJobId
    ? activeJobs.find((j) => j.id === lastTriggeredJobId) || null
    : null;

  const handleTrigger = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedGroupId) return;
    setTriggerError(null);
    setTriggering(true);
    try {
      const job = await onTriggerPost({
        campaign_id: selectedCampaignId || undefined,
        group_id: selectedGroupId,
        posted_by_label: senderLabel,
        message_text: messageText,
      });
      setLastTriggeredJobId(job.id);
    } catch (err) {
      setTriggerError(err instanceof Error ? err.message : 'Unable to trigger mention job.');
    } finally {
      setTriggering(false);
    }
  };

  const handleToggleInspect = async (groupId: string) => {
    if (expandedGroupId === groupId) {
      setExpandedGroupId(null);
      return;
    }
    setExpandedGroupId(groupId);
    if (!membersCache[groupId]) {
      setLoadingMembersId(groupId);
      try {
        const list = await onFetchMembers(groupId);
        setMembersCache((prev) => ({ ...prev, [groupId]: list }));
      } finally {
        setLoadingMembersId(null);
      }
    }
  };

  const handleAddGroupSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!newGroupTitle.trim()) return;
    setAddingGroup(true);
    try {
      await onCreateGroup({
        title: newGroupTitle,
        username: newGroupUsername,
        group_type: newGroupType,
        initial_members: newGroupMembers,
      });
      setNewGroupTitle('');
      setNewGroupUsername('');
      setShowAddGroup(false);
    } finally {
      setAddingGroup(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Groups & Post Trigger</h1>
          <p className="text-sm text-slate-600 mt-1">
            Simulate posting your campaign link as an ordinary group member and watch background notifications dispatch.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddGroup((v) => !v)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Index Group</span>
        </button>
      </div>

      {showAddGroup && (
        <form
          onSubmit={handleAddGroupSubmit}
          className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end"
        >
          <div className="lg:col-span-2">
            <label htmlFor="grp-title" className="block text-xs font-medium text-slate-700 mb-1">
              Group Title
            </label>
            <input
              id="grp-title"
              type="text"
              required
              value={newGroupTitle}
              onChange={(e) => setNewGroupTitle(e.target.value)}
              placeholder="e.g. Solana DeFi Builders"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-sky-600"
            />
          </div>
          <div>
            <label htmlFor="grp-uname" className="block text-xs font-medium text-slate-700 mb-1">
              Handle (Optional)
            </label>
            <input
              id="grp-uname"
              type="text"
              value={newGroupUsername}
              onChange={(e) => setNewGroupUsername(e.target.value)}
              placeholder="defi_builders"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg font-mono focus:outline-none focus:border-sky-600"
            />
          </div>
          <div>
            <label htmlFor="grp-count" className="block text-xs font-medium text-slate-700 mb-1">
              Auto-Indexed Pool
            </label>
            <input
              id="grp-count"
              type="number"
              min={10}
              max={120}
              value={newGroupMembers}
              onChange={(e) => setNewGroupMembers(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg font-mono tabular-nums focus:outline-none focus:border-sky-600"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={addingGroup}
              className="flex-1 px-3 py-2 text-sm font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-lg whitespace-nowrap"
            >
              {addingGroup ? 'Indexing...' : 'Add Group'}
            </button>
            <button
              type="button"
              onClick={() => setShowAddGroup(false)}
              className="px-3 py-2 text-sm text-slate-600 hover:text-slate-900"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Interactive Group Post & Background Trigger */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form onSubmit={handleTrigger} className="lg:col-span-7 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Post Ad Message with Mention Link</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                No personal Telegram login or manual member selection required. The relay detects your link and notifies every indexed group member silently.
              </p>
            </div>

            {triggerError && (
              <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3.5 py-2.5">
                {triggerError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="sim-campaign" className="block text-xs font-medium text-slate-700 mb-1">
                  Campaign Mention Link
                </label>
                <select
                  id="sim-campaign"
                  value={selectedCampaignId}
                  onChange={(e) => setSelectedCampaignId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-sky-600"
                >
                  {activeCampaigns.length === 0 ? (
                    <option value="">No active campaigns available</option>
                  ) : (
                    activeCampaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.code})
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label htmlFor="sim-group" className="block text-xs font-medium text-slate-700 mb-1">
                  Target Telegram Group
                </label>
                <select
                  id="sim-group"
                  value={selectedGroupId}
                  onChange={(e) => setSelectedGroupId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-sky-600"
                >
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title} ({g.member_count} members)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="sim-sender" className="block text-xs font-medium text-slate-700 mb-1">
                Posting Role Label
              </label>
              <input
                id="sim-sender"
                type="text"
                value={senderLabel}
                onChange={(e) => setSenderLabel(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-sky-600"
              />
            </div>

            <div>
              <label htmlFor="sim-msg" className="block text-xs font-medium text-slate-700 mb-1">
                Message Posted to Group
              </label>
              <textarea
                id="sim-msg"
                rows={4}
                required
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-sky-600 resize-y"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                {selectedGroup
                  ? `Will notify ${selectedGroup.member_count} auto-indexed members in batches of ${selectedCampaign?.batch_size || 5}`
                  : 'Select a group'}
              </span>
              <button
                type="submit"
                disabled={triggering || !selectedCampaignId || !selectedGroupId}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-45 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Send className="w-4 h-4" />
                <span>{triggering ? 'Dispatching...' : 'Post Message & Trigger Mentions'}</span>
              </button>
            </div>
          </form>

          {/* Clean Telegram Group Chat Preview */}
          <div className="lg:col-span-5 flex flex-col justify-between border-t lg:border-t-0 lg:border-l border-slate-200 pt-5 lg:pt-0 lg:pl-6 space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700 flex items-center gap-1.5">
                  <EyeOff className="w-3.5 h-3.5 text-sky-600" />
                  Group Chat Appearance
                </span>
                <span className="text-xs text-slate-500">
                  {selectedGroup?.title || 'Telegram Group'}
                </span>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-sky-700">{senderLabel || 'Ordinary Member'}</span>
                  <span className="text-slate-400 font-mono">Just now</span>
                </div>
                <p className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed break-words">
                  {messageText || 'Select a campaign to preview the advertising message.'}
                </p>
                <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between text-[11px] text-slate-500">
                  <span>Visible @usernames in message: 0</span>
                  <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                    <CheckCircle2 className="w-3 h-3" />
                    Clean Copy
                  </span>
                </div>
              </div>
            </div>

            {trackedJob && (
              <div className="border-t border-slate-200 pt-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-900">
                    Background Job ({trackedJob.group_title})
                  </span>
                  {trackedJob.status === 'completed' ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Completed
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-sky-700 font-medium">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Batch {trackedJob.current_batch}/{trackedJob.total_batches}
                    </span>
                  )}
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-sky-600 transition-all duration-200"
                    style={{
                      width: `${
                        trackedJob.total_members > 0
                          ? Math.round((trackedJob.processed_count / trackedJob.total_members) * 100)
                          : 0
                      }%`,
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs font-mono tabular-nums text-slate-600">
                  <span>
                    {trackedJob.processed_count}/{trackedJob.total_members} processed
                  </span>
                  <span>
                    {trackedJob.success_count} notified · {trackedJob.failed_count} failed
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Auto-Indexed Groups Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Auto-Indexed Telegram Groups</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Members are discovered automatically by the relay network—no manual username entry required.
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            {groups.length} groups indexed
          </span>
        </div>

        <div className="divide-y divide-slate-200">
          {groups.map((grp) => {
            const isExpanded = expandedGroupId === grp.id;
            const members = membersCache[grp.id] || [];

            return (
              <div key={grp.id} className="px-6 py-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2.5">
                      <Users className="w-4 h-4 text-slate-400 shrink-0" />
                      <span className="font-semibold text-slate-900 truncate">{grp.title}</span>
                      {grp.username && (
                        <a
                          href={`https://t.me/${grp.username}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-mono text-sky-700 hover:underline"
                        >
                          @{grp.username}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-1 pl-6">
                      <span className="capitalize">{grp.group_type}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">Chat {grp.telegram_chat_id}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{grp.mentions_triggered} campaigns triggered</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-6 pl-6 md:pl-0">
                    <div className="text-xs">
                      <div className="text-slate-500">Indexed Pool</div>
                      <div className="font-mono tabular-nums font-semibold text-slate-900 text-sm">
                        {grp.member_count}
                      </div>
                    </div>
                    <div className="text-xs">
                      <div className="text-slate-500">Reachable</div>
                      <div className="font-mono tabular-nums font-semibold text-emerald-700 text-sm">
                        {grp.reachable_count}
                      </div>
                    </div>
                    <div className="text-xs">
                      <div className="text-slate-500">Restricted</div>
                      <div className="font-mono tabular-nums font-semibold text-slate-600 text-sm">
                        {grp.restricted_count}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleToggleInspect(grp.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0"
                    >
                      <span>{isExpanded ? 'Hide Members' : 'Inspect Pool'}</span>
                      {isExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-slate-100">
                    {loadingMembersId === grp.id ? (
                      <div className="py-4 text-xs text-slate-500 flex items-center gap-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Loading auto-indexed member pool...
                      </div>
                    ) : (
                      <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-lg">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium">
                              <th className="py-2 px-3">Member</th>
                              <th className="py-2 px-3">Telegram User ID</th>
                              <th className="py-2 px-3">Handle</th>
                              <th className="py-2 px-3 text-right">Mention Reachability</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {members.map((m) => (
                              <tr key={m.id}>
                                <td className="py-2 px-3 font-medium text-slate-800">{m.display_name}</td>
                                <td className="py-2 px-3 font-mono tabular-nums text-slate-600">
                                  {m.telegram_user_id}
                                </td>
                                <td className="py-2 px-3 font-mono text-slate-500">
                                  {m.username ? `@${m.username}` : 'No username'}
                                </td>
                                <td className="py-2 px-3 text-right">
                                  {m.reachability === 'reachable' ? (
                                    <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                                      <CheckCircle2 className="w-3 h-3" />
                                      Reachable
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-rose-700 font-medium">
                                      <AlertCircle className="w-3 h-3" />
                                      {m.reachability === 'privacy_restricted'
                                        ? 'Privacy Restricted'
                                        : 'Left Group'}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
