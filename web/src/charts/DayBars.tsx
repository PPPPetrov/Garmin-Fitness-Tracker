import { addDays, dayDate, duration, WEEKDAYS } from '../format';

/**
 * This week, Monday to Sunday: one track per day, filled by the hours ridden on it. A day
 * still to come is an outline, so an empty Friday is not read as a rest day yet.
 */
export function DayBars({
  monday,
  today,
  seconds,
}: {
  monday: string;
  today: string;
  /** Ride time per ISO date. */
  seconds: Map<string, number>;
}) {
  const days = WEEKDAYS.map((weekday, i) => {
    const date = addDays(monday, i);
    return { weekday, date, s: seconds.get(date) ?? 0, later: date > today };
  });
  /* Two hours fills a track unless a longer day needs the room. */
  const scale = Math.max(7200, ...days.map((d) => d.s));

  return (
    <div className="day-bars" role="img" aria-label="Hours ridden on each day of this week">
      {days.map((d) => (
        <div
          className="day-bar"
          key={d.date}
          title={`${dayDate(d.date)} · ${d.later ? 'still to come' : d.s > 0 ? duration(d.s) : 'no ride'}`}
        >
          <div className={d.later ? 'day-bar-track later' : 'day-bar-track'}>
            {d.s > 0 && (
              <div className="day-bar-fill" style={{ height: `${(d.s / scale) * 100}%` }} />
            )}
          </div>
          <span>{d.weekday.slice(0, 1)}</span>
        </div>
      ))}
    </div>
  );
}
