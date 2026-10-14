import {parseQuoteRequestCase} from "./parseQuoteRequestCase.js";
import {resolveRangeNumber} from "../quoteDraftAgent/rangeValues.js";

// Drafts saved before ranges were handled consistently could hold joined digits ("16-24" as
// 1624 hours). Compares each saved input with the request's upper bound.
export function sourceInputChecks(sourceComment) {
  const request = parseQuoteRequestCase(sourceComment || "").request;
  const labor = resolveRangeNumber(request.onsiteLaborHours, {unit: "hours"}) !== null
    ? request.onsiteLaborHours : request.totalLaborHours;
  return [
    {field: "fst_count", label: "Technicians", raw: request.technicianCount, value: Math.ceil(resolveRangeNumber(request.technicianCount) || 0) || null},
    {field: "labor_hours", label: "Labor hours", raw: labor, value: resolveRangeNumber(labor, {unit: "hours"})},
    {field: "travel_hours", label: "Travel hours", raw: request.driveHours, value: resolveRangeNumber(request.driveHours, {unit: "hours"})},
    {field: "miles_traveled", label: "Miles", raw: request.driveMiles, value: resolveRangeNumber(request.driveMiles)}
  ];
}

export function exceededSourceInputs(draft, sourceComment) {
  return sourceInputChecks(sourceComment)
    .filter(check => check.value !== null && Number(draft?.[check.field]) > check.value)
    .map(check => ({...check, saved: Number(draft[check.field])}));
}

const NOTE_PATTERNS = {
  fst_count: saved => new RegExp(`\\b${saved}( technicians? assigned)`, "g"),
  labor_hours: saved => new RegExp(`(labor hours: )${saved}( hours?)`, "gi"),
  travel_hours: saved => new RegExp(`(travel(?: time)?(?: hours)?: )${saved}( hours?)`, "gi"),
  miles_traveled: saved => new RegExp(`(miles(?: traveled)?: )${saved}\\b`, "gi")
};

export function applySourceInputCorrections(draft, exceeded) {
  let notes = String(draft?.notes || "");
  for (const check of exceeded) {
    const pattern = NOTE_PATTERNS[check.field]?.(check.saved);
    if (pattern) notes = notes.replace(pattern, (...groups) => groups.length > 4
      ? `${groups[1]}${check.value}${groups[2]}` : `${check.value}${groups[1]}`);
  }
  return {...draft, ...Object.fromEntries(exceeded.map(check => [check.field, check.value])), ...(draft?.notes != null ? {notes} : {})};
}

// Unsent drafts nobody has edited are corrected automatically; reviewer-edited drafts keep
// their values and show the "Apply request values" warning instead.
// Earlier drafts priced some unmatched lines from their notes ("bolts for microinverter
// mounting" took the microinverter average). Only lowers prices on untouched placeholder lines.
export function overpricedPlaceholders(draft, placeholderPrice, categoryAverages = {}) {
  if (typeof placeholderPrice !== "function") return [];
  const averagePrices = Object.values(categoryAverages).map(Number);
  return (draft?.items || []).flatMap((item, index) => {
    const price = Number(item?.unit_price);
    if (item?.confidence !== "low" || !(price > 0) || !averagePrices.some(avg => Math.abs(avg - price) < 0.005)) return [];
    const source = item.source_line || {};
    if (source.kind === "service") return [];
    const next = placeholderPrice(item.requested_name || item.name, source.notes || "");
    if (!next || !(next.unitPrice < price - 0.005)) return [];
    return [{index, name: item.name, from: price, to: next.unitPrice, section: next.section}];
  });
}

export function automaticSourceInputCorrection(record, sourceComment, {placeholderPrice, categoryAverages} = {}) {
  if (!record?.draft || record.sentToQuotes || record.editedBeforeSend) return null;
  const exceeded = exceededSourceInputs(record.draft, sourceComment);
  const repriced = overpricedPlaceholders(record.draft, placeholderPrice, categoryAverages);
  if (!exceeded.length && !repriced.length) return null;
  const summary = [
    ...exceeded.map(check => `${check.label} ${check.saved} → ${check.value} (request: "${check.raw}")`),
    ...repriced.map(fix => `${fix.name} placeholder price $${fix.from.toFixed(2)} → $${fix.to.toFixed(2)} each`)
  ];
  let draft = exceeded.length ? applySourceInputCorrections(record.draft, exceeded) : record.draft;
  if (repriced.length) {
    const byIndex = new Map(repriced.map(fix => [fix.index, fix]));
    draft = {...draft, items: draft.items.map((item, index) => {
      const fix = byIndex.get(index);
      if (!fix) return item;
      return {...item, unit_price: fix.to, total: Math.round(fix.to * (Number(item.quantity) || 0) * 100) / 100, section: fix.section || item.section};
    })};
  }
  return {
    ...record,
    draft,
    inputCorrections: [...(record.inputCorrections || []), {at: new Date().toISOString(), changes: summary}],
    parseWarnings: [...(record.parseWarnings || []), `Automatically corrected values that exceeded the request: ${summary.join("; ")}.`]
  };
}
