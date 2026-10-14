import {RMA_STATUSES} from "../../components/rma/rmaUtils.js";

export const rmaCaseKey = value => String(value ?? "").trim().toLowerCase();

export function buildRmaRecord(formData, existingRma, email, now = new Date().toISOString()) {
  if (!email?.trim()) throw new Error("Sign in before saving a Panel RMA.");
  const fields = ["case_owner", "site_id", "case_id", "panel_manufacturer", "panel_model",
    "serial_numbers", "manufacturer_rma_number", "rma_url", "notes"];
  const data = Object.fromEntries(fields.map(field => [field, String(formData[field] ?? "").trim()]));
  if (!data.site_id || !data.case_id || !data.panel_manufacturer) throw new Error("Site ID, Case ID, and Panel Manufacturer are required.");
  if (!RMA_STATUSES.includes(formData.current_status)) throw new Error("Choose a valid RMA status.");
  const quantity = formData.panel_quantity === "" || formData.panel_quantity == null ? null : Number(formData.panel_quantity);
  if (quantity !== null && (!Number.isInteger(quantity) || quantity <= 0 || quantity > 10000)) {
    throw new Error("Panel quantity must be a whole number from 1 to 10,000.");
  }
  if (data.rma_url && !/^https?:\/\//i.test(data.rma_url)) throw new Error("The RMA URL must start with https:// or http://.");
  if (data.rma_url) {
    try {new URL(data.rma_url);} catch {throw new Error("Enter a valid RMA URL.");}
  }
  const history = [...(existingRma?.status_history || [])];
  if (formData.current_status !== existingRma?.current_status) history.push({
    previous_status: existingRma?.current_status || null, new_status: formData.current_status,
    changed_by: email.trim().toLowerCase(), changed_at: now
  });
  const preparation = formData.submission_preparation || {};
  if (typeof preparation !== "object" || Array.isArray(preparation)) throw new Error("Invalid RMA submission preparation.");
  const details = Object.fromEntries(["installation_date", "installation_address", "installer_details", "diagnosis", "manufacturer_form_url"]
    .map(key => [key, String(preparation[key] || "").trim()]));
  if (details.manufacturer_form_url) {
    let url;
    try {url = new URL(details.manufacturer_form_url);} catch {throw new Error("Enter a valid HTTPS manufacturer form URL.");}
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("Use an HTTPS manufacturer form URL without embedded credentials.");
  }
  if (preparation.checklist && (typeof preparation.checklist !== "object" || Array.isArray(preparation.checklist) ||
      Object.values(preparation.checklist).some(value => typeof value !== "boolean"))) throw new Error("Invalid RMA preparation checklist.");
  if (preparation.sources && (!Array.isArray(preparation.sources) ||
      preparation.sources.some(source => typeof source?.id !== "string" || typeof source?.title !== "string"))) throw new Error("Invalid RMA SOP references.");
  return {...data, panel_quantity: quantity, current_status: formData.current_status, status_history: history,
    submission_preparation: {...details, checklist: {...(preparation.checklist || {})},
      sources: (preparation.sources || []).map(source => ({id: source.id, title: source.title, updated_date: String(source.updated_date || "")}))}};
}

export async function saveRmaRecord({formData, existingRma, email, source}, store) {
  const records = await store.list("rmas");
  if (!Array.isArray(records)) throw new Error("Could not load the Panel RMA tracker.");
  const matches = records.filter(record => rmaCaseKey(record.case_id) === rmaCaseKey(formData.case_id));
  if (matches.some(record => record.id !== existingRma?.id)) throw new Error("This case already has a Panel RMA. Open its tracker entry instead of creating a duplicate.");
  const current = existingRma ? records.find(record => record.id === existingRma.id) : null;
  if (existingRma && !current) throw new Error("This RMA no longer exists. Refresh the tracker.");
  if (current && current.updated_date !== existingRma.updated_date) throw new Error("This RMA changed while you were editing. Reopen it before saving.");
  const data = {...buildRmaRecord(formData, current, email), ...(source || {})};
  const manufacturers = await store.list("pvManufacturers");
  if (!Array.isArray(manufacturers)) throw new Error("Could not load the Panel RMA manufacturers.");
  if (!manufacturers.some(item => item.name.toLowerCase() === data.panel_manufacturer.toLowerCase())) {
    await store.create("pvManufacturers", {name: data.panel_manufacturer});
  }
  return current ? store.update("rmas", current.id, data, {expectedUpdatedDate: existingRma.updated_date}) : store.create("rmas", data);
}
