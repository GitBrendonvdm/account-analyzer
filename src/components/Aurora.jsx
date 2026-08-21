/**
 * The ground.
 *
 * Three soft colour fields sit behind everything and never move. They exist so the translucent
 * surfaces have something to be translucent ABOUT — glass over flat black is just a grey box, and
 * that flatness is what made the earlier drafts read as unfinished.
 *
 * Deliberately static and low-contrast: a slowly drifting full-viewport background is both a
 * distraction and an accessibility problem, so the atmosphere is fixed and the motion lives in the
 * things you touch.
 */
export function Aurora() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <div
        className="absolute rounded-full"
        style={{
          width: 'clamp(700px, 52vw, 1500px)',
          height: 'clamp(700px, 52vw, 1500px)',
          left: '-12vw',
          top: '-22vw',
          background: 'radial-gradient(circle, rgba(94,92,230,0.30), rgba(94,92,230,0) 68%)',
        }}
      />
      <div
        className="absolute rounded-full"
        style={{
          width: 'clamp(640px, 48vw, 1400px)',
          height: 'clamp(640px, 48vw, 1400px)',
          right: '-12vw',
          top: '-14vw',
          background: 'radial-gradient(circle, rgba(255,69,58,0.18), rgba(255,69,58,0) 66%)',
        }}
      />
      <div
        className="absolute rounded-full"
        style={{
          width: 'clamp(600px, 44vw, 1300px)',
          height: 'clamp(600px, 44vw, 1300px)',
          left: '32%',
          bottom: '-24vw',
          background: 'radial-gradient(circle, rgba(48,209,88,0.12), rgba(48,209,88,0) 68%)',
        }}
      />
    </div>
  );
}
