// One range/number rule for every quote input: labor hours, FST count, drive hours, drive
// miles and line-item quantities. FST requests often hold free text ("16-24", "30-45 minutes",
// "2 preferred (1 feasible)"); deleting the non-digits used to turn those into 1624, 3045 or 21.
//
// Rule: ranges ("16-24", "16 – 24", "16 to 24", "between 16 and 24") resolve to the upper
// bound, the worst case. Text with several alternative numbers resolves to the largest one and
// is flagged for review. Minutes convert to hours for hour fields. Digits are never joined.

const DASHES = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g;
const NUMBER = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+`;
const RANGE = new RegExp(String.raw`(?:between\s+(${NUMBER})\s*and\s*(${NUMBER}))|(?:(${NUMBER})\s*(?:-|to|through|thru)\s*(${NUMBER}))`, "i");
const NUMBERS = new RegExp(String.raw`(?<![\w.])(?:${NUMBER})(?![\d])`, "g");
const MINUTES = /\b(?:min(?:ute)?s?|mins?)\b/i;
const HOURS = /\b(?:h(?:ou)?rs?|hours?)\b/i;
const EMPTY = /^(?:unknown|n\/?a|none|tbd|tba|-+)$/i;

const toNumber = text => Number.parseFloat(String(text).replace(/,/g, ""));

/**
 * @param {unknown} value Raw field text or number.
 * @param {{unit?: "hours"}} [options] `unit: "hours"` converts minute values to hours.
 * @returns {{value: number|null, raw: string, range: [number, number]|null, ambiguous: boolean, convertedFromMinutes: boolean}}
 */
export function resolveRangeValue(value, {unit} = {}) {
  const empty = {value: null, raw: "", range: null, ambiguous: false, convertedFromMinutes: false};
  if (value === null || value === undefined) return empty;
  if (typeof value === "number") return Number.isFinite(value) ? {...empty, value, raw: String(value)} : empty;
  const raw = String(value).replace(/\u00a0/g, " ").trim();
  if (!raw || EMPTY.test(raw)) return {...empty, raw};
  const text = raw.replace(DASHES, "-");
  const minutes = unit === "hours" && MINUTES.test(text) && !HOURS.test(text);
  const scale = number => (minutes ? Math.round((number / 60) * 100) / 100 : number);

  const rangeMatch = text.match(RANGE);
  const numbers = [...text.matchAll(NUMBERS)].map(match => toNumber(match[0])).filter(Number.isFinite);
  if (rangeMatch) {
    const low = toNumber(rangeMatch[1] ?? rangeMatch[3]);
    const high = toNumber(rangeMatch[2] ?? rangeMatch[4]);
    const others = numbers.filter(number => number !== low && number !== high);
    const top = Math.max(low, high, ...others);
    return {value: scale(top), raw, range: [scale(Math.min(low, high)), scale(Math.max(low, high))],
      ambiguous: others.some(number => number > Math.max(low, high)), convertedFromMinutes: minutes};
  }
  if (!numbers.length) return {...empty, raw};
  const distinct = [...new Set(numbers)];
  return {value: scale(Math.max(...distinct)), raw, range: null, ambiguous: distinct.length > 1, convertedFromMinutes: minutes};
}

/** Upper-bound number for a field, or null when nothing numeric was given. */
export function resolveRangeNumber(value, options) {
  return resolveRangeValue(value, options).value;
}

/** True when the text is a range or holds alternative numbers that need a reviewer. */
export function needsRangeReview(value, options) {
  const resolved = resolveRangeValue(value, options);
  return Boolean(resolved.range || resolved.ambiguous || resolved.convertedFromMinutes);
}

/** Short note for review lists: `Labor hours "16-24" -> 24 (upper bound).` */
export function describeRangeResolution(label, value, options) {
  const resolved = resolveRangeValue(value, options);
  if (resolved.value === null || !(resolved.range || resolved.ambiguous || resolved.convertedFromMinutes)) return null;
  const reason = [
    resolved.range && "upper bound of the range",
    resolved.ambiguous && "largest of the numbers given",
    resolved.convertedFromMinutes && "minutes converted to hours"
  ].filter(Boolean).join("; ");
  return `${label} "${resolved.raw}" resolved to ${resolved.value} (${reason}).`;
}
