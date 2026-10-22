import { useWidth } from './useWidth';

interface Props {
  labels: string[];
  values: number[];
  height?: number;
  yUnit?: string;
  colour?: string;
  /** Bars drawn in the pale step: a period still in progress, not yet comparable. */
  pale?: boolean[];
  /** A native tooltip per bar. */
  titles?: string[];
}

function niceScale(max: number): { hi: number; ticks: number[] } {
  if (!Number.isFinite(max) || max <= 0) return { hi: 1, ticks: [0, 1] };
  const rawStep = max / 3;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep) ?? magnitude * 10;
  const hi = Math.ceil((max + step * 0.01) / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return { hi, ticks };
}

/** A column with a 3px top radius and a square foot on the baseline. */
function column(x: number, y: number, w: number, h: number): string {
  const r = Math.min(3, w / 2, h);
  return `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`;
}

/** Columns with zero as the baseline, empty periods drawn as real gaps. */
export function BarChart({
  labels,
  values,
  height: tallest = 180,
  yUnit,
  colour = 'var(--chart-1)',
  pale,
  titles,
}: Props) {
  const [ref, width] = useWidth();
  /* A phone gets a shorter plot, so the next card starts on the same screen. */
  const height = width < 520 ? Math.min(tallest, 200) : tallest;
  const padLeft = 32;
  const padRight = 4;
  const padTop = 8;
  const padBottom = 26;

  if (values.length === 0) return <p className="state">No data in this range.</p>;

  const { hi, ticks } = niceScale(Math.max(...values));
  const plotW = Math.max(1, width - padLeft - padRight);
  const plotH = height - padTop - padBottom;
  const slot = plotW / values.length;
  const barW = Math.max(2, Math.min(slot * 0.58, 20));
  const y = (v: number) => padTop + plotH - (v / hi) * plotH;

  /* First, middle and last on a narrow card; every fifth slot when there is room. */
  const labelled =
    plotW < 480
      ? [0, Math.round((values.length - 1) / 2), values.length - 1]
      : values.map((_, i) => i).filter((i) => i % 5 === 0 || i === values.length - 1);

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
              stroke={t === 0 ? 'var(--control)' : 'var(--grid)'}
              strokeWidth="1"
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
            <path
              key={i}
              d={column(padLeft + i * slot + (slot - barW) / 2, y(v), barW, padTop + plotH - y(v))}
              fill={pale?.[i] ? 'var(--accent-200)' : colour}
            >
              {titles?.[i] && <title>{titles[i]}</title>}
            </path>
          ) : null,
        )}

        {labelled.map((i, k) => (
          <text
            key={`${labels[i]}-${i}`}
            x={padLeft + i * slot + slot / 2}
            y={height - 6}
            textAnchor={k === 0 ? 'start' : k === labelled.length - 1 ? 'end' : 'middle'}
            fontSize="12"
            fill="var(--muted)"
          >
            {labels[i]}
          </text>
        ))}
      </svg>
    </div>
  );
}
