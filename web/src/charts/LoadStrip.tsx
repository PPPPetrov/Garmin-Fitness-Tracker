import { useId } from 'react';
import { shortDate } from '../format';
import { useWidth } from './useWidth';

export interface StripDay {
  local_date: string;
  load_points: number;
  ride_count: number;
  unmeasured_rides: number;
}

interface Props {
  days: StripDay[];
  height?: number;
}

/**
 * One column per day, its height the training load Garmin gave that day.
 *
 * A day carrying a ride Garmin gave no usable load — no value at all, or a ride recorded
 * without a heart-rate strap, where Garmin returns a figure about eight times too low — is
 * drawn as an open hatched column instead of a solid one, at a fixed floor height. The
 * work happened; the model cannot see it. Everywhere else in this project that fact is a
 * sentence, and a sentence is easy to skip. Here it is a mark.
 *
 * A rest day is the baseline, not a zero-height bar: there is nothing to draw.
 */
export function LoadStrip({ days, height = 132 }: Props) {
  const hatchId = useId();
  const [ref, width] = useWidth();

  const padLeft = 40;
  const padRight = 4;
  const padTop = 8;
  const padBottom = 20;

  if (days.length === 0) {
    return <p className="sub">No days in this range.</p>;
  }

  const plotW = Math.max(0, width - padLeft - padRight);
  const plotH = height - padTop - padBottom;
  const slot = plotW / days.length;
  const barW = Math.max(1.5, Math.min(slot - 1.5, 10));

  const peak = Math.max(...days.map((d) => d.load_points), 1);
  /* Round, even steps, so the half tick is a round number too. */
  const step = peak > 400 ? 100 : peak > 120 ? 50 : 20;
  const scaleTop = Math.ceil(peak / (step * 2)) * step * 2;
  const h = (load: number) => (load / scaleTop) * plotH;

  /** The floor an unmeasured day is drawn at: visible, and plainly not a measurement. */
  const floor = Math.min(14, plotH * 0.12);

  const baseline = padTop + plotH;
  const ticks = [0, Math.round((days.length - 1) / 3), Math.round(((days.length - 1) * 2) / 3), days.length - 1];

  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        style={{ display: 'block' }}
        role="img"
        aria-label={`Daily training load over the last ${days.length} days, with days the model cannot measure drawn open`}
      >
        <defs>
          <pattern
            id={hatchId}
            width="4"
            height="4"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="4" stroke="var(--chart-1)" strokeWidth="1.2" />
          </pattern>
        </defs>

        {[scaleTop, scaleTop / 2].map((t) => (
          <g key={t}>
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={baseline - h(t)}
              y2={baseline - h(t)}
              stroke="var(--grid)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={padLeft - 8}
              y={baseline - h(t) + 4}
              textAnchor="end"
              fontSize="12"
              fill="var(--muted)"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {t}
            </text>
          </g>
        ))}

        <line
          x1={padLeft}
          x2={width - padRight}
          y1={baseline}
          y2={baseline}
          stroke="var(--grid)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        <text x={padLeft - 8} y={baseline + 4} textAnchor="end" fontSize="12" fill="var(--muted)">
          0
        </text>

        {days.map((day, i) => {
          const x = padLeft + i * slot + (slot - barW) / 2;
          const unmeasured = day.unmeasured_rides > 0;
          const barH = unmeasured ? Math.max(floor, h(day.load_points)) : h(day.load_points);
          if (barH <= 0) return null;

          return unmeasured ? (
            <rect
              key={day.local_date}
              x={x}
              y={baseline - barH}
              width={barW}
              height={barH}
              fill={`url(#${hatchId})`}
              stroke="var(--chart-1)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            >
              <title>{`${day.local_date} · ride with no usable training load`}</title>
            </rect>
          ) : (
            <rect
              key={day.local_date}
              x={x}
              y={baseline - barH}
              width={barW}
              height={barH}
              fill="var(--chart-1)"
            >
              <title>{`${day.local_date} · ${Math.round(day.load_points)} points`}</title>
            </rect>
          );
        })}

        {ticks.map((i, k) => (
          <text
            key={`${days[i]?.local_date ?? i}`}
            x={padLeft + i * slot + slot / 2}
            y={height - 5}
            textAnchor={k === 0 ? 'start' : k === ticks.length - 1 ? 'end' : 'middle'}
            fontSize="12"
            fill="var(--muted)"
          >
            {days[i] ? shortDate(days[i].local_date) : ''}
          </text>
        ))}
      </svg>
    </div>
  );
}

/** The legend swatch is the mark itself, scaled down, so the two cannot drift apart. */
export function StripLegend() {
  const hatchId = useId();
  return (
    <div className="legend">
      <span>
        <svg width="10" height="12" aria-hidden="true">
          <rect width="10" height="12" fill="var(--chart-1)" />
        </svg>
        Training load
      </span>
      <span>
        <svg width="10" height="12" aria-hidden="true">
          <defs>
            <pattern
              id={hatchId}
              width="4"
              height="4"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line x1="0" y1="0" x2="0" y2="4" stroke="var(--chart-1)" strokeWidth="1.2" />
            </pattern>
          </defs>
          <rect
            width="10"
            height="12"
            fill={`url(#${hatchId})`}
            stroke="var(--chart-1)"
            strokeWidth="1"
          />
        </svg>
        Ride the model cannot measure
      </span>
    </div>
  );
}
