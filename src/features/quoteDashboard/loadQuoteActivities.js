export async function loadAllActivityPages(listPage, pageSize = 500) {
  const records = [];
  const seen = new Set();
  let offset = 0;
  while (true) {
    const page = await listPage("-action_at", pageSize, offset);
    if (!Array.isArray(page)) throw new Error("Quote activity service returned an invalid response.");
    for (const record of page) {
      if (!record?.id || seen.has(record.id)) {
        throw new Error("Quote activity pagination returned missing or duplicate IDs. Refresh to load a complete audit trail.");
      }
      seen.add(record.id);
      records.push(record);
    }
    if (page.length < pageSize) return records;
    offset += page.length;
  }
}
