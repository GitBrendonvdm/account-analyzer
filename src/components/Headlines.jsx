import { AlertTriangle, ArrowDownRight, ArrowUpRight, Info } from 'lucide-react';

const TONE = {
  critical: { box: 'border-red-200 bg-red-50/70', text: 'text-red-900', sub: 'text-red-700', Icon: AlertTriangle, icon: 'text-red-600' },
  warning: { box: 'border-amber-200 bg-amber-50/70', text: 'text-amber-900', sub: 'text-amber-700', Icon: ArrowDownRight, icon: 'text-amber-600' },
  good: { box: 'border-emerald-200 bg-emerald-50/70', text: 'text-emerald-900', sub: 'text-emerald-700', Icon: ArrowUpRight, icon: 'text-emerald-600' },
  neutral: { box: 'border-slate-200 bg-slate-50', text: 'text-slate-800', sub: 'text-slate-600', Icon: Info, icon: 'text-slate-500' },
};

/**
 * The four or five things that matter, in sentences.
 *
 * Deliberately placed above the tabs: the table below is a reference you consult, this is the part
 * you read. Each line carries the arithmetic that produced it underneath, so nothing has to be
 * taken on trust.
 */
export function Headlines({ headlines }) {
  if (!headlines?.length) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {headlines.map((h) => {
        const tone = TONE[h.tone] ?? TONE.neutral;
        const { Icon } = tone;
        return (
          <div key={h.id} className={`flex gap-2.5 rounded-xl border p-4 ${tone.box}`}>
            <Icon size={16} className={`mt-0.5 shrink-0 ${tone.icon}`} />
            <div className="min-w-0">
              <p className={`text-sm leading-snug font-medium ${tone.text}`}>{h.text}</p>
              {h.detail && <p className={`mt-1.5 text-xs leading-relaxed ${tone.sub}`}>{h.detail}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
