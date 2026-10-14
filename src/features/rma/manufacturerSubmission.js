// Per-manufacturer Panel RMA wizard settings, stored on pvManufacturers records.
export const RMA_SUBMISSION_METHODS = [
  {value: "form", label: "Online form / portal"},
  {value: "email", label: "Email"},
  {value: "both", label: "Form and email"}
];

export const DEFAULT_RMA_EMAIL_SUBJECT = "Panel RMA request - Case {case} - {manufacturer}";
export const RMA_TEMPLATE_TOKENS = ["{case}", "{site}", "{manufacturer}", "{model}", "{quantity}", "{serials}"];
// Outlook and some mail clients truncate or reject longer mailto links.
export const MAILTO_MAX_LENGTH = 1900;

const EMAIL_PATTERN = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;
const normalizeName = value => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function parseEmailList(value) {
  return String(value ?? "").split(/[,;\s]+/).map(item => item.trim()).filter(Boolean);
}

export function rmaWizardConfig(record) {
  if (!record) return null;
  const method = RMA_SUBMISSION_METHODS.some(option => option.value === record.rma_submission_method) ? record.rma_submission_method : "form";
  return {
    id: record.id,
    name: String(record.name || "").trim(),
    method,
    formUrl: String(record.rma_form_url || "").trim(),
    emailTo: parseEmailList(record.rma_email_to),
    emailCc: parseEmailList(record.rma_email_cc),
    emailSubject: String(record.rma_email_subject || "").trim() || DEFAULT_RMA_EMAIL_SUBJECT,
    emailIntro: String(record.rma_email_intro || "").trim(),
    instructions: String(record.rma_instructions || "").trim(),
    configured: Boolean(record.rma_submission_method)
  };
}

/** Finds the manufacturer record for an RMA: exact name first, then whole-word brand match. */
export function findManufacturerConfig(manufacturers, manufacturer) {
  const wanted = normalizeName(manufacturer);
  if (!wanted || !Array.isArray(manufacturers)) return null;
  const exact = manufacturers.find(item => normalizeName(item?.name) === wanted);
  const partial = exact || manufacturers.find(item => {
    const name = normalizeName(item?.name);
    return name && (` ${wanted} `.includes(` ${name} `) || ` ${name} `.includes(` ${wanted} `));
  });
  return rmaWizardConfig(partial);
}

/** Returns a list of problems; an empty list means the settings can be saved. */
export function validateRmaWizardSettings(settings) {
  const errors = [];
  if (!String(settings.name || "").trim()) errors.push("Manufacturer name is required.");
  const method = settings.rma_submission_method || "form";
  if (!RMA_SUBMISSION_METHODS.some(option => option.value === method)) errors.push("Choose a submission method.");
  const formUrl = String(settings.rma_form_url || "").trim();
  if (formUrl) {
    let url = null;
    try {url = new URL(formUrl);} catch {/* reported below */}
    if (!url || url.protocol !== "https:" || url.username || url.password) errors.push("Form URL must be a valid https:// link.");
  }
  const to = parseEmailList(settings.rma_email_to);
  const cc = parseEmailList(settings.rma_email_cc);
  if ((method === "email" || method === "both") && !to.length) errors.push("Add at least one To email address for email submissions.");
  const invalid = [...to, ...cc].filter(address => !EMAIL_PATTERN.test(address));
  if (invalid.length) errors.push(`Invalid email address: ${invalid.join(", ")}`);
  return errors;
}

export function fillRmaTemplate(template, data = {}) {
  const values = {
    case: data.case_id, site: data.site_id, manufacturer: data.panel_manufacturer,
    model: data.panel_model, quantity: data.panel_quantity, serials: data.serial_numbers
  };
  return String(template ?? "").replace(/\{(case|site|manufacturer|model|quantity|serials)\}/gi,
    (_match, key) => String(values[key.toLowerCase()] ?? "").trim() || `[${key.toUpperCase()} NEEDED]`);
}

export function buildRmaEmail(config, data = {}, preparation = {}) {
  const fields = [
    ["Case", data.case_id], ["Site ID", data.site_id], ["Panel manufacturer", data.panel_manufacturer],
    ["Panel model", data.panel_model], ["Panel quantity", data.panel_quantity], ["Serial numbers", data.serial_numbers],
    ["Installation date", preparation.installation_date], ["Installation address", preparation.installation_address],
    ["Installer details", preparation.installer_details], ["Problem / diagnosis and test results", preparation.diagnosis]
  ];
  const intro = config?.emailIntro ? fillRmaTemplate(config.emailIntro, data) : "Hello,\n\nPlease open a panel RMA for the module(s) below.";
  const body = [
    intro, "",
    ...fields.map(([label, value]) => `${label}: ${String(value ?? "").trim() || "[NEEDS REVIEW]"}`),
    "", "Photos and supporting documents are attached.", "", "Thank you,"
  ].join("\n");
  return {
    to: config?.emailTo || [],
    cc: config?.emailCc || [],
    subject: fillRmaTemplate(config?.emailSubject || DEFAULT_RMA_EMAIL_SUBJECT, data),
    body
  };
}

export function rmaEmailText(email) {
  return [`To: ${email.to.join("; ")}`, ...(email.cc.length ? [`Cc: ${email.cc.join("; ")}`] : []),
    `Subject: ${email.subject}`, "", email.body].join("\n");
}

/** Builds a mailto: link. Long bodies are shortened; `truncated` tells the UI to point users to Copy email. */
export function buildMailtoUrl(email) {
  const encode = encodeURIComponent;
  const params = [];
  if (email.cc.length) params.push(`cc=${email.cc.map(encode).join(",")}`);
  params.push(`subject=${encode(email.subject)}`);
  const head = `mailto:${email.to.map(encode).join(",")}?${params.join("&")}&body=`;
  const note = "\n\n[Email shortened - paste the full text copied from EnQuote.]";
  if (head.length + encode(email.body).length <= MAILTO_MAX_LENGTH) return {url: head + encode(email.body), truncated: false};
  let body = email.body;
  while (body.length && head.length + encode(body + note).length > MAILTO_MAX_LENGTH) body = Array.from(body).slice(0, -50).join("");
  return {url: head + encode(body.trimEnd() + note), truncated: true};
}
