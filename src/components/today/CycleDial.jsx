/**
 * Where you are in the pay cycle, as a dial.
 *
 * A progress bar states a fraction; a dial states a position — and a pay cycle is a thing you go
 * around, not along. The arc is drawn from the top and the remaining days are visible as the gap,
 * so "nearly there" reads without counting.
 */
export function CycleDial({ day, length, size = 214, stroke = 17, tone = 'var(--color-warn)' }) {
  const r = (size - stroke) / 2 - 6;
  const circumference = 2 * Math.PI * r;
  const progress = length > 0 ? Math.min(1, day / length) : 0;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.09)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 700ms var(--ease-out)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
        <div className="t-title num">Day {day}</div>
        <div className="t-label" style={{ fontSize: 13 }}>
          of {length}
        </div>
      </div>
    </div>
  );
}
