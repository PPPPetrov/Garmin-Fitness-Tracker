import { useId, type ReactNode } from 'react';

/**
 * A card: a pale header band with the title and its info mark, a white body, and a footer
 * link only when there is somewhere to go from it.
 */
export function Card({
  title,
  info,
  aside,
  foot,
  flush,
  className,
  bodyClassName,
  children,
}: {
  title: string;
  /** The definition behind the title, kept out of the body so the body shows figures. */
  info?: ReactNode;
  aside?: ReactNode;
  foot?: ReactNode;
  /** The body has no padding of its own: a table carries it in its cells. */
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section className={className ? `card ${className}` : 'card'}>
      <header className="card-head">
        <div className="card-title-wrap">
          <h2 className="card-title">{title}</h2>
          {info != null && <Info>{info}</Info>}
        </div>
        {aside != null && <div className="card-aside">{aside}</div>}
      </header>
      <div className={['card-body', flush && 'flush', bodyClassName].filter(Boolean).join(' ')}>
        {children}
      </div>
      {foot != null && <footer className="card-foot">{foot}</footer>}
    </section>
  );
}

/** An info mark whose tooltip opens on hover and on keyboard focus. */
export function Info({ children }: { children: ReactNode }) {
  const id = useId();
  return (
    <button type="button" className="info" aria-label="About this figure" aria-describedby={id}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 7.25v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="5.1" r="0.9" fill="currentColor" />
      </svg>
      <span className="tip" role="tooltip" id={id}>
        {children}
      </span>
    </button>
  );
}

/** "See details →" — the way out of a card, to the screen that has the rest. */
export function More({
  href,
  accent,
  children = 'See details',
}: {
  href: string;
  accent?: boolean;
  children?: ReactNode;
}) {
  return (
    <a className={accent ? 'more more-accent' : 'more'} href={href}>
      {children}
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M2 7h10M8 3l4 4-4 4" />
      </svg>
    </a>
  );
}

/**
 * A change with its direction drawn and its meaning coloured: `tone` says whether this
 * direction is good or bad for this metric, or neither. Zero is grey and has no arrow.
 */
export function Delta({
  value,
  text,
  tone,
}: {
  value: number;
  text: string;
  tone: 'good' | 'bad' | 'even';
}) {
  if (value === 0) return <span className="delta even">{text}</span>;
  return (
    <span className={`delta ${tone}`}>
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={value < 0 ? { transform: 'rotate(180deg)' } : undefined}
      >
        <path d="M6 10V2M2.5 5.5 6 2l3.5 3.5" />
      </svg>
      {text}
    </span>
  );
}

const ICON = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function SearchIcon() {
  return (
    <svg {...ICON}>
      <circle cx="7" cy="7" r="4.75" />
      <path d="m10.5 10.5 3 3" />
    </svg>
  );
}

export function SyncIcon() {
  return (
    <svg {...ICON}>
      <path d="M13.25 6.5A5.5 5.5 0 0 0 3.2 4.8M2.75 9.5a5.5 5.5 0 0 0 10.05 1.7" />
      <path d="M3 2v3h3M13 14v-3h-3" />
    </svg>
  );
}

export function MenuIcon() {
  return (
    <svg {...ICON}>
      <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
    </svg>
  );
}

export function DatabaseIcon() {
  return (
    <svg {...ICON} width={18} height={18}>
      <ellipse cx="8" cy="3.75" rx="5.25" ry="1.75" />
      <path d="M2.75 3.75v8.5c0 .97 2.35 1.75 5.25 1.75s5.25-.78 5.25-1.75v-8.5" />
      <path d="M2.75 8c0 .97 2.35 1.75 5.25 1.75S13.25 8.97 13.25 8" />
    </svg>
  );
}
