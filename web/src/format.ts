/** A missing value is a grey dash at label size, never a zero and never "--". */
export const DASH = '–';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function num(value: number | null | undefined, decimals = 0): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  return value.toLocaleString('en-GB', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function km(metres: number | null | undefined, decimals = 1): string {
  return metres == null ? DASH : num(metres / 1000, decimals);
}

export function hours(seconds: number | null | undefined, decimals = 1): string {
  return seconds == null ? DASH : num(seconds / 3600, decimals);
}

export function duration(seconds: number | null | undefined): string {
  if (seconds == null) return DASH;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export function watts(value: number | null | undefined): string {
  return value == null ? DASH : num(Math.round(value));
}

export function signed(value: number, decimals = 0): string {
  const formatted = num(Math.abs(value), decimals);
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `−${formatted}`;
  return formatted;
}

export function pct(part: number, whole: number, decimals = 0): string {
  if (!whole) return num(0, decimals) + '%';
  return `${num((part / whole) * 100, decimals)}%`;
}

const TYPE_NAMES: Record<string, string> = {
  road_biking: 'Road',
  mountain_biking: 'Mountain',
  indoor_cycling: 'Indoor',
  virtual_ride: 'Virtual',
  gravel_cycling: 'Gravel',
  cycling: 'Cycling',
};

/**
 * Ride names come from Garmin and the Zwift ones carry a prefix every row shares
 * ("Zwift - Group Ride: Love Riding s 2.0wkg Coffee Ride (D)"). Drop what is common,
 * cap the rest, and use the same short name at every width so the identity column is
 * never the one cut off.
 */
export function rideName(name: string | null, fallback: string): string {
  if (!name) return fallback;
  const trimmed = name
    .replace(/^zwift\s*[-–]\s*group ride:\s*/i, '')
    .replace(/^zwift\s*[-–]\s*/i, '')
    .trim();
  if (!trimmed) return fallback;
  return trimmed.length > 46 ? `${trimmed.slice(0, 45).trimEnd()}…` : trimmed;
}

export function typeName(key: string): string {
  return TYPE_NAMES[key] ?? key.replace(/_/g, ' ');
}

/** "4 Oct" — for axis labels and dense rows. */
export function shortDate(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${Number(day)} ${MONTHS[Number(month) - 1]}`;
}

/** "4 Oct 2026" — where the year matters, such as a record set years ago. */
export function longDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}

/** "Oct 26" — for an axis that spans years. */
export function monthYear(iso: string): string {
  const [year, month] = iso.split('-');
  return `${MONTHS[Number(month) - 1]} ${year?.slice(2)}`;
}

export function durationLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${seconds / 60} min`;
  return `${seconds / 3600} h`;
}

/**
 * A freshness stamp: the time for today, the date before that. Recency is read in
 * words, so "today 08:03" beats a second ISO timestamp next to the coverage range.
 */
export function stamp(isoInstant: string): string {
  const then = new Date(isoInstant);
  if (Number.isNaN(then.getTime())) return DASH;

  const time = then.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  const sameDay =
    then.getFullYear() === today.getFullYear() &&
    then.getMonth() === today.getMonth() &&
    then.getDate() === today.getDate();

  if (sameDay) return `today ${time}`;

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const wasYesterday =
    then.getFullYear() === yesterday.getFullYear() &&
    then.getMonth() === yesterday.getMonth() &&
    then.getDate() === yesterday.getDate();

  if (wasYesterday) return `yesterday ${time}`;
  return `${then.getDate()} ${MONTHS[then.getMonth()]} ${time}`;
}

/** Today in the browser's local calendar, as the API's `local_date` is written. */
export function isoDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Why a power record may be missing a ride. Empty when none is held back. */
export function heldBackNote(rides: number): string {
  if (rides === 0) return '';
  return rides === 1
    ? "1 ride is left out: its file disagrees with Garmin's own figures, and it returns once a FIT sync parses it again."
    : `${rides} rides are left out: their files disagree with Garmin's own figures, and they return once a FIT sync parses them again.`;
}
