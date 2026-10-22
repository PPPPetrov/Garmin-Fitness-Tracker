import { useWidth } from './useWidth';

interface Props {
  labels: string[];
  values: number[];
  height?: number;
  yUnit?: string;
  colour?: string;
  xTickEvery?: number;
}

function niceScale(max: number): { hi: number; ticks: number[] } {
  if (!Number.isFinite(max) || max <= 0) return { hi: 1, ticks: [0, 1] };
  const rawStep = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep) ?? magnitude * 10;
  const hi = Math.ceil((max + step * 0.01) / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return { hi, ticks };
}

/** Columns with square corners, zero as the baseline, empty periods drawn as real gaps. */
export function BarChart({
  labels,
  values,
  height = 180,
  yUnit,
  colour = 'var(--chart-ink)',
  xTickEvery,
}: Props) {
  const [ref, width] = useWidth();
  const padLeft = 46;
  const padRight = 12;
  const padTop = 10;
  const padBottom = 24;

  if (values.length === 0) return <p className="sub">No data in this range.</p>;

  const { hi, ticks } = niceScale(Math.max(...values));
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const slot = plotW / values.length;
  const barW = Math.max(2, Math.min(slot * 0.68, 46));
  const y = (v: number) => padTop + plotH - (v / hi) * plotH;

  const every = xTickEvery ?? Math.max(1, Math.ceil(values.length / 6));

  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        style={{ display: 'block' }}
        role="img"
        aria-label={yUnit ?? 'bars'}
      >
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={padLeft}
            x2={width - padRight}
            y1={y(t)}
            y2={y(t)}
            stroke="var(--grid)"
            strokeWidth={t === 0 ? 2 : 1}
            vectorEffect="non-scaling-stroke"
          />
          <text
            x={padLeft - 8}
            y={y(t) + 4}
            textAnchor="end"
            fontSize="12"
            fill="var(--muted)"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {t}
          </text>
        </g>
      ))}

      {values.map((v, i) =>
        v > 0 ? (
          <rect
            key={i}
            x={padLeft + i * slot + (slot - barW) / 2}
            y={y(v)}
            width={barW}
            height={Math.max(0, padTop + plotH - y(v))}
            fill={colour}
          />
        ) : null,
      )}

      {labels.map((label, i) =>
        i % every === 0 ? (
          <text
            key={`${label}-${i}`}
            x={padLeft + i * slot + slot / 2}
            y={height - 6}
            textAnchor="middle"
            fontSize="12"
            fill="var(--muted)"
          >
            {label}
          </text>
        ) : null,
      )}
      </svg>
    </div>
  );
}
