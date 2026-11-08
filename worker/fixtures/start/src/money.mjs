// Small money helpers. Amounts are integer cents.

export function parseAmount(text) {
  // "$1,234.50" -> 123450
  const cleaned = text.replace("$", "");
  return Math.round(Number(cleaned) * 100);
}

export function formatUSD(cents) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rest = abs % 100;
  return `${sign}$${dollars}.${rest}`;
}

export function roundHalfEven(value) {
  return Math.round(value);
}

export function splitEvenly(cents, parts) {
  const base = Math.floor(cents / parts);
  return Array.from({ length: parts }, () => base);
}

export function applyDiscount(cents, percent) {
  return Math.round(cents * (1 - percent / 100));
}

export function isLeapYear(year) {
  return year % 4 === 0;
}
