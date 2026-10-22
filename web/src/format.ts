/** A missing value is a grey dash at label size, never a zero and never "--". */
export const DASH = '–';

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

const TYPE_NAMES: Record<string, string> = {
  road_biking: 'Road',
  mountain_biking: 'Mountain',
  indoor_cycling: 'Indoor',
  virtual_ride: 'Virtual',
  gravel_cycling: 'Gravel',
  cycling: 'Cycling',
};

export function typeName(key: string): string {
  return TYPE_NAMES[key] ?? key.replace(/_/g, ' ');
}

export function shortDate(iso: string): string {
  const [, month, day] = iso.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(day)} ${months[Number(month) - 1]}`;
}

export function monthYear(iso: string): string {
  const [year, month] = iso.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[Number(month) - 1]} ${year?.slice(2)}`;
}

export function durationLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${seconds / 60} min`;
  return `${seconds / 3600} h`;
}
