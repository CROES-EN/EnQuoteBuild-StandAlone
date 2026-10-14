// Finds where a draft line item came from in the original O&M quote request comment.
const normalize = value => String(value || "").toLowerCase().replace(/\s+/g, " ").trim();

export function itemRequestedPhrase(item = {}) {
  return String(item.source_line?.name || item.requested_name || "").trim();
}

// Returns {lines, matchIndex} around the first comment line mentioning the item, or null.
export function findSourceExcerpt(comment, item = {}, {before = 1, after = 3} = {}) {
  const lines = String(comment || "").split(/\r?\n/);
  const phrases = [...new Set([itemRequestedPhrase(item), item.name].map(normalize).filter(phrase => phrase.length >= 2))];
  for (const phrase of phrases) {
    const matchIndex = lines.findIndex(line => normalize(line).includes(phrase));
    if (matchIndex < 0) continue;
    const start = Math.max(0, matchIndex - before);
    const end = Math.min(lines.length, matchIndex + after + 1);
    return {phrase, lines: lines.slice(start, end), matchIndex: matchIndex - start};
  }
  return null;
}
