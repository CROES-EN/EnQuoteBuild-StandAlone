// quoteRequestTextParser.js
//
// Parses the plain-text output printed by the Quote Request Agent (Step 1)
// into a structured object consumed by draftEngine.js. Pure text parsing --
// no API calls, no LLM.

function cleanLine(line) {
  return line
    .replace(/\u00A0/g, " ")
    .replace(/\*\*/g, "")
    .replace(/^[-*\u2022\u2023\u25E6\u2043\u2219\u25AA\u25CF]\s*/, "")
    .trim();
}

function toLines(rawText) {
  return rawText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => cleanLine(l))
    .filter((l) => l.length > 0);
}

function isUnknown(value) {
  if (!value) return true;
  return /^(unknown|n\/?a|none|tbd)$/i.test(String(value).trim());
}

function extractField(lines, label) {
  const re = new RegExp("^" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ":\\s*(.+)$", "i");
  for (const line of lines) {
    const match = line.match(re);
    if (match) return match[1].trim();
  }
  return null;
}

function findSectionIndex(lines, heading) {
  return lines.findIndex((l) => l.toLowerCase() === heading.toLowerCase());
}

function sliceSection(lines, heading, nextHeadings) {
  const start = findSectionIndex(lines, heading);
  if (start === -1) return [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (nextHeadings.some((h) => lines[i].toLowerCase() === h.toLowerCase())) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end);
}

// Parses a repeating "Item Name: X / Quantity: Y / Unit: Z / Notes: W" block
// into an array of entries. Each new "<label>:" that matches the first
// field name starts a new entry.
function parseRepeatingEntries(sectionLines, firstFieldLabel, fieldMap) {
  const entries = [];
  let current = null;

  const firstFieldRe = new RegExp("^" + firstFieldLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ":\\s*(.+)$", "i");

  for (const line of sectionLines) {
    const firstMatch = line.match(firstFieldRe);
    if (firstMatch) {
      if (current) entries.push(current);
      current = { name: firstMatch[1].trim() };
      continue;
    }
    if (!current) continue;
    for (const [label, key] of Object.entries(fieldMap)) {
      const re = new RegExp("^" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ":\\s*(.+)$", "i");
      const match = line.match(re);
      if (match) {
        current[key] = match[1].trim();
      }
    }
  }
  if (current) entries.push(current);

  // Drop "None" / "None Required" style empty entries.
  return entries.filter((e) => e.name && !isUnknown(e.name) && !/^none required$/i.test(e.name));
}

export function parseQuoteRequestOutput(rawText) {
  if (!rawText || !rawText.trim()) {
    throw new Error("Paste the Quote Request Agent output before generating a draft.");
  }

  const lines = toLines(rawText);

  const siteId = extractField(lines, "Site ID");
  const caseNumber = extractField(lines, "Case Number");
  const customer = extractField(lines, "Customer Name") || extractField(lines, "Customer");
  const siteAddress = extractField(lines, "Site Address");
  const quoteCategory = extractField(lines, "Quote Category");

  const problemDescription = extractField(lines, "Problem Description");
  const rootCause = extractField(lines, "Root Cause");
  const diagnosticFindings = extractField(lines, "Diagnostic Findings");
  const scopeDescription = extractField(lines, "Scope Description");

  const technicianCount = extractField(lines, "Technician Count");
  const onsiteLaborHours = extractField(lines, "Estimated Onsite Labor Hours");
  const totalLaborHours = extractField(lines, "Estimated Total Labor Hours");

  const driveHours = extractField(lines, "Total Drive Hours");
  const driveMiles = extractField(lines, "Total Drive Miles");

  const productsSection = sliceSection(lines, "Products", ["Services", "Additional Materials", "Warranty Replacements", "Technician Recommendations"]);
  const servicesSection = sliceSection(lines, "Services", ["Additional Materials", "Warranty Replacements", "Technician Recommendations"]);
  const materialsSection = sliceSection(lines, "Additional Materials", ["Warranty Replacements", "Technician Recommendations"]);

  const products = parseRepeatingEntries(productsSection, "Item Name", {
    "Quantity": "quantity",
    "Unit": "unit",
    "Notes": "notes"
  });
  const services = parseRepeatingEntries(servicesSection, "Service Name", {
    "Quantity": "quantity",
    "Unit": "unit",
    "Notes": "notes"
  });
  const materials = parseRepeatingEntries(materialsSection, "Item Name", {
    "Quantity": "quantity",
    "Unit": "unit",
    "Notes": "notes"
  });

  // Detect if any Required/Conditional field was submitted as "Unknown" --
  // used to decide whether a risk statement should be included.
  const fieldsToCheck = [
    siteId, caseNumber, customer, siteAddress, problemDescription, rootCause,
    diagnosticFindings, scopeDescription, technicianCount, onsiteLaborHours,
    driveHours, driveMiles
  ];
  const hasUnknownFields = fieldsToCheck.some((f) => isUnknown(f));

  return {
    siteId: isUnknown(siteId) ? "" : siteId || "",
    caseNumber: isUnknown(caseNumber) ? "" : caseNumber || "",
    customer: isUnknown(customer) ? "" : customer || "",
    siteAddress: isUnknown(siteAddress) ? "" : siteAddress || "",
    quoteCategory: isUnknown(quoteCategory) ? "" : quoteCategory || "",
    problemDescription: isUnknown(problemDescription) ? "" : problemDescription || "",
    rootCause: isUnknown(rootCause) ? "" : rootCause || "",
    diagnosticFindings: isUnknown(diagnosticFindings) ? "" : diagnosticFindings || "",
    scopeDescription: isUnknown(scopeDescription) ? "" : scopeDescription || "",
    technicianCount: isUnknown(technicianCount) ? null : technicianCount,
    onsiteLaborHours: isUnknown(onsiteLaborHours) ? null : onsiteLaborHours,
    totalLaborHours: isUnknown(totalLaborHours) ? null : totalLaborHours,
    driveHours: isUnknown(driveHours) ? null : driveHours,
    driveMiles: isUnknown(driveMiles) ? null : driveMiles,
    products,
    services,
    materials,
    hasUnknownFields
  };
}

// Evidence check: does this look like genuine Step 1 (Quote Request Agent)
// output, as opposed to random text or already-priced Step 2 output?
export function hasQuoteRequestEvidence(rawText) {
  const text = rawText || "";
  const markers = [
    /site id:/i,
    /case number:/i,
    /quote category:/i,
    /recommended scope of work/i,
    /technician count:/i,
    /diagnostic findings:/i
  ];
  return markers.filter((m) => m.test(text)).length >= 2;
}

