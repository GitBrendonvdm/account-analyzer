import { useState } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, ChevronDown, Info } from 'lucide-react';

const TONE = {
  critical: { box: 'border-bad/25 bg-bad/10', text: 'text-bad', sub: 'text-bad', Icon: AlertTriangle, icon: 'text-bad' },
  warning: { box: 'border-warn/25 bg-warn/10/70', text: 'text-warn', sub: 'text-warn', Icon: ArrowDownRight, icon: 'text-warn' },
  good: { box: 'border-good/25 bg-good/10/70', text: 'text-good', sub: 'text-good', Icon: ArrowUpRight, icon: 'text-good' },
  neutral: { box: 'border-hair bg-fill', text: 'text-label', sub: 'text-label-2', Icon: Info, icon: 'text-label-2' },
};

function Headline({ h }) {
  const tone = TONE[h.tone] ?? TONE.neutral;
  const { Icon } = tone;
  return (
    <div className={`flex gap-2.5 rounded-[22px] border p-4 ${tone.box}`}>
      <Icon size={16} className={`mt-0.5 shrink-0 ${tone.icon}`} />
      <div className="min-w-0">
        <p className={`text-sm leading-snug font-medium ${tone.text}`}>{h.text}</p>
        {h.detail && <p className={`mt-1.5 text-xs leading-relaxed ${tone.sub}`}>{h.detail}</p>}
      </div>
    </div>
  );
}

/**
 * The one thing that matters most, in a sentence — and the rest a tap away.
 *
 * Deliberately placed above the page: the view below is a reference you consult, this is the part you
 * read. The headline carries the arithmetic that produced it underneath, so nothing has to be taken
 * on trust. Five of them side by side were five red boxes before the view you opened had drawn a
 * pixel, so the first shows and the others fold under one line, on every screen size.
 */
export function Headlines({ headlines }) {
  const [expanded, setExpanded] = useState(false);
  if (!headlines?.length) return null;
  const [first, ...rest] = headlines;
  return (
    <div className="flex flex-col gap-2">
      <Headline h={first} />
      {rest.length > 0 && (
        <>
          {expanded && (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {rest.map((h) => (
                <Headline key={h.id} h={h} />
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            className="press flex min-h-11 items-center gap-1.5 self-start rounded-full px-3 text-[13px] text-label-2 hover:bg-fill hover:text-label"
          >
            {expanded ? 'Fewer' : `${rest.length} more thing${rest.length === 1 ? '' : 's'} worth knowing`}
            <ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </>
      )}
    </div>
  );
}
