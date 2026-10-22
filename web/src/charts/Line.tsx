import { useId } from 'react';
import { useWidth } from './useWidth';

export interface Series {
  name: string;
  colour: string;
  width?: number;
  values: (number | null)[];
}

export interface Annotation {
  index: number;
  value: number;
  label: string;
}

interface Props {
  labels: string[];
  series: Series[];
  height?: number;
  /** Index positions to label on the x axis. Four to eight, flat, never rotated. */
  xTicks?: number[];
  yUnit?: string;
  /** A 1px dashed horizontal reference, e.g. the zero line for form. */
  reference?: { value: number; label?: string };
  /** The event that matters: a 1px marker and a 12px label in a reserved row above. */
  annotations?: Annotation[];
}

/** Round, even steps with the top tick above the maximum. */
function niceScale(min: number, max: number): { lo: number; hi: number; ticks: number[] } {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return { lo: 0, hi: 1, ticks: [0, 1] };
  }
  const span = max - min;
  const rawStep = span / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep) ?? magnitude * 10;

  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil((max + step * 0.01) / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { lo, hi, ticks };
}

export function LineChart({
  labels,
  series,
  height = 196,
  xTicks,
  yUnit,
  reference,
  annotations = [],
}: Props) {
  const clipId = useId();
  const [ref, width] = useWidth();
  const padLeft = 46;
  const padRight = 12;
  /* The label row is reserved only when there is a label, so a chart without one has no
     dead band above it. */
  const padTop = annotations.length > 0 ? 26 : 10;
  const padBottom = 24;

  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  if (all.length === 0 || labels.length === 0) {
    return <p className="sub">No data in this range.</p>;
  }

  const dataMin = Math.min(...all, reference ? reference.value : Infinity);
  const dataMax = Math.max(...all, reference ? reference.value : -Infinity);
  const { lo, hi, ticks } = niceScale(Math.min(dataMin, 0), dataMax);
  /* The heavy line is zero wherever zero is on the scale, not the lowest tick: a form
     chart that crosses zero reads from it, not from its floor. */
  const baseline = lo < 0 && hi > 0 ? 0 : lo;

  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const x = (i: number) =>
    padLeft + (labels.length === 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW);
  const y = (v: number) => padTop + plotH - ((v - lo) / (hi - lo)) * plotH;

  /* 3 labels on a phone, 4 on a tablet, 6 on a wide plot: they never collide. */
  const wanted = plotW < 360 ? 3 : plotW < 620 ? 4 : 5;
  const tickCount = Math.min(wanted, labels.length);
  const tickIndices =
    xTicks ??
    Array.from({ length: tickCount }, (_, k) =>
      Math.round((k * (labels.length - 1)) / Math.max(1, tickCount - 1)),
    );

  /** Straight segments, broken wherever the data is missing rather than interpolated. */
  function path(values: (number | null)[]): string {
    let d = '';
    let pen = false;
    values.forEach((v, i) => {
      if (v == null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  }

  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        style={{ display: 'block' }}
        role="img"
        aria-label={`${series.map((s) => s.name).join(', ')}${yUnit ? ` in ${yUnit}` : ''}`}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={padLeft} y={padTop} width={plotW} height={plotH} />
          </clipPath>
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--grid)"
              strokeWidth={t === baseline ? 2 : 1}
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

        {reference && (
          <g>
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={y(reference.value)}
              y2={y(reference.value)}
              stroke="var(--chart-grey)"
              strokeWidth="1"
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
            {reference.label && (
              <text
                x={width - padRight}
                y={y(reference.value) - 5}
                textAnchor="end"
                fontSize="12"
                fill="var(--muted)"
              >
                {reference.label}
              </text>
            )}
          </g>
        )}

        <g clipPath={`url(#${clipId})`}>
          {series.map((s) => (
            <path
              key={s.name}
              d={path(s.values)}
              fill="none"
              stroke={s.colour}
              strokeWidth={s.width ?? 2}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>

        {annotations.map((a) => {
          const ax = x(a.index);
          /* The label sits on whichever side of its marker leaves it inside the plot. */
          const anchor = ax > padLeft + plotW * 0.72 ? 'end' : ax < padLeft + plotW * 0.1 ? 'start' : 'middle';
          return (
            <g key={a.label}>
              <line
                x1={ax}
                x2={ax}
                y1={padTop - 8}
                y2={y(a.value) - 5}
                stroke="var(--chart-grey)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              <circle cx={ax} cy={y(a.value)} r="3" fill="var(--chart-1)" />
              <text x={ax} y={padTop - 14} textAnchor={anchor} fontSize="12" fill="var(--muted)">
                {a.label}
              </text>
            </g>
          );
        })}

        {tickIndices.map((i, k) => (
          <text
            key={`${labels[i]}-${i}`}
            x={x(i)}
            y={height - 6}
            textAnchor={k === 0 ? 'start' : k === tickIndices.length - 1 ? 'end' : 'middle'}
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

/** A dot legend for the card header; each swatch is the line it explains. */
export function LineLegend({ series }: { series: { name: string; colour: string }[] }) {
  return (
    <div className="legend">
      {series.map((s) => (
        <span key={s.name}>
          <svg width="12" height="12" aria-hidden="true">
            <rect y="5" width="12" height="2" rx="1" fill={s.colour} />
          </svg>
          {s.name}
        </span>
      ))}
    </div>
  );
}
