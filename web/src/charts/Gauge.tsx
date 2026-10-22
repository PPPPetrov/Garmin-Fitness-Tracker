import type { ReactNode } from 'react';

/**
 * A half-dial of ticks, filled from the left to `value` (0–1). The figure it stands for
 * goes in the centre as HTML, so it stays text and keeps the page's face.
 */
export function Gauge({
  value,
  centre,
  ends,
  label,
}: {
  value: number;
  centre: ReactNode;
  ends: [string, string];
  label: string;
}) {
  const ticks = 41;
  const width = 280;
  const outer = 132;
  const inner = 104;
  const cx = width / 2;
  const cy = outer + 4;
  const filled = Math.round(Math.max(0, Math.min(1, value)) * (ticks - 1));

  return (
    <div className="gauge">
      <div className="gauge-dial">
        <svg
          width={width}
          height={cy + 4}
          viewBox={`0 0 ${width} ${cy + 4}`}
          role="img"
          aria-label={label}
        >
          {Array.from({ length: ticks }, (_, i) => {
            const angle = Math.PI * (1 - i / (ticks - 1));
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            return (
              <line
                key={i}
                x1={cx + inner * cos}
                y1={cy - inner * sin}
                x2={cx + outer * cos}
                y2={cy - outer * sin}
                stroke={i <= filled ? 'var(--chart-1)' : 'var(--accent-100)'}
                strokeWidth="3"
                strokeLinecap="round"
              />
            );
          })}
        </svg>
        <div className="gauge-centre">{centre}</div>
      </div>
      <div className="gauge-ends">
        <span>{ends[0]}</span>
        <span>{ends[1]}</span>
      </div>
    </div>
  );
}

/** A thin ring for one share of a whole, with the share printed in its centre. */
export function Ring({ share, label, size = 84 }: { share: number; label: string; size?: number }) {
  const stroke = 9;
  const radius = (size - stroke) / 2;
  const length = 2 * Math.PI * radius;
  const part = Math.max(0, Math.min(1, share));

  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--accent-100)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${length * part} ${length}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="ring-label">{Math.round(part * 100)}%</span>
    </div>
  );
}
