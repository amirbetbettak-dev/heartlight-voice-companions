// Phone number helpers for SMS sign-in; Iranian mobile numbers are the default.
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function toLatinDigits(value: string) {
  return value.replace(/[۰-۹٠-٩]/g, (digit) => {
    const persian = PERSIAN_DIGITS.indexOf(digit);
    return String(persian >= 0 ? persian : ARABIC_DIGITS.indexOf(digit));
  });
}

/**
 * Normalize a phone number to E.164. Accepts Iranian forms like 0912…, 912…, 98912…, +98912…
 * and any other number written with a leading + country code. Returns null when invalid.
 */
export function normalizePhone(input: string): string | null {
  const raw = toLatinDigits(input).replace(/[\s\-().]/g, "");
  if (/^\+\d{8,15}$/.test(raw)) {
    if (raw.startsWith("+98")) return /^\+989\d{9}$/.test(raw) ? raw : null;
    return raw;
  }
  const digits = raw.replace(/^00/, "+").replace(/^\+/, "");
  if (/^09\d{9}$/.test(digits)) return `+98${digits.slice(1)}`;
  if (/^9\d{9}$/.test(digits)) return `+98${digits}`;
  if (/^989\d{9}$/.test(digits)) return `+${digits}`;
  if (raw.startsWith("00") && /^\d{8,15}$/.test(digits)) return `+${digits}`;
  return null;
}

/** Display an E.164 Iranian number as 0912 345 6789. */
export function formatPhone(e164: string) {
  const match = /^\+98(9\d{2})(\d{3})(\d{4})$/.exec(e164);
  return match ? `0${match[1]} ${match[2]} ${match[3]}` : e164;
}
