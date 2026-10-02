import * as XLSX from "xlsx";

// Parses the "Field Team" tab of the FST Contact List workbook into FST roster rows.
// Only the contact/address columns are used - skill, badge, photo and shirt-size
// columns are intentionally ignored. The sheet's "Shipping Address" and "Uhaul Address"
// columns describe the same place (material orders ship to the U-Haul unit), so the
// shipping address wins and the U-Haul address is only a fallback when it is blank.
export const FIELD_TEAM_SHEET = "Field Team";

const clean = (value) =>
  String(value ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

const cleanAddress = (value) => clean(value).replace(/^uhaul:\s*/i, "");

const normalizeKey = (value) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const normalizeEmployeeId = (value) => clean(value).toUpperCase();

const stateZipFromAddress = (address) => {
  const match = /\b([A-Z]{2})\s*,?\s*(\d{5})(?:-\d{4})?\b/.exec(address || "");
  return match ? { state: match[1], zip: match[2] } : { state: "", zip: "" };
};

export function parseFieldTeamWorkbook(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const sheetName = workbook.SheetNames.find((n) => normalizeKey(n) === normalizeKey(FIELD_TEAM_SHEET));
  if (!sheetName) {
    throw new Error(`The workbook has no "${FIELD_TEAM_SHEET}" tab.`);
  }

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", raw: false });
  const records = [];

  for (const row of rows) {
    const byHeader = {};
    for (const [header, value] of Object.entries(row)) byHeader[normalizeKey(header)] = value;

    const name = clean(byHeader["technicians"]);
    if (!name) continue;

    const shippingAddress = cleanAddress(byHeader["shipping address"]) || cleanAddress(byHeader["uhaul address"]);
    const { state, zip } = stateZipFromAddress(shippingAddress);

    records.push({
      name,
      employee_id: normalizeEmployeeId(byHeader["fs number seedstock"]),
      supervisor: clean(byHeader["fst sup"]),
      email: clean(byHeader["email address"]),
      phone: clean(byHeader["phone number"]),
      shipping_address: shippingAddress,
      home_address: cleanAddress(byHeader["home address"]),
      region: clean(byHeader["state"]),
      home_state: clean(byHeader["home state"]),
      fsl_case_no: clean(byHeader["dummy fsl case no"]),
      state,
      zip,
      is_active: true
    });
  }

  return records;
}
