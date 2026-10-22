import { addDays, dayDate, monthName, mondayOf, num, WEEKDAYS } from '../format';

export interface CalendarDay {
  local_date: string;
  load_points: number;
  ride_count: number;
  unmeasured_rides: number;
}

/** Garmin training load per day, in four steps: an easy hour, a solid ride, a hard one, a big day. */
export const LOAD_STEPS = [60, 120, 240];

function level(load: number): string {
  if (load < LOAD_STEPS[0]!) return 'l1';
  if (load < LOAD_STEPS[1]!) return 'l2';
  if (load < LOAD_STEPS[2]!) return 'l3';
  return 'l4';
}

/**
 * The last weeks as a calendar: a column per week, Monday at the top, each day coloured
 * by its training load.
 *
 * A day carrying a ride Garmin gave no usable load — no value at all, or a ride recorded
 * without a heart-rate strap, where Garmin returns a figure about eight times too low — is
 * hatched instead of filled. The work happened; the model cannot see it. Everywhere else
 * in this project that fact is a sentence, and a sentence is easy to skip. Here it is a
 * mark. A rest day is an empty square, not a zero.
 */
export function LoadCalendar({
  days,
  today,
  weeks = 13,
}: {
  days: CalendarDay[];
  today: string;
  weeks?: number;
}) {
  const byDate = new Map(days.map((d) => [d.local_date, d]));
  const start = addDays(mondayOf(today), -7 * (weeks - 1));
  const columns = Array.from({ length: weeks }, (_, w) => addDays(start, w * 7));

  /* The month above the first week that starts in it, and above the first column unless
     the next one already names a month and the two labels would touch. */
  const months = columns.map((monday, w) => {
    const previous = columns[w - 1];
    return previous == null || monthName(previous) !== monthName(monday) ? monthName(monday) : '';
  });
  if (months[1]) months[0] = '';

  return (
    <div
      className="calendar"
      style={{ gridTemplateColumns: `30px repeat(${weeks}, minmax(0, 1fr))` }}
      role="img"
      aria-label={`Training load per day over the last ${weeks} weeks, with rides the model cannot measure hatched`}
    >
      <span />
      {columns.map((monday, w) => (
        <span key={monday} className="calendar-day" style={{ whiteSpace: 'nowrap' }}>
          {months[w]}
        </span>
      ))}

      {WEEKDAYS.map((weekday, d) => (
        <Row key={weekday} weekday={weekday}>
          {columns.map((monday) => {
            const date = addDays(monday, d);
            if (date > today) return <span key={date} className="calendar-cell later" />;

            const day = byDate.get(date);
            const rides = day?.ride_count ?? 0;
            const classes = ['calendar-cell'];
            let title = `${dayDate(date)} · rest day`;

            if (day && day.unmeasured_rides > 0) {
              classes.push('unmeasured');
              title = `${dayDate(date)} · ${rides} ride${rides === 1 ? '' : 's'}, load not measured`;
            } else if (day && rides > 0) {
              classes.push(level(day.load_points));
              title = `${dayDate(date)} · ${rides} ride${rides === 1 ? '' : 's'}, ${num(day.load_points)} points`;
            }
            if (date === today) classes.push('today');

            return <span key={date} className={classes.join(' ')} title={title} />;
          })}
        </Row>
      ))}
    </div>
  );
}

function Row({ weekday, children }: { weekday: string; children: React.ReactNode }) {
  return (
    <>
      <span className="calendar-day">{weekday}</span>
      {children}
    </>
  );
}

/** The legend's swatches are the calendar's own cells, scaled down. */
export function CalendarLegend() {
  return (
    <div className="calendar-legend">
      <span className="steps">
        Less
        <span className="calendar-cell" />
        <span className="calendar-cell l1" />
        <span className="calendar-cell l2" />
        <span className="calendar-cell l3" />
        <span className="calendar-cell l4" />
        More
      </span>
      <span className="steps">
        <span className="calendar-cell unmeasured" />
        Not measured
      </span>
    </div>
  );
}
