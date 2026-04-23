/** Oslo / Norway calendar shading for news line charts (ISO `YYYY-MM-DD`, local date). */

export type DayBackgroundKind = 'weekday' | 'weekend' | 'holiday';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function isoKey(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** Western Easter Sunday (Gregorian), local midnight. */
export function easterSunday(y: number): Date {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}

function addDays(base: Date, days: number): Date {
  const out = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  out.setDate(out.getDate() + days);
  return out;
}

/** Norwegian public holidays commonly used in analytics (`holidays.NO()`-style set). */
export function norwayPublicHolidayKeysForYear(y: number): Set<string> {
  const keys = new Set<string>();
  const addD = (dt: Date) => keys.add(isoKey(dt.getFullYear(), dt.getMonth() + 1, dt.getDate()));

  addD(new Date(y, 0, 1));
  addD(new Date(y, 4, 1));
  addD(new Date(y, 4, 17));
  addD(new Date(y, 11, 25));
  addD(new Date(y, 11, 26));

  const e = easterSunday(y);
  addD(addDays(e, -3));
  addD(addDays(e, -2));
  addD(e);
  addD(addDays(e, 1));
  addD(addDays(e, 39));
  addD(addDays(e, 50));
  return keys;
}

const holidayCache = new Map<number, Set<string>>();

function holidaySetForYear(y: number): Set<string> {
  let s = holidayCache.get(y);
  if (!s) {
    s = norwayPublicHolidayKeysForYear(y);
    holidayCache.set(y, s);
  }
  return s;
}

export function dayBackgroundKindFromIso(iso: string): DayBackgroundKind {
  const parts = iso.split('-');
  if (parts.length < 3) return 'weekday';
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return 'weekday';

  const key = isoKey(y, m, d);
  if (holidaySetForYear(y).has(key)) return 'holiday';

  const dow = new Date(y, m - 1, d).getDay();
  if (dow === 0 || dow === 6) return 'weekend';
  return 'weekday';
}

export function bandFillForKind(kind: DayBackgroundKind, isDark: boolean): string {
  if (kind === 'holiday') {
    return isDark ? 'rgba(250, 204, 21, 0.28)' : 'rgba(245, 158, 11, 0.22)';
  }
  if (kind === 'weekend') {
    return isDark ? 'rgba(167, 139, 250, 0.22)' : 'rgba(139, 92, 246, 0.14)';
  }
  return isDark ? 'rgba(148, 163, 184, 0.07)' : 'rgba(148, 163, 184, 0.09)';
}
