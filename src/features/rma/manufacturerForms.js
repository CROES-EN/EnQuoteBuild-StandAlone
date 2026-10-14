export const FORM_WINDOW_RESTART_MESSAGE = "Close every EnQuote window, stop the desktop:dev terminal (Ctrl+C), then run npm run desktop:dev again. Reloading the page does not load the manufacturer form service. Installed copies need the full desktop update.";

export function validateManufacturerFormUrl(value) {
  let url;
  try {url = new URL(String(value).trim());} catch {throw new Error("Enter a valid HTTPS manufacturer form URL.");}
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".") ||
      /^[\d.]+$/.test(url.hostname) || url.hostname.startsWith("[") || url.hostname.endsWith(".local")) {
    throw new Error("Use a public HTTPS manufacturer form URL without embedded credentials.");
  }
  return url.href;
}

export async function openManufacturerForm(url, bridge = globalThis.window?.enquoteLocal) {
  const validUrl = validateManufacturerFormUrl(url);
  if (typeof bridge?.panelRmaForms?.open !== "function") throw new Error(FORM_WINDOW_RESTART_MESSAGE);
  try {
    const result = await bridge.panelRmaForms.open(validUrl);
    if (!result?.ok) {
      if (/No handler registered for/.test(result?.error || "")) throw new Error(FORM_WINDOW_RESTART_MESSAGE);
      throw new Error(result?.error || "Could not open the manufacturer form.");
    }
    return result;
  } catch (error) {
    if (/No handler registered for/.test(error?.message || "")) throw new Error(FORM_WINDOW_RESTART_MESSAGE);
    throw error;
  }
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
  "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
}[char]));

export async function saveManufacturerForm({manufacturer, label, url, file}, api) {
  const name = manufacturer.trim();
  if (!name) throw new Error("Choose a manufacturer before adding forms.");
  const formLabel = label.trim();
  if (!formLabel) throw new Error("Give this form a name.");
  const validUrl = url.trim() ? validateManufacturerFormUrl(url) : "";
  if (!validUrl && !file) throw new Error("Enter a form URL or choose a PDF/Word form to upload.");
  const id = `panel-manufacturer-forms:${encodeURIComponent(name.toLowerCase())}`;
  const docs = await api.list();
  const existing = docs.find(doc => doc.id === id);
  if (existing?.deleted) throw new Error("This manufacturer forms page was deleted. Restore it in SOP Library before adding forms.");
  const files = [...(existing?.files || [])];
  if (file) {
    const uploaded = await api.uploadFile(file);
    if (!uploaded?.fileId) throw new Error("The form upload did not return a file. Nothing was saved.");
    if (!files.some(item => item.fileId === uploaded.fileId)) files.push(uploaded);
  }
  const link = validUrl ? `<p><a href="${escapeHtml(validUrl)}">${escapeHtml(formLabel)}</a></p>` : "";
  const record = {...existing, id, title:`${name} Panel RMA Forms`, category:"Panel-Module RMA",
    panel_manufacturer:name, files, content_html:`${existing?.content_html || ""}${link}`};
  const result = await api.save(record, {baseUpdatedAt:existing?.updated_date});
  if (!result?.ok || result.reason === "conflict") {
    throw new Error(result?.reason === "conflict"
      ? "These manufacturer forms changed while saving. Refresh SOP guidance and try again."
      : result?.error || "Could not save manufacturer forms.");
  }
  return record;
}
