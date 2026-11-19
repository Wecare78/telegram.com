import { Menu, Plus } from 'lucide-react';
import type { NavTab } from './Sidebar.tsx';

interface TopBarProps {
  activeTab: NavTab;
  onOpenMobileNav: () => void;
  onNewCampaign: () => void;
}

const TAB_LABELS: Record<NavTab, string> = {
  overview: 'Overview',
  campaigns: 'Campaigns',
  groups: 'Groups & Trigger',
  logs: 'Delivery Logs',
  engine: 'Bot Engine',
};

export function TopBar({ activeTab, onOpenMobileNav, onNewCampaign }: TopBarProps) {
  return (
    <header className="h-14 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-8 shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileNav}
          aria-label="Open navigation menu"
          className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-md focus-visible:outline-2 focus-visible:outline-sky-600"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 text-sm min-w-0 truncate">
          <span className="text-slate-500 hidden sm:inline whitespace-nowrap">PingLink</span>
          <span className="text-slate-300 hidden sm:inline" aria-hidden="true">/</span>
          <span className="font-display font-semibold text-slate-900 truncate">
            {TAB_LABELS[activeTab]}
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={onNewCampaign}
        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
      >
        <Plus className="w-4 h-4 shrink-0" />
        <span>New Campaign</span>
      </button>
    </header>
  );
}
