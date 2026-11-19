import { useState, useEffect, useCallback } from 'react';
import { Sidebar, type NavTab } from './components/Sidebar.tsx';
import { TopBar } from './components/TopBar.tsx';
import { OverviewView } from './components/OverviewView.tsx';
import { CampaignsView } from './components/CampaignsView.tsx';
import { GroupsView } from './components/GroupsView.tsx';
import { LogsView } from './components/LogsView.tsx';
import { BotEngineView } from './components/BotEngineView.tsx';
import { CampaignModal } from './components/CampaignModal.tsx';
import { ToastContainer, type ToastMessage } from './components/Toast.tsx';
import type {
  Campaign,
  DashboardPayload,
  GroupMember,
  MentionJob,
  MentionMode,
  TelegramGroup,
} from './types.ts';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [groups, setGroups] = useState<TelegramGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [preselectedCampaignId, setPreselectedCampaignId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = useCallback((type: 'success' | 'error', text: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { id, type, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3600);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [dashResp, cmpResp, grpResp] = await Promise.all([
        fetch('/api/dashboard'),
        fetch('/api/campaigns'),
        fetch('/api/groups'),
      ]);

      if (!dashResp.ok || !cmpResp.ok || !grpResp.ok) {
        throw new Error('Failed to load workspace data from backend.');
      }

      const [dashData, cmpData, grpData] = (await Promise.all([
        dashResp.json(),
        cmpResp.json(),
        grpResp.json(),
      ])) as [DashboardPayload, Campaign[], TelegramGroup[]];

      setDashboard(dashData);
      setCampaigns(cmpData);
      setGroups(grpData);
      setLoadError(null);
    } catch (err) {
      if (!silent) {
        setLoadError(err instanceof Error ? err.message : 'Unable to connect to server.');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll(false);
  }, [fetchAll]);

  // Live poll while any background job is queued or processing
  const hasRunningJobs = Boolean(
    dashboard?.activeJobs.some((j) => j.status === 'queued' || j.status === 'processing')
  );

  useEffect(() => {
    if (!hasRunningJobs) return;
    const timer = setInterval(() => {
      void fetchAll(true);
    }, 1000);
    return () => clearInterval(timer);
  }, [hasRunningJobs, fetchAll]);

  const handleSaveCampaign = async (payload: {
    name: string;
    destination_url: string;
    ad_copy: string;
    mention_mode: MentionMode;
    batch_size: number;
    delay_ms: number;
  }) => {
    const url = editingCampaign ? `/api/campaigns/${editingCampaign.id}` : '/api/campaigns';
    const method = editingCampaign ? 'PATCH' : 'POST';

    const resp = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data.error || 'Failed to save campaign.');
    }

    await fetchAll(true);
    pushToast(
      'success',
      editingCampaign ? 'Campaign updated.' : `Mention link generated (${data.code}).`
    );
  };

  const handleToggleCampaignStatus = async (campaign: Campaign) => {
    const nextStatus = campaign.status === 'active' ? 'paused' : 'active';
    const resp = await fetch(`/api/campaigns/${campaign.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (resp.ok) {
      await fetchAll(true);
      pushToast('success', `${campaign.name} marked as ${nextStatus}.`);
    }
  };

  const handleDeleteCampaign = async (campaignId: string) => {
    const resp = await fetch(`/api/campaigns/${campaignId}`, { method: 'DELETE' });
    if (resp.ok) {
      await fetchAll(true);
      pushToast('success', 'Campaign deleted.');
    }
  };

  const handleTriggerPost = async (payload: {
    campaign_id?: string;
    group_id: string;
    posted_by_label: string;
    message_text: string;
  }): Promise<MentionJob> => {
    const resp = await fetch('/api/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data.error || 'Unable to trigger mention job.');
    }
    await fetchAll(true);
    pushToast('success', `Background mention dispatch started for ${data.group_title}.`);
    return data as MentionJob;
  };

  const handleCreateGroup = async (payload: {
    title: string;
    username: string;
    group_type: 'supergroup' | 'group';
    initial_members: number;
  }) => {
    const resp = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) {
      pushToast('error', data.error || 'Failed to add group.');
      return;
    }
    await fetchAll(true);
    pushToast('success', `${data.title} indexed with ${data.member_count} members.`);
  };

  const handleFetchMembers = async (groupId: string): Promise<GroupMember[]> => {
    const resp = await fetch(`/api/groups/${groupId}/members`);
    if (!resp.ok) return [];
    return (await resp.json()) as GroupMember[];
  };

  const handlePauseJob = async (jobId: string) => {
    await fetch(`/api/jobs/${jobId}/pause`, { method: 'POST' });
    await fetchAll(true);
    pushToast('success', 'Background job paused.');
  };

  const handleResumeJob = async (jobId: string) => {
    await fetch(`/api/jobs/${jobId}/resume`, { method: 'POST' });
    await fetchAll(true);
    pushToast('success', 'Background job resumed.');
  };

  const handleRetryJob = async (jobId: string) => {
    const resp = await fetch(`/api/jobs/${jobId}/retry`, { method: 'POST' });
    const data = (await resp.json()) as { retried: number };
    await fetchAll(true);
    pushToast(
      'success',
      data.retried > 0
        ? `Recovered ${data.retried} failed member notifications.`
        : 'All remaining failures are permanently restricted by user privacy settings.'
    );
  };

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        activeJobsCount={dashboard?.stats.active_jobs || 0}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          activeTab={activeTab}
          onOpenMobileNav={() => setMobileNavOpen(true)}
          onNewCampaign={() => {
            setEditingCampaign(null);
            setModalOpen(true);
          }}
        />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1360px] w-full mx-auto">
          {loadError ? (
            <div className="bg-white border border-rose-200 rounded-xl p-6 text-center space-y-3">
              <p className="text-sm font-medium text-rose-700">{loadError}</p>
              <button
                type="button"
                onClick={() => void fetchAll(false)}
                className="px-4 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-lg"
              >
                Retry Connection
              </button>
            </div>
          ) : activeTab === 'overview' ? (
            <OverviewView
              data={dashboard}
              loading={loading}
              onPauseJob={handlePauseJob}
              onResumeJob={handleResumeJob}
              onRetryJob={handleRetryJob}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          ) : activeTab === 'campaigns' ? (
            <CampaignsView
              campaigns={campaigns}
              loading={loading}
              onCreateNew={() => {
                setEditingCampaign(null);
                setModalOpen(true);
              }}
              onEdit={(cmp) => {
                setEditingCampaign(cmp);
                setModalOpen(true);
              }}
              onToggleStatus={handleToggleCampaignStatus}
              onDelete={handleDeleteCampaign}
              onTriggerInGroup={(cmp) => {
                setPreselectedCampaignId(cmp.id);
                setActiveTab('groups');
              }}
              onCopySuccess={(msg) => pushToast('success', msg)}
            />
          ) : activeTab === 'groups' ? (
            <GroupsView
              campaigns={campaigns}
              groups={groups}
              activeJobs={dashboard?.activeJobs || []}
              initialCampaignId={preselectedCampaignId}
              onTriggerPost={handleTriggerPost}
              onCreateGroup={handleCreateGroup}
              onFetchMembers={handleFetchMembers}
            />
          ) : activeTab === 'logs' ? (
            <LogsView campaigns={campaigns} />
          ) : (
            <BotEngineView onToast={pushToast} />
          )}
        </main>
      </div>

      <CampaignModal
        isOpen={modalOpen}
        editingCampaign={editingCampaign}
        onClose={() => setModalOpen(false)}
        onSave={handleSaveCampaign}
      />

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
