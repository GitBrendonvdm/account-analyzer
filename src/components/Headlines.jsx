import { AlertTriangle, ArrowDownRight, ArrowUpRight, Info } from 'lucide-react';

const TONE = {
  critical: { box: 'border-bad/25 bg-bad/10', text: 'text-bad', sub: 'text-bad', Icon: AlertTriangle, icon: 'text-bad' },
  warning: { box: 'border-warn/25 bg-warn/10/70', text: 'text-warn', sub: 'text-warn', Icon: ArrowDownRight, icon: 'text-warn' },
  good: { box: 'border-good/25 bg-good/10/70', text: 'text-good', sub: 'text-good', Icon: ArrowUpRight, icon: 'text-good' },
  neutral: { box: 'border-hair bg-fill', text: 'text-label', sub: 'text-label-2', Icon: Info, icon: 'text-label-2' },
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
          <div key={h.id} className={`flex gap-2.5 rounded-[22px] border p-4 ${tone.box}`}>
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
