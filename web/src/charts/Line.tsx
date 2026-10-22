import { useId } from 'react';
import { useWidth } from './useWidth';

export interface Series {
  name: string;
  colour: string;
  width?: number;
  values: (number | null)[];
}

interface Props {
  labels: string[];
  series: Series[];
  height?: number;
  /** Index positions to label on the x axis. Four to eight, flat, never rotated. */
  xTicks?: number[];
  yUnit?: string;
  /** A 1px dashed horizontal reference, e.g. the zero line for form. */
  reference?: { value: number; label: string };
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
}: Props) {
  const clipId = useId();
  const [ref, width] = useWidth();
  const padLeft = 46;
  const padRight = 12;
  const padTop = 10;
  const padBottom = 24;

  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  if (all.length === 0 || labels.length === 0) {
    return <p className="sub">No data in this range.</p>;
  }

  const dataMin = Math.min(...all, reference ? reference.value : Infinity);
  const dataMax = Math.max(...all, reference ? reference.value : -Infinity);
  const { lo, hi, ticks } = niceScale(Math.min(dataMin, 0), dataMax);

  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const x = (i: number) =>
    padLeft + (labels.length === 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW);
  const y = (v: number) => padTop + plotH - ((v - lo) / (hi - lo)) * plotH;

  const tickIndices =
    xTicks ??
    Array.from({ length: Math.min(6, labels.length) }, (_, k) =>
      Math.round((k * (labels.length - 1)) / Math.max(1, Math.min(6, labels.length) - 1)),
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
            strokeWidth={t === lo ? 2 : 1}
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
          <text
            x={width - padRight}
            y={y(reference.value) - 5}
            textAnchor="end"
            fontSize="12"
            fill="var(--muted)"
          >
            {reference.label}
          </text>
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
