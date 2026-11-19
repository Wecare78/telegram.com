import { useState, useEffect, type FormEvent } from 'react';
import { Copy, Check, ShieldCheck, KeyRound, Webhook, CheckCircle2 } from 'lucide-react';
import type { BotConfigPublic } from '../types.ts';

interface BotEngineViewProps {
  onToast: (type: 'success' | 'error', text: string) => void;
}

export function BotEngineView({ onToast }: BotEngineViewProps) {
  const [config, setConfig] = useState<BotConfigPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [botToken, setBotToken] = useState('');
  const [autoDetectLinks, setAutoDetectLinks] = useState(true);
  const [defaultBatchSize, setDefaultBatchSize] = useState(5);
  const [defaultDelayMs, setDefaultDelayMs] = useState(450);
  const [liveMode, setLiveMode] = useState<'hybrid' | 'telegram_api'>('hybrid');
  const [saving, setSaving] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const resp = await fetch('/api/bot/config');
      if (resp.ok) {
        const data = (await resp.json()) as BotConfigPublic;
        setConfig(data);
        setAutoDetectLinks(data.auto_detect_links);
        setDefaultBatchSize(data.default_batch_size);
        setDefaultDelayMs(data.default_delay_ms);
        setLiveMode(data.live_mode);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConfig();
  }, []);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://pinglink.app';
  const webhookUrl = config ? `${origin}/api/telegram/webhook/${config.webhook_secret}` : '';

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const resp = await fetch('/api/bot/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bot_token: botToken.trim() || undefined,
          auto_detect_links: autoDetectLinks,
          default_batch_size: defaultBatchSize,
          default_delay_ms: defaultDelayMs,
          live_mode: liveMode,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Failed to update Bot Engine settings');
      }
      setBotToken('');
      await loadConfig();
      onToast('success', 'Bot Engine configuration saved.');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to save configuration.');
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnectToken = async () => {
    setSaving(true);
    try {
      const resp = await fetch('/api/bot/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear_token: true, live_mode: 'hybrid' }),
      });
      if (resp.ok) {
        await loadConfig();
        onToast('success', 'Custom bot token cleared. Reverted to managed relay queue.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCopyWebhook = async () => {
    if (!webhookUrl) return;
    await navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    onToast('success', 'Webhook URL copied to clipboard.');
    setTimeout(() => setCopiedWebhook(false), 1800);
  };

  if (loading && !config) {
    return <div className="bg-white border border-slate-200 rounded-xl h-72 animate-pulse" />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Bot Engine & Webhook Relay</h1>
        <p className="text-sm text-slate-600 mt-1">
          Configure server-side Telegram Bot API dispatch, webhook link detection, and zero-width HTML mention batching.
        </p>
      </div>

      {/* System Architecture Summary */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <div className="text-sm font-semibold text-slate-900">01. Zero Personal Account Login</div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Ordinary group members never connect phone numbers, MTProto sessions, or 2FA codes. Any group member simply pastes their campaign link.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <div className="text-sm font-semibold text-slate-900">02. Invisible HTML Mention Entities</div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Background batches embed <code className="font-mono text-slate-800">&lt;a href=&quot;tg://user?id=...&quot;&gt;&amp;#8203;&lt;/a&gt;</code> so Telegram fires real notification alerts with zero visible @username lists.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <div className="text-sm font-semibold text-slate-900">03. Automatic Member Indexing</div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Incoming webhook updates automatically index active group members into SQLite—eliminating manual member collection.
          </p>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Settings Form */}
        <form
          onSubmit={handleSave}
          className="xl:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5"
        >
          <div className="flex items-center justify-between border-b border-slate-200 pb-4">
            <div className="flex items-center gap-2.5">
              <KeyRound className="w-4 h-4 text-sky-600" />
              <h2 className="text-base font-semibold text-slate-900">Relay Bot Configuration</h2>
            </div>
            {config?.configured ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Connected (@{config.bot_username})
              </span>
            ) : (
              <span className="text-xs text-slate-500">Using Managed Relay Queue</span>
            )}
          </div>

          <div>
            <label htmlFor="bot-token" className="block text-sm font-medium text-slate-700 mb-1.5">
              Telegram Bot Token (Optional — Verified Server-Side)
            </label>
            <input
              id="bot-token"
              type="password"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder={
                config?.configured
                  ? '•••••••••••••••••••••••• (leave blank to keep current token)'
                  : '123456789:ABCdefGHIjklMNOpqrsTUVwxyz'
              }
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg font-mono focus:outline-none focus:border-sky-600"
            />
            <p className="text-xs text-slate-500 mt-1">
              Stored securely in server SQLite only and never returned to the browser. Verified via Telegram getMe API.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="eng-mode" className="block text-sm font-medium text-slate-700 mb-1.5">
                Dispatch Mode
              </label>
              <select
                id="eng-mode"
                value={liveMode}
                onChange={(e) => setLiveMode(e.target.value as 'hybrid' | 'telegram_api')}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-sky-600"
              >
                <option value="hybrid">Managed Relay Queue</option>
                <option value="telegram_api">Live Telegram Bot API</option>
              </select>
            </div>

            <div>
              <label htmlFor="eng-batch" className="block text-sm font-medium text-slate-700 mb-1.5">
                Default Batch Size
              </label>
              <input
                id="eng-batch"
                type="number"
                min={1}
                max={15}
                value={defaultBatchSize}
                onChange={(e) => setDefaultBatchSize(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg font-mono tabular-nums focus:outline-none focus:border-sky-600"
              />
            </div>

            <div>
              <label htmlFor="eng-delay" className="block text-sm font-medium text-slate-700 mb-1.5">
                Batch Delay (ms)
              </label>
              <input
                id="eng-delay"
                type="number"
                min={200}
                max={2500}
                step={50}
                value={defaultDelayMs}
                onChange={(e) => setDefaultDelayMs(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg font-mono tabular-nums focus:outline-none focus:border-sky-600"
              />
            </div>
          </div>

          <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoDetectLinks}
              onChange={(e) => setAutoDetectLinks(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-sky-600 focus:ring-sky-600"
            />
            <span>Automatically trigger background mentions when a campaign link is detected in webhook messages</span>
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200">
            {config?.configured ? (
              <button
                type="button"
                onClick={() => void handleDisconnectToken()}
                disabled={saving}
                className="px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50 rounded-lg transition-colors"
              >
                Clear Bot Token
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <ShieldCheck className="w-4 h-4 text-slate-400" />
                Flood-safe batch pacing active
              </span>
            )}

            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {saving ? 'Saving...' : 'Save Engine Settings'}
            </button>
          </div>
        </form>

        {/* Webhook & Payload Spec */}
        <section className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex items-center gap-2.5 border-b border-slate-200 pb-4">
            <Webhook className="w-4 h-4 text-sky-600" />
            <h2 className="text-base font-semibold text-slate-900">Webhook & Payload Spec</h2>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-700">Telegram Webhook Endpoint</div>
            <div className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
              <span className="font-mono text-xs text-slate-800 truncate">{webhookUrl}</span>
              <button
                type="button"
                onClick={() => void handleCopyWebhook()}
                className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-800 whitespace-nowrap shrink-0"
              >
                {copiedWebhook ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedWebhook ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Register this HTTPS endpoint with Telegram <code className="font-mono">setWebhook</code> to automatically index group members and detect campaign links in real time.
            </p>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-100">
            <div className="text-xs font-medium text-slate-700">Live Telegram Activation (3 Steps)</div>
            <ol className="text-xs text-slate-600 space-y-1.5 list-decimal list-inside leading-relaxed">
              <li>
                Create a relay bot in <span className="font-mono text-slate-800">@BotFather</span> and run{' '}
                <span className="font-mono text-slate-800">/setprivacy</span> → <span className="font-medium text-slate-800">Disable</span> so it can detect your campaign link in group messages.
              </li>
              <li>
                Paste the Bot Token here and switch Dispatch Mode to <span className="font-medium text-slate-800">Live Telegram Bot API</span>. The server starts real-time <span className="font-mono text-slate-800">getUpdates</span> polling automatically.
              </li>
              <li>
                Paste any generated <span className="font-mono text-slate-800">/m/cmp_...</span> link into your ad message inside any group where the relay bot is present—PingLink replies with invisible mentions automatically.
              </li>
            </ol>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-100">
            <div className="text-xs font-medium text-slate-700">Invisible Mention Batch Format (HTML)</div>
            <pre className="p-3 bg-slate-900 text-slate-100 rounded-lg text-[11px] font-mono overflow-x-auto leading-relaxed">
{`{
  "chat_id": "-1001948201142",
  "reply_to_message_id": 482,
  "parse_mode": "HTML",
  "text": "·<a href=\\"tg://user?id=510000019\\">&#8203;</a><a href=\\"tg://user?id=510000156\\">&#8203;</a>"
}`}
            </pre>
            <p className="text-xs text-slate-500">
              Telegram delivers genuine native mention push alerts for each referenced user ID while rendering zero visible @usernames in the group chat.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
