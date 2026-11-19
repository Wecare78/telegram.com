import { useState, useEffect, type FormEvent } from 'react';
import { X, EyeOff, ExternalLink } from 'lucide-react';
import type { Campaign, MentionMode } from '../types.ts';

interface CampaignModalProps {
  isOpen: boolean;
  editingCampaign: Campaign | null;
  onClose: () => void;
  onSave: (payload: {
    name: string;
    destination_url: string;
    ad_copy: string;
    mention_mode: MentionMode;
    batch_size: number;
    delay_ms: number;
  }) => Promise<void>;
}

export function CampaignModal({ isOpen, editingCampaign, onClose, onSave }: CampaignModalProps) {
  const [name, setName] = useState('');
  const [destinationUrl, setDestinationUrl] = useState('https://');
  const [adCopy, setAdCopy] = useState('');
  const [mentionMode, setMentionMode] = useState<MentionMode>('zero_width_html');
  const [batchSize, setBatchSize] = useState(5);
  const [delayMs, setDelayMs] = useState(450);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (editingCampaign) {
        setName(editingCampaign.name);
        setDestinationUrl(editingCampaign.destination_url);
        setAdCopy(editingCampaign.ad_copy);
        setMentionMode(editingCampaign.mention_mode);
        setBatchSize(editingCampaign.batch_size);
        setDelayMs(editingCampaign.delay_ms);
      } else {
        setName('');
        setDestinationUrl('https://');
        setAdCopy('');
        setMentionMode('zero_width_html');
        setBatchSize(5);
        setDelayMs(450);
      }
      setError(null);
    }
  }, [isOpen, editingCampaign]);

  if (!isOpen) return null;

  const previewCode = editingCampaign?.code || 'cmp_auto8k';
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://pinglink.app';
  const previewLink = `${baseUrl}/m/${previewCode}`;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSave({
        name,
        destination_url: destinationUrl,
        ad_copy: adCopy,
        mention_mode: mentionMode,
        batch_size: batchSize,
        delay_ms: delayMs,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save campaign.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="campaign-modal-title"
        className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-lg"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 id="campaign-modal-title" className="text-lg font-semibold text-slate-900">
              {editingCampaign ? 'Edit Campaign' : 'Create Mention Link Campaign'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Generates a unique tracking link that triggers silent background mentions when posted in any group.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-2 text-slate-400 hover:text-slate-700 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3.5 py-2.5">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="cmp-name" className="block text-sm font-medium text-slate-700 mb-1.5">
                Campaign Name
              </label>
              <input
                id="cmp-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Q4 Product Beta Invite"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-sky-600"
              />
            </div>

            <div>
              <label htmlFor="cmp-url" className="block text-sm font-medium text-slate-700 mb-1.5">
                Destination URL
              </label>
              <input
                id="cmp-url"
                type="url"
                required
                value={destinationUrl}
                onChange={(e) => setDestinationUrl(e.target.value)}
                placeholder="https://example.com/offer"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg font-mono focus:outline-none focus:border-sky-600"
              />
            </div>
          </div>

          <div>
            <label htmlFor="cmp-copy" className="block text-sm font-medium text-slate-700 mb-1.5">
              Advertising Message Copy
            </label>
            <textarea
              id="cmp-copy"
              rows={3}
              required
              value={adCopy}
              onChange={(e) => setAdCopy(e.target.value)}
              placeholder="Write the promotional message you will paste into Telegram groups. Do not add @usernames—mentions are triggered silently in the background."
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-sky-600 resize-y"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="cmp-mode" className="block text-sm font-medium text-slate-700 mb-1.5">
                Invisible Mention Mode
              </label>
              <select
                id="cmp-mode"
                value={mentionMode}
                onChange={(e) => setMentionMode(e.target.value as MentionMode)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-sky-600"
              >
                <option value="zero_width_html">Zero-Width HTML (Trailing)</option>
                <option value="inline_anchor">Inline Anchor (Leading)</option>
              </select>
            </div>

            <div>
              <label htmlFor="cmp-batch" className="block text-sm font-medium text-slate-700 mb-1.5">
                Batch Size (Members/Ping)
              </label>
              <input
                id="cmp-batch"
                type="number"
                min={1}
                max={15}
                value={batchSize}
                onChange={(e) => setBatchSize(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg font-mono tabular-nums focus:outline-none focus:border-sky-600"
              />
            </div>

            <div>
              <label htmlFor="cmp-delay" className="block text-sm font-medium text-slate-700 mb-1.5">
                Batch Interval (ms)
              </label>
              <input
                id="cmp-delay"
                type="number"
                min={200}
                max={2500}
                step={50}
                value={delayMs}
                onChange={(e) => setDelayMs(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg font-mono tabular-nums focus:outline-none focus:border-sky-600"
              />
            </div>
          </div>

          <div className="border-t border-slate-200 pt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-700 flex items-center gap-1.5">
                <EyeOff className="w-3.5 h-3.5 text-sky-600" />
                Telegram Group Message Preview (Zero Visible Usernames)
              </span>
              <span className="text-xs font-mono text-slate-500">{previewCode}</span>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-sm text-slate-800 space-y-2">
              <p className="whitespace-pre-wrap leading-relaxed">
                {adCopy.trim() || 'Your promotional message text will appear cleanly here without any @username spam.'}
              </p>
              <div className="inline-flex items-center gap-1.5 text-sky-700 font-mono text-xs underline break-all">
                <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                <span>{previewLink}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {submitting ? 'Saving...' : editingCampaign ? 'Save Changes' : 'Generate Mention Link'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
