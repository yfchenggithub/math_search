const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const SECOND_MS = 1000;

type DateTimeInput = string | number | Date | null | undefined;

type BeijingDateTimeFormatOptions = {
  includeYear?: boolean;
  includeSeconds?: boolean;
  includeMilliseconds?: boolean;
  fallback?: string;
};

const ISO_LIKE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2})(?::?(\d{2})(?::?(\d{2})(?:\.(\d+))?)?)?)?(Z|[+-]\d{2}:?\d{2})?$/i;

function padNumber(value: number, size: number): string {
  const text = String(Math.trunc(value));
  if (text.length >= size) {
    return text;
  }

  return `${"0".repeat(size - text.length)}${text}`;
}

function parseOffsetMinutes(value: string | undefined): number {
  if (!value || value.toUpperCase() === "Z") {
    return 0;
  }

  const sign = value.startsWith("-") ? -1 : 1;
  const digits = value.slice(1).replace(":", "");
  const hours = Number.parseInt(digits.slice(0, 2), 10);
  const minutes = Number.parseInt(digits.slice(2, 4), 10);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return 0;
  }

  return sign * (hours * 60 + minutes);
}

function parseIsoLikeTimestamp(text: string): number {
  const match = ISO_LIKE_PATTERN.exec(text.trim());
  if (!match) {
    return Number.NaN;
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const hour = Number.parseInt(match[4] || "0", 10);
  const minute = Number.parseInt(match[5] || "0", 10);
  const second = Number.parseInt(match[6] || "0", 10);
  const millisecond = Number.parseInt((match[7] || "0").slice(0, 3).padEnd(3, "0"), 10);
  const offsetMinutes = parseOffsetMinutes(match[8]);

  const utcTimestamp = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  if (!Number.isFinite(utcTimestamp)) {
    return Number.NaN;
  }

  return utcTimestamp - offsetMinutes * 60 * SECOND_MS;
}

function parseTimestamp(value: DateTimeInput): number {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value !== "string") {
    return Number.NaN;
  }

  const text = value.trim();
  if (!text) {
    return Number.NaN;
  }

  const isoLikeTimestamp = parseIsoLikeTimestamp(text);
  if (Number.isFinite(isoLikeTimestamp)) {
    return isoLikeTimestamp;
  }

  const parsed = new Date(text).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function getBeijingDate(value: DateTimeInput): Date | null {
  const timestamp = parseTimestamp(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return new Date(timestamp + BEIJING_OFFSET_MS);
}

export function formatBeijingDateTime(
  value: DateTimeInput,
  options: BeijingDateTimeFormatOptions = {},
): string {
  const fallback = options.fallback ?? "-";
  const date = getBeijingDate(value);
  if (!date) {
    return fallback;
  }

  const year = date.getUTCFullYear();
  const month = padNumber(date.getUTCMonth() + 1, 2);
  const day = padNumber(date.getUTCDate(), 2);
  const hour = padNumber(date.getUTCHours(), 2);
  const minute = padNumber(date.getUTCMinutes(), 2);
  const second = padNumber(date.getUTCSeconds(), 2);
  const millisecond = padNumber(date.getUTCMilliseconds(), 3);
  const dateText = options.includeYear === false
    ? `${month}-${day}`
    : `${year}-${month}-${day}`;
  let timeText = `${hour}:${minute}`;

  if (options.includeSeconds || options.includeMilliseconds) {
    timeText = `${timeText}:${second}`;
  }

  if (options.includeMilliseconds) {
    timeText = `${timeText},${millisecond}`;
  }

  return `${dateText} ${timeText}`;
}

export function formatBeijingDateForQuery(value: Date = new Date()): string {
  const date = getBeijingDate(value);
  if (!date) {
    return "";
  }

  const year = date.getUTCFullYear();
  const month = padNumber(date.getUTCMonth() + 1, 2);
  const day = padNumber(date.getUTCDate(), 2);

  return `${year}-${month}-${day}`;
}
