const COMPETING_MICROINVERTER_BRANDS = [
  "solarbridge", "enecsys", "abb", "tigo", "solaredge", "chilicon",
  "apsystems", "sma", "hoymiles", "sunpower"
];

export function isMicroinverterMention(text) {
  return /\bmicro[ -]?inverters?\b|\b(?:IQ[678](?:[A-Z+]+)?|M(?:190|210|215|250))\b/i.test(String(text || ""));
}

export function mentionsCompetingMicroinverterBrand(text) {
  const lower = String(text || "").toLowerCase();
  return COMPETING_MICROINVERTER_BRANDS.some(brand => new RegExp(`\\b${brand}\\b`).test(lower));
}

export function isAffirmative(value) {
  return /^\s*(yes|true|required|approved|confirmed)\s*$/i.test(String(value || ""));
}

export function indicatesActiveWarrantyOrRma(rmaRequired, warrantyStatus) {
  if (isAffirmative(rmaRequired)) return true;
  const status = String(warrantyStatus || "");
  return !/\b(?:inactive|expired|not|out|void|cancelled)\b/i.test(status) &&
    /\b(?:under\s*warranty|active|in\s*warranty|approved|covered)\b/i.test(status);
}
