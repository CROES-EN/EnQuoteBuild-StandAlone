const normalize = value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function manufacturerMatches(text, manufacturer) {
  const brand = normalize(manufacturer);
  return Boolean(brand && (` ${normalize(text)} `).includes(` ${brand} `));
}

export function manufacturerFormResources(docs, manufacturer, readBlocks) {
  if (!normalize(manufacturer)) return [];
  const result = [];
  const seen = new Set();
  for (const doc of selectRmaSops(docs)) {
    const specific = manufacturerMatches(doc.title, manufacturer);
    for (const block of readBlocks(doc.content_html || "")) {
      if (!specific && !manufacturerMatches(block.text, manufacturer)) continue;
      for (const link of block.links) {
        let url;
        try {url = new URL(link.href);} catch {continue;}
        if (url.protocol !== "https:" || url.username || url.password || seen.has(url.href)) continue;
        seen.add(url.href);
        result.push({url:url.href, label:link.text || url.hostname, sourceId:doc.id, sourceTitle:doc.title});
      }
    }
  }
  return result;
}

export function selectRmaSops(docs, manufacturer = "", search = "") {
  const byId = new Map(docs.filter(Boolean).map(doc => [doc.id, doc]));
  const context = doc => {
    const titles = [doc.title, doc.category];
    const visited = new Set([doc.id]);
    const pending = [doc.parent_id, doc.section_id];
    while (pending.length) {
      const id = pending.pop();
      if (!id || visited.has(id)) continue;
      visited.add(id);
      const parent = byId.get(id);
      if (!parent) continue;
      titles.push(parent.title);
      pending.push(parent.parent_id, parent.section_id, parent.workbook_id);
    }
    return normalize(titles.join(" "));
  };
  const terms = normalize(search).split(" ").filter(Boolean);
  const brand = normalize(manufacturer);
  const unique = new Map();
  for (const doc of docs) {
    if (!doc || doc.deleted || ["section", "workbook"].includes(doc.kind)) continue;
    const scope = context(doc);
    const text = normalize(`${scope} ${doc.summary || ""} ${doc.content_html || ""} ${(doc.tags || []).join(" ")} ${(doc.files || []).map(file => file.name).join(" ")}`);
    if (!/\b(panel|panels|module|modules)\b/.test(scope) && !/\b(panel|module)\b.{0,60}\brma\b/.test(text)) continue;
    if (!terms.every(term => text.includes(term))) continue;
    const score = (brand && scope.includes(brand) ? 100 : 0) +
      (/standard rma submission|panel submission req|fst checklist/.test(scope) ? 50 : 0);
    const key = `${normalize(doc.title)}|${doc.content_html || ""}|${JSON.stringify(doc.files || [])}`;
    const prior = unique.get(key);
    if (!prior || String(doc.updated_date || "") > String(prior.doc.updated_date || "")) unique.set(key, {doc, score});
  }
  return [...unique.values()].sort((a, b) => b.score - a.score || String(a.doc.title).localeCompare(String(b.doc.title))).map(item => item.doc);
}

export function buildRmaSubmissionText(data, preparation, sources) {
  const fields = [
    ["Case", data.case_id], ["Site ID", data.site_id], ["Case owner", data.case_owner],
    ["Manufacturer", data.panel_manufacturer], ["Panel model", data.panel_model],
    ["Panel quantity", data.panel_quantity], ["Serial numbers", data.serial_numbers],
    ["Manufacturer RMA number", data.manufacturer_rma_number],
    ["Installation date", preparation.installation_date], ["Installation address", preparation.installation_address],
    ["Installer details", preparation.installer_details], ["Problem / diagnosis and test results", preparation.diagnosis],
    ["Notes", data.notes]
  ];
  const reviewed = preparation.checklist || {};
  return [
    `Subject: Panel RMA request - Case ${data.case_id || "[CASE NEEDED]"} - ${data.panel_manufacturer || "[MANUFACTURER NEEDED]"}`,
    "", ...fields.map(([label, value]) => `${label}: ${String(value ?? "").trim() || "[NEEDS REVIEW]"}`),
    "", "Preparation checklist (user-confirmed; files are not attached by EnQuote):",
    ...Object.entries(reviewed).map(([label, checked]) => `${checked ? "[Checked]" : "[Review needed]"} ${label}`),
    "", "SOP references:", ...sources.map(doc => `${doc.title} (updated ${doc.updated_date || "unknown"}; ${doc.id})`),
    "", "Review the current manufacturer instructions, complete their form, and attach actual evidence files before sending. This draft has not been submitted."
  ].join("\n");
}

export function suggestedRmaChecklist(blocks) {
  return [...new Set(blocks.map(value => String(value).replace(/\s+/g, " ").trim())
    .filter(value => value.length >= 8 && value.length <= 500 &&
      /\b(photo|photos|serial|proof|test|voltage|current|power|form|attach|installation|installer|monitoring)\b/i.test(value)))];
}
