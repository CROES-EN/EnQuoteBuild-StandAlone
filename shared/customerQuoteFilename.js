export function cleanFilenamePart(value) {
  return Array.from(String(value || ""), character => character.charCodeAt(0) < 32 ? " " : character)
    .join("").replace(/[<>:"/\\|?*]/g, " ").replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "").trim().slice(0, 100);
}

export function customerQuoteFilename(name, reference) {
  const homeowner = cleanFilenamePart(name);
  if (!homeowner) throw new Error("Enter the homeowner's name for the PDF.");
  const suffix = cleanFilenamePart(reference);
  return `${homeowner} - Quote${suffix ? ` - ${suffix}` : ""}.pdf`;
}

export function quoteHomeownerName(quote) {
  for (const value of [quote?.client_name, quote?.customer]) {
    if (typeof value === "string" && cleanFilenamePart(value)) return value.trim();
  }
  return "";
}
