import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Card } from './Surface';

/**
 * The preview's frame. A centred card on a desktop; on a phone a bottom sheet that rises to at
 * most the screen's height, with the heading and the Confirm/Cancel row pinned while the account
 * list scrolls between them — a long FNB page must not push the buttons out of reach.
 *
 * Rendered into the body through a portal: the upload chip lives inside the top bar's phone menu,
 * which is display:none while closed, and a fixed overlay under a hidden ancestor is hidden too.
 */
export function Sheet({ title, subtitle, onClose, footer, children }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end md:block md:overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        className="fixed inset-0 cursor-default bg-ground/70"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative w-full md:mx-auto md:my-24 md:max-w-2xl md:px-4">
        {/* `.glass` sets the radius outside Tailwind's layers, so squaring the bottom corners on a
            phone needs the important flag to win. */}
        <Card className="materialize flex max-h-[calc(100dvh-2rem)] flex-col p-6 max-md:rounded-b-none! max-md:px-5 max-md:pt-5 max-md:pb-[max(1.25rem,env(safe-area-inset-bottom))] md:max-h-none">
          <div className="flex shrink-0 items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="t-head">{title}</h2>
              {subtitle && <p className="t-label mt-1.5 max-w-prose">{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="press -m-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-label-3 hover:bg-fill hover:text-label"
            >
              <X size={16} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          {footer && <div className="shrink-0">{footer}</div>}
        </Card>
      </div>
    </div>,
    document.body,
  );
}
