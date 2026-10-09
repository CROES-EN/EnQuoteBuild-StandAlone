import { canAccessPage } from "../../electron/pageAccess.mjs";
import { effectiveUserFor, isAdminUser, normalizeEmail } from "./access.js";
import { authenticateUser } from "./user-token.js";
import { broadcastMessage } from "./realtime.js";
import { json } from "./util.js";
import nativeForm from "../../shared/refundForm.cjs";

const PROCESSOR_ROLES = new Set(["invoicer"]);
const LEADERSHIP_ROLES = new Set(["approver"]);
const STATUSES = new Set(["Submitted", "Under Review", "Approved", "Denied", "Completed", "Cancelled"]);
function normalizeStatus(status) {
  return ({New: "Submitted", Processed: "Completed", Closed: "Completed"})[status] || status || "Submitted";
}
const MAX_FIELD_LENGTH = 5000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const MAX_CSV_BYTES = 1_000_000;
const MAX_CSV_ROWS = 100;

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field === "") {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) return null;
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function headerKey(value) {
  return String(value || "").trim().replace(/^\uFEFF/, "").toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

function csvSubmission(headers, cells) {
  const values = new Map(headers.map((header, index) => [headerKey(header), cells[index] ?? ""]));
  const get = (...aliases) => {
    for (const alias of aliases) {
      const key = headerKey(alias);
      if (values.has(key)) return String(values.get(key) ?? "").trim();
    }
    return "";
  };
  const parseBoolean = (value) => {
    const normalized = value.trim().toLocaleLowerCase();
    if (["yes", "true", "1"].includes(normalized)) return true;
    if (["no", "false", "0"].includes(normalized)) return false;
    return null;
  };
  const amountText = get("Refund Amount Requested", "Refund Amount", "Amount Requested").replace(/[$,\s]/g, "");
  const submittedText = get("Completion Time", "Submitted At", "Submitted Date", "Submission Date", "Start Time");
  const submittedDate = new Date(submittedText);
  const refundTypeText = get("Refund Type").toLocaleLowerCase();
  return {
    externalResponseId: get("Response Id", "Response ID", "External Response ID", "ID"),
    submittedAt: Number.isNaN(submittedDate.getTime()) ? "" : submittedDate.toISOString(),
    requestorName: get("Requestor Name", "Requestor", "Name"),
    requestorDepartment: get("Requestor Department", "Department"),
    requestorEmail: get("Requestor Email", "Email"),
    subscriptionId: get("Subscription ID", "Subscription"),
    siteId: get("Site ID", "Site"),
    customerName: get("Customer Name", "Customer"),
    refundAmountRequested: amountText && Number.isFinite(Number(amountText)) ? Number(amountText) : NaN,
    refundReason: get("Refund Reason", "Reason for Refund"),
    siteVisitCompleted: parseBoolean(get("Site Visit Completed", "Was Site Visit Completed")),
    refundType: refundTypeText === "full" ? "Full Refund" : refundTypeText === "partial" ? "Partial Refund" : get("Refund Type"),
    leadershipApprovalRequired: parseBoolean(get("Leadership Approval Required", "Leadership Approval")),
    leadershipApprovalJustification: get("Leadership Approval Justification"),
    additionalNotes: get("Additional Notes", "Notes") || null
  };
}

async function readBody(request) {
  try { return await request.json(); } catch { return null; }
}

function cleanText(value, max = MAX_FIELD_LENGTH, { optional = true } = {}) {
  if (value == null && optional) return null;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length <= max ? (text || (optional ? null : undefined)) : undefined;
}

function validEmail(value) {
  return typeof value === "string" &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validIsoDate(value) {
  return typeof value === "string" && ISO_DATE_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}

function validateSubmission(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const strings = {};
  for (const [key, max] of Object.entries({
    externalResponseId: 200,
    requestorName: 200,
    requestorDepartment: 200,
    subscriptionId: 200,
    siteId: 200,
    customerName: 300,
    refundReason: MAX_FIELD_LENGTH,
    leadershipApprovalJustification: MAX_FIELD_LENGTH,
    additionalNotes: MAX_FIELD_LENGTH
  })) {
    const optional = ["leadershipApprovalJustification", "additionalNotes"].includes(key);
    strings[key] = cleanText(body[key], max, { optional });
    if (strings[key] === undefined || (!optional && !strings[key])) return null;
  }
  if (!validIsoDate(body.submittedAt) ||
      !validEmail(body.requestorEmail) ||
      typeof body.refundAmountRequested !== "number" ||
      !Number.isFinite(body.refundAmountRequested) ||
      body.refundAmountRequested < 0 ||
      body.refundAmountRequested > 1_000_000_000 ||
      typeof body.siteVisitCompleted !== "boolean" ||
      typeof body.leadershipApprovalRequired !== "boolean" ||
      !["Full Refund", "Partial Refund"].includes(body.refundType) ||
      (body.leadershipApprovalRequired && !strings.leadershipApprovalJustification) ||
      (!body.leadershipApprovalRequired && strings.leadershipApprovalJustification)) return null;

  return {
    ...strings,
    requestorEmail: body.requestorEmail.trim().toLowerCase(),
    submittedAt: new Date(body.submittedAt).toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    refundAmountRequested: Math.round(body.refundAmountRequested * 100) / 100,
    siteVisitCompleted: body.siteVisitCompleted,
    refundType: body.refundType,
    leadershipApprovalRequired: body.leadershipApprovalRequired,
    status: "Submitted",
    storeTeamNotes: "",
    refundProcessedDate: null,
    processorName: null,
    leadershipApprover: null,
    approvalDate: null,
    escalationNotes: ""
  };
}

async function storeSubmission(env, record, actor) {
  const id = crypto.randomUUID();
  const insertedAt = new Date().toISOString();
  record.lastUpdatedAt = insertedAt;
  const inserted = await env.DB.prepare(`
    INSERT OR IGNORE INTO refund_requests (id, external_response_id, submitted_at, updated_at, data)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, record.externalResponseId, record.submittedAt, insertedAt, JSON.stringify(record)).run();
  const row = await env.DB.prepare(`
    SELECT id, data, updated_at AS updatedAt
    FROM refund_requests
    WHERE external_response_id = ?
  `).bind(record.externalResponseId).all();
  const saved = row.results?.[0];
  if (!saved) throw new Error("refund_request_insert_failed");
  if (parseJson(saved.data)?.deletedAt) return { created: false, deleted: true };
  const created = Number(inserted.meta?.changes || 0) > 0;
  if (created) {
    await env.DB.prepare(`
      INSERT INTO refund_request_audit (request_id, occurred_at, actor, action, details)
      VALUES (?, ?, ?, ?, ?)
    `).bind(saved.id, insertedAt, actor, "request_submitted", JSON.stringify({ status: "Submitted" })).run();
    await notify(env);
  }
  return { created, request: { ...parseJson(saved.data), id: saved.id, lastUpdatedAt: saved.updatedAt } };
}

const WORKBOOK_SYNC_FIELDS = new Set([
  "submittedAt", "requestorName", "requestorDepartment", "requestorEmail",
  "subscriptionId", "siteId", "customerName", "refundAmountRequested",
  "refundReason", "siteVisitCompleted", "refundType",
  "leadershipApprovalRequired", "leadershipApprovalJustification",
  "additionalNotes", "status", "storeTeamNotes", "escalationNotes",
  "refundProcessedDate", "processorName", "leadershipApprover",
  "approvalDate", "managerApproved",
  "cancellationTiming", "refundChoice", "servicesCompleted", "customerEscalated",
  "customerEmail", "caseNumber", "otherReason"
]);
const REQUIRED_WORKBOOK_FIELDS = [
  "submittedAt", "requestorName", "requestorEmail", "subscriptionId",
  "siteId", "customerName", "refundAmountRequested", "refundReason",
  "requestorDepartment", "refundType", "siteVisitCompleted",
  "leadershipApprovalRequired"
];

function workbookRecord(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const externalResponseId = cleanText(body.externalResponseId, 200, { optional: false });
  if (!externalResponseId) return null;
  for (const [field, max] of Object.entries({
    requestorName: 200,
    requestorDepartment: 200,
    subscriptionId: 200,
    siteId: 200,
    customerName: 300,
    refundReason: MAX_FIELD_LENGTH,
    leadershipApprovalJustification: MAX_FIELD_LENGTH,
    additionalNotes: MAX_FIELD_LENGTH,
    storeTeamNotes: MAX_FIELD_LENGTH,
    escalationNotes: MAX_FIELD_LENGTH,
    processorName: 200,
    leadershipApprover: 200
  })) {
    if (body[field] != null && cleanText(body[field], max) === undefined) return null;
  }
  for (const field of ["submittedAt", "refundProcessedDate", "approvalDate"]) {
    if (body[field] != null && !validIsoDate(body[field])) return null;
  }
  for (const field of ["siteVisitCompleted", "leadershipApprovalRequired", "managerApproved"]) {
    if (body[field] != null && typeof body[field] !== "boolean") return null;
  }
  for (const field of ["servicesCompleted", "customerEscalated"]) {
    if (body[field] != null && typeof body[field] !== "boolean") return null;
  }
  for (const field of ["cancellationTiming", "refundChoice", "customerEmail", "caseNumber", "otherReason"]) {
    if (body[field] != null && cleanText(body[field]) === undefined) return null;
  }
  if (body.requestorEmail != null && !validEmail(body.requestorEmail)) return null;
  if (body.refundAmountRequested != null &&
      (typeof body.refundAmountRequested !== "number" || !Number.isFinite(body.refundAmountRequested) ||
       body.refundAmountRequested < 0 || body.refundAmountRequested > 1_000_000_000)) return null;
  if (body.refundType != null && !["Full Refund", "Partial Refund"].includes(body.refundType)) return null;
  if (!STATUSES.has(normalizeStatus(body.status))) return null;

  const record = {
    externalResponseId,
    submittedAt: validIsoDate(body.submittedAt) ? new Date(body.submittedAt).toISOString() : null,
    requestorName: cleanText(body.requestorName, 200),
    requestorDepartment: cleanText(body.requestorDepartment, 200),
    requestorEmail: validEmail(body.requestorEmail) ? body.requestorEmail.trim().toLowerCase() : null,
    subscriptionId: cleanText(body.subscriptionId, 200),
    siteId: cleanText(body.siteId, 200),
    customerName: cleanText(body.customerName, 300),
    cancellationTiming: cleanText(body.cancellationTiming),
    refundChoice: cleanText(body.refundChoice),
    servicesCompleted: typeof body.servicesCompleted === "boolean" ? body.servicesCompleted : null,
    customerEscalated: typeof body.customerEscalated === "boolean" ? body.customerEscalated : null,
    customerEmail: cleanText(body.customerEmail),
    caseNumber: cleanText(body.caseNumber),
    otherReason: cleanText(body.otherReason),
    refundAmountRequested: typeof body.refundAmountRequested === "number" &&
      Number.isFinite(body.refundAmountRequested) &&
      body.refundAmountRequested >= 0 &&
      body.refundAmountRequested <= 1_000_000_000
      ? Math.round(body.refundAmountRequested * 100) / 100
      : null,
    refundReason: cleanText(body.refundReason),
    siteVisitCompleted: typeof body.siteVisitCompleted === "boolean" ? body.siteVisitCompleted : null,
    refundType: ["Full Refund", "Partial Refund"].includes(body.refundType) ? body.refundType : null,
    leadershipApprovalRequired: typeof body.leadershipApprovalRequired === "boolean"
      ? body.leadershipApprovalRequired
      : null,
    leadershipApprovalJustification: cleanText(body.leadershipApprovalJustification),
    additionalNotes: cleanText(body.additionalNotes),
    status: normalizeStatus(body.status),
    storeTeamNotes: cleanText(body.storeTeamNotes) || "",
    escalationNotes: cleanText(body.escalationNotes) || "",
    refundProcessedDate: validIsoDate(body.refundProcessedDate) ? new Date(body.refundProcessedDate).toISOString() : null,
    processorName: cleanText(body.processorName, 200),
    leadershipApprover: cleanText(body.leadershipApprover, 200),
    approvalDate: validIsoDate(body.approvalDate) ? new Date(body.approvalDate).toISOString() : null,
    managerApproved: typeof body.managerApproved === "boolean" ? body.managerApproved : null
  };
  record.missingEnQuoteFields = REQUIRED_WORKBOOK_FIELDS.filter((field) => record[field] == null);
  if (record.leadershipApprovalRequired === true && !record.leadershipApprovalJustification &&
      !record.missingEnQuoteFields.includes("leadershipApprovalJustification")) {
    record.missingEnQuoteFields.push("leadershipApprovalJustification");
  }
  return record;
}

function workbookChanges(changes) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes) ||
      Object.keys(changes).some((field) => !WORKBOOK_SYNC_FIELDS.has(field))) return null;
  const validated = {};
  for (const [field, value] of Object.entries(changes)) {
    if (["requestorName", "requestorDepartment", "subscriptionId", "siteId", "customerName",
      "refundReason", "leadershipApprovalJustification", "additionalNotes", "storeTeamNotes",
      "escalationNotes", "cancellationTiming", "refundChoice", "caseNumber", "otherReason"].includes(field)) {
      const max = field === "customerName" || field === "refundReason" ||
        field === "leadershipApprovalJustification" || field === "additionalNotes" ||
        field === "storeTeamNotes" || field === "escalationNotes" || field === "otherReason"
        ? MAX_FIELD_LENGTH
        : 300;
      const clean = cleanText(value, max);
      if (clean === undefined) return null;
      validated[field] = clean || (["storeTeamNotes", "escalationNotes"].includes(field) ? "" : null);
    } else if (field === "requestorEmail" || field === "customerEmail") {
      if (value !== null && !validEmail(value)) return null;
      validated[field] = value === null ? null : value.trim().toLowerCase();
    } else if (field === "submittedAt" || field === "refundProcessedDate" || field === "approvalDate") {
      if (value !== null && !validIsoDate(value)) return null;
      validated[field] = value === null ? null : new Date(value).toISOString();
    } else if (field === "refundAmountRequested") {
      if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000_000)) return null;
      validated[field] = value === null ? null : Math.round(value * 100) / 100;
    } else if (["siteVisitCompleted", "leadershipApprovalRequired", "managerApproved", "servicesCompleted", "customerEscalated"].includes(field)) {
      if (value !== null && typeof value !== "boolean") return null;
      validated[field] = value;
    } else if (field === "refundType") {
      if (value !== null && !["Full Refund", "Partial Refund"].includes(value)) return null;
      validated[field] = value;
    } else if (field === "status") {
      if (!STATUSES.has(value)) return null;
      validated[field] = value;
    } else if (["processorName", "leadershipApprover"].includes(field)) {
      const clean = cleanText(value, 200);
      if (clean === undefined) return null;
      validated[field] = clean;
    }
  }
  return validated;
}

function authorizedIngest(request, env) {
  return Boolean(env.REFUND_INGEST_TOKEN) &&
    request.headers.get("Authorization") === `Bearer ${env.REFUND_INGEST_TOKEN}`;
}

async function authorizeReader(request, env) {
  const auth = await authenticateUser(request, env);
  if (auth.error) return { error: auth.error };

  let user;
  try {
    user = await effectiveUserFor(env, auth.email);
  } catch (error) {
    console.error("[refund-requests] Could not resolve user access:", error.message);
    return { error: json({ ok: false, error: "roles_unavailable" }, 503) };
  }
  if (!user) return { error: json({ ok: false, error: "forbidden" }, 403) };
  if (!rolesFor(user).size) return { error: json({ ok: false, error: "forbidden" }, 403) };

  let rolePages = null;
  try {
    const result = await env.DB.prepare("SELECT value FROM admin_settings WHERE key = ?").bind("role_pages").all();
    rolePages = parseJson(result.results?.[0]?.value);
  } catch (error) {
    console.error("[refund-requests] Could not load access policy:", error.message);
    return { error: json({ ok: false, error: "access_policy_unavailable" }, 503) };
  }
  if (!canAccessPage(user, "EnphaseCare", { rolePages })) {
    return { error: json({ ok: false, error: "forbidden" }, 403) };
  }
  return { auth, user };
}

function rolesFor(user) {
  return new Set([user?.app_role, ...(Array.isArray(user?.additional_roles) ? user.additional_roles : [])]);
}

function hasRole(user, allowed) {
  const roles = rolesFor(user);
  return isAdminUser(user) || [...allowed].some((role) => roles.has(role));
}

async function notify(env) {
  try {
    await broadcastMessage(env, { type: "refund_requests_updated" });
  } catch (error) {
    console.warn("[refund-requests] Realtime notification failed:", error.message);
  }
}

export async function handleRefundRequestsList(request, env) {
  const access = await authorizeReader(request, env);
  if (access.error) return access.error;
  const result = await env.DB.prepare(`
    SELECT id, data, updated_at AS updatedAt
    FROM refund_requests
    ORDER BY submitted_at DESC, id DESC
  `).all();
  return json({
    ok: true,
    deletedExternalResponseIds: (result.results || []).map((row) => parseJson(row.data))
      .filter((record) => record?.deletedAt).map((record) => record.externalResponseId),
    requests: (result.results || []).filter((row) => !parseJson(row.data)?.deletedAt).map((row) => {
      const record = parseJson(row.data);
      return { ...record, status: normalizeStatus(record?.status), id: row.id, lastUpdatedAt: row.updatedAt };
    })
  });
}

export async function handleRefundRequestSubmit(request, env) {
  const access = await authorizeReader(request, env);
  if (access.error) return access.error;
  const body = await readBody(request);
  const record = validateSubmission({
    ...body,
    externalResponseId: `enquote-${crypto.randomUUID()}`,
    submittedAt: new Date().toISOString(),
    requestorEmail: normalizeEmail(access.auth.email)
  });
  if (!record) return json({ ok: false, error: "invalid_submission" }, 400);
  record.requestorEmail = normalizeEmail(access.auth.email);
  try {
    const saved = await storeSubmission(env, record, normalizeEmail(access.auth.email));
    if (saved.deleted) return json({ok: false, error: "request_deleted"}, 409);
    return json({ ok: true, ...saved }, saved.created ? 201 : 200);
  } catch (error) {
    console.error("[refund-requests] Could not save an EnQuote submission:", error.message);
    return json({ ok: false, error: "submission_failed" }, 500);
  }
}

export async function handleRefundRequestNativeSubmit(request, env) {
  const access = await authorizeReader(request, env);
  if (access.error) return access.error;
  const body = await readBody(request);
  const answers = nativeForm.validateAnswers(body);
  if (!answers || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body?.submissionId)) {
    return json({ok: false, error: "invalid_submission"}, 400);
  }
  const email = normalizeEmail(access.auth.email);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${email}:${body.submissionId}`));
  const externalResponseId = `native-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const record = workbookRecord({
    ...answers, externalResponseId, submittedAt: new Date().toISOString(),
    servicesCompleted: answers.servicesCompleted === null ? null : answers.servicesCompleted === "Yes",
    customerEscalated: answers.customerEscalated === "Yes",
    requestorEmail: email,
    requestorName: access.user.full_name || access.user.name || email,
    refundType: answers.refundChoice === "No refund" ? null : answers.refundChoice === "Full refund" ? "Full Refund" : "Partial Refund",
    status: "Submitted"
  });
  if (!record) return json({ok: false, error: "invalid_submission"}, 400);
  Object.assign(record, answers, {
    source: "enquote-native",
    servicesCompleted: answers.servicesCompleted === null ? null : answers.servicesCompleted === "Yes",
    customerEscalated: answers.customerEscalated === "Yes"
  });
  try {
    const saved = await storeSubmission(env, record, email);
    if (saved.deleted) return json({ok: false, error: "request_deleted"}, 409);
    return json({ok: true, ...saved}, saved.created ? 201 : 200);
  } catch (error) {
    console.error("[refund-requests] Could not save a native submission:", error.message);
    return json({ok: false, error: "submission_failed"}, 500);
  }
}

export async function handleRefundRequestWorkbookSync(request, env) {
  const access = await authorizeReader(request, env);
  if (access.error) return access.error;
  if (!hasRole(access.user, PROCESSOR_ROLES)) {
    return json({ ok: false, error: "workbook_sync_role_required" }, 403);
  }
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > 1_000_000) return json({ ok: false, error: "workbook_sync_too_large" }, 413);
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 1_000_000) {
    return json({ ok: false, error: "workbook_sync_too_large" }, 413);
  }
  const body = parseJson(rawBody);
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      !Array.isArray(body.imports) || !Array.isArray(body.updates) ||
      body.imports.length > 200 || body.updates.length > 200 ||
      (body.deletions !== undefined && (!Array.isArray(body.deletions) || body.deletions.length > 200))) {
    return json({ ok: false, error: "invalid_workbook_sync" }, 400);
  }
  const imports = body.imports.map(workbookRecord);
  if (imports.some((record) => !record) ||
      new Set(imports.map((record) => record.externalResponseId)).size !== imports.length) {
    return json({ ok: false, error: "invalid_workbook_import" }, 400);
  }
  const updates = body.updates.map((candidate) => {
    const externalResponseId = typeof candidate?.externalResponseId === "string"
      ? candidate.externalResponseId.trim()
      : "";
    const expectedUpdatedAt = typeof candidate?.expectedUpdatedAt === "string"
      ? candidate.expectedUpdatedAt
      : "";
    const changes = workbookChanges(candidate?.changes);
    return externalResponseId && externalResponseId.length <= 200 && validIsoDate(expectedUpdatedAt) && changes
      ? { externalResponseId, expectedUpdatedAt, changes }
      : null;
  });
  if (updates.some((update) => !update) ||
      new Set(updates.map((update) => update.externalResponseId)).size !== updates.length) {
    return json({ ok: false, error: "invalid_workbook_update" }, 400);
  }
  const deletions = (body.deletions || []).map((candidate) => {
    const id = cleanText(candidate?.externalResponseId, 200, {optional: false});
    return id && validIsoDate(candidate?.expectedUpdatedAt)
      ? {externalResponseId: id, expectedUpdatedAt: candidate.expectedUpdatedAt} : null;
  });
  if (deletions.some((item) => !item) ||
      new Set(deletions.map((item) => item.externalResponseId)).size !== deletions.length ||
      deletions.some((item) => imports.some((record) => record.externalResponseId === item.externalResponseId) ||
        updates.some((record) => record.externalResponseId === item.externalResponseId))) {
    return json({ok: false, error: "invalid_workbook_deletion"}, 400);
  }
  const actor = `workbook-sync:${normalizeEmail(access.auth.email)}`;
  let imported = 0;
  let updated = 0;
  let deleted = 0;
  const conflicts = [];
  try {
    for (const record of imports) {
      const existing = await env.DB.prepare(`
        SELECT id FROM refund_requests WHERE external_response_id = ?
      `).bind(record.externalResponseId).all();
      if (existing.results?.length) continue;
      const id = crypto.randomUUID();
      const insertedAt = new Date().toISOString();
      record.lastUpdatedAt = insertedAt;
      await env.DB.prepare(`
        INSERT OR IGNORE INTO refund_requests (id, external_response_id, submitted_at, updated_at, data)
        VALUES (?, ?, ?, ?, ?)
      `).bind(id, record.externalResponseId, record.submittedAt || insertedAt, insertedAt, JSON.stringify(record)).run();
      const saved = await env.DB.prepare("SELECT id FROM refund_requests WHERE external_response_id = ?")
        .bind(record.externalResponseId).all();
      if (!saved.results?.length) throw new Error("refund_workbook_import_failed");
      await env.DB.prepare(`
        INSERT INTO refund_request_audit (request_id, occurred_at, actor, action, details)
        VALUES (?, ?, ?, ?, ?)
      `).bind(saved.results[0].id, insertedAt, actor, "workbook_row_imported",
        JSON.stringify({ missingEnQuoteFields: record.missingEnQuoteFields })).run();
      imported += 1;
    }

    for (const { externalResponseId, expectedUpdatedAt, changes } of updates) {
      const result = await env.DB.prepare(`
        SELECT id, data, updated_at AS updatedAt FROM refund_requests WHERE external_response_id = ?
      `).bind(externalResponseId).all();
      const saved = result.results?.[0];
      if (!saved) {
        conflicts.push({ externalResponseId, reason: "not_found" });
        continue;
      }
      if (saved.updatedAt !== expectedUpdatedAt) {
        conflicts.push({ externalResponseId, reason: "record_changed", updatedAt: saved.updatedAt });
        continue;
      }
      const current = parseJson(saved.data);
      if (current?.deletedAt) {
        conflicts.push({externalResponseId, reason: "deleted"});
        continue;
      }
      const next = { ...current, ...changes };
      next.missingEnQuoteFields = REQUIRED_WORKBOOK_FIELDS.filter((field) => next[field] == null);
      if (next.leadershipApprovalRequired === true && !next.leadershipApprovalJustification &&
          !next.missingEnQuoteFields.includes("leadershipApprovalJustification")) {
        next.missingEnQuoteFields.push("leadershipApprovalJustification");
      }
      next.lastUpdatedAt = new Date(Math.max(Date.now(), Date.parse(saved.updatedAt) + 1)).toISOString();
      const update = await env.DB.prepare(`
        UPDATE refund_requests SET data = ?, updated_at = ?
        WHERE id = ? AND updated_at = ?
      `).bind(JSON.stringify(next), next.lastUpdatedAt, saved.id, saved.updatedAt).run();
      if (!Number(update.meta?.changes || 0)) {
        conflicts.push({ externalResponseId, reason: "record_changed" });
        continue;
      }
      await env.DB.prepare(`
        INSERT INTO refund_request_audit (request_id, occurred_at, actor, action, details)
        VALUES (?, ?, ?, ?, ?)
      `).bind(saved.id, next.lastUpdatedAt, actor, "workbook_row_updated", JSON.stringify(changes)).run();
      updated += 1;
    }
    for (const {externalResponseId, expectedUpdatedAt} of deletions) {
      const result = await env.DB.prepare(`
        SELECT id, data, updated_at AS updatedAt FROM refund_requests WHERE external_response_id = ?
      `).bind(externalResponseId).all();
      const saved = result.results?.[0];
      if (!saved || parseJson(saved.data)?.deletedAt) continue;
      if (saved.updatedAt !== expectedUpdatedAt) {
        conflicts.push({externalResponseId, reason: "record_changed", updatedAt: saved.updatedAt});
        continue;
      }
      const deletedAt = new Date(Math.max(Date.now(), Date.parse(saved.updatedAt) + 1)).toISOString();
      const next = {...parseJson(saved.data), deletedAt, deletedBy: actor, lastUpdatedAt: deletedAt};
      const deletion = await env.DB.prepare(`
        UPDATE refund_requests SET data = ?, updated_at = ? WHERE id = ? AND updated_at = ?
      `).bind(JSON.stringify(next), deletedAt, saved.id, expectedUpdatedAt).run();
      if (!Number(deletion.meta?.changes || 0)) {
        conflicts.push({externalResponseId, reason: "record_changed"});
        continue;
      }
      await env.DB.prepare(`
        INSERT INTO refund_request_audit (request_id, occurred_at, actor, action, details) VALUES (?, ?, ?, ?, ?)
      `).bind(saved.id, deletedAt, actor, "workbook_row_deleted",
        JSON.stringify({externalResponseId, previousUpdatedAt: expectedUpdatedAt})).run();
      deleted += 1;
    }
  } catch (error) {
    console.error("[refund-requests] Could not synchronize the refund workbook:", error.message);
    return json({ ok: false, error: "workbook_sync_failed" }, 500);
  }

  if (imported || updated || deleted) await notify(env);
  return json({ ok: true, imported, updated, deleted, conflicts });
}

export async function handleRefundRequestIngest(request, env) {
  if (!env.REFUND_INGEST_TOKEN) return json({ ok: false, error: "ingestion_not_configured" }, 503);
  if (!authorizedIngest(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  if (Number(request.headers.get("Content-Length")) > 32_768) {
    return json({ ok: false, error: "submission_too_large" }, 413);
  }
  const record = validateSubmission(await readBody(request));
  if (!record) return json({ ok: false, error: "invalid_submission" }, 400);
  try {
    const saved = await storeSubmission(env, record, "power-automate");
    if (saved.deleted) return json({ok: false, error: "request_deleted"}, 409);
    return json({ ok: true, ...saved }, saved.created ? 201 : 200);
  } catch (error) {
    console.error("[refund-requests] Could not ingest a Forms response:", error.message);
    return json({ ok: false, error: "ingestion_failed" }, 500);
  }
}

export async function handleRefundRequestCsvIngest(request, env) {
  if (!env.REFUND_INGEST_TOKEN) return json({ ok: false, error: "ingestion_not_configured" }, 503);
  if (!authorizedIngest(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_CSV_BYTES) return json({ ok: false, error: "csv_too_large" }, 413);
  const csv = await request.text();
  if (new TextEncoder().encode(csv).byteLength > MAX_CSV_BYTES) return json({ ok: false, error: "csv_too_large" }, 413);
  const rows = parseCsv(csv);
  if (!rows || rows.length < 2) return json({ ok: false, error: "invalid_csv" }, 400);
  const [headers, ...dataRows] = rows;
  if (dataRows.length > MAX_CSV_ROWS) return json({ ok: false, error: "too_many_csv_rows" }, 413);
  const records = dataRows.map((cells) => validateSubmission(csvSubmission(headers, cells)));
  const invalidRows = records
    .map((record, index) => record ? null : index + 2)
    .filter((line) => line !== null);
  if (invalidRows.length) return json({ ok: false, error: "invalid_csv_rows", rows: invalidRows }, 400);
  let created = 0;
  let duplicates = 0;
  try {
    for (const record of records) {
      const saved = await storeSubmission(env, record, "power-automate");
      if (saved.created) created += 1;
      else duplicates += 1;
    }
  } catch (error) {
    console.error("[refund-requests] Could not ingest Forms CSV:", error.message);
    return json({ ok: false, error: "csv_ingestion_failed", created, duplicates }, 500);
  }
  return json({ ok: true, created, duplicates, total: records.length });
}

export async function handleRefundRequestUpdate(request, env) {
  const access = await authorizeReader(request, env);
  if (access.error) return access.error;
  const { user } = access;
  const body = await readBody(request);
  const id = typeof body?.requestId === "string" ? body.requestId.trim() : "";
  const expectedStatus = typeof body?.expectedStatus === "string" ? body.expectedStatus : "";
  const expectedUpdatedAt = typeof body?.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : "";
  const changes = body?.changes;
  if (!id || id.length > 100 || !STATUSES.has(expectedStatus) ||
      !validIsoDate(expectedUpdatedAt) ||
      !changes || typeof changes !== "object" || Array.isArray(changes)) {
    return json({ ok: false, error: "invalid_update" }, 400);
  }

  const currentResult = await env.DB.prepare("SELECT data, updated_at AS updatedAt FROM refund_requests WHERE id = ?").bind(id).all();
  const currentRow = currentResult.results?.[0];
  const current = parseJson(currentRow?.data);
  if (!current || current.deletedAt) return json({ ok: false, error: "not_found" }, 404);
  if (normalizeStatus(current.status) !== expectedStatus || currentRow.updatedAt !== expectedUpdatedAt) {
    return json({ ok: false, error: "status_conflict" }, 409);
  }

  const allowedFields = new Set([
    "status", "storeTeamNotes", "refundProcessedDate", "processorName",
    "leadershipApprover", "approvalDate", "escalationNotes"
  ]);
  if (Object.keys(changes).some((key) => !allowedFields.has(key))) {
    return json({ ok: false, error: "invalid_workflow_field" }, 400);
  }

  const next = { ...current, status: normalizeStatus(current.status) };
  for (const field of ["storeTeamNotes", "escalationNotes"]) {
    if (Object.hasOwn(changes, field)) {
      const value = cleanText(changes[field], MAX_FIELD_LENGTH);
      if (value === undefined) return json({ ok: false, error: "invalid_workflow_field" }, 400);
      next[field] = value || "";
    }
  }

  for (const field of ["leadershipApprover", "approvalDate"]) {
    if (Object.hasOwn(changes, field)) {
      if (!hasRole(user, LEADERSHIP_ROLES)) return json({ ok: false, error: "approval_role_required" }, 403);
      if (field === "approvalDate") {
        if (changes[field] !== null && !validIsoDate(changes[field])) return json({ ok: false, error: "invalid_workflow_field" }, 400);
      } else {
        const value = cleanText(changes[field], 200);
        if (value === undefined) return json({ ok: false, error: "invalid_workflow_field" }, 400);
        next[field] = value;
        continue;
      }
      next[field] = changes[field];
    }
  }
  if (Object.hasOwn(changes, "refundProcessedDate")) {
    if (!hasRole(user, PROCESSOR_ROLES)) return json({ ok: false, error: "processor_role_required" }, 403);
    if (changes.refundProcessedDate !== null && !validIsoDate(changes.refundProcessedDate)) {
      return json({ ok: false, error: "invalid_workflow_field" }, 400);
    }
    next.refundProcessedDate = changes.refundProcessedDate === null
      ? null
      : new Date(changes.refundProcessedDate).toISOString();
  }

  if (Object.hasOwn(changes, "status")) {
    if (!STATUSES.has(changes.status)) return json({ ok: false, error: "invalid_status_transition" }, 400);
    const approvalTransition = changes.status === "Approved";
    if (approvalTransition && !hasRole(user, LEADERSHIP_ROLES)) return json({ ok: false, error: "approval_role_required" }, 403);
    if (!approvalTransition && !hasRole(user, PROCESSOR_ROLES)) return json({ ok: false, error: "processor_role_required" }, 403);
    if (changes.status === "Completed" && current.leadershipApprovalRequired &&
        !(next.leadershipApprover && next.approvalDate)) {
      return json({ ok: false, error: "leadership_approval_required" }, 409);
    }
    next.status = changes.status;
    if (changes.status === "Approved") {
      if (!next.leadershipApprover) next.leadershipApprover = access.user.full_name || access.user.name || normalizeEmail(access.auth.email);
      if (!next.approvalDate) next.approvalDate = new Date().toISOString();
    }
    if (changes.status === "Completed" && normalizeStatus(current.status) !== "Completed") {
      if (!next.refundProcessedDate) next.refundProcessedDate = new Date().toISOString();
      next.processorName = access.user.full_name || access.user.name || normalizeEmail(access.auth.email);
    }
  }

  if (Object.keys(changes).some((field) => ["storeTeamNotes", "escalationNotes", "refundProcessedDate", "processorName"].includes(field)) &&
      !hasRole(user, PROCESSOR_ROLES)) {
    return json({ ok: false, error: "processor_role_required" }, 403);
  }
  if (Object.hasOwn(changes, "processorName")) {
    return json({ ok: false, error: "processing_metadata_managed_by_workflow" }, 400);
  }
  next.lastUpdatedAt = new Date(Math.max(Date.now(), Date.parse(currentRow.updatedAt) + 1)).toISOString();

  const updated = await env.DB.prepare(`
    UPDATE refund_requests SET data = ?, updated_at = ?
    WHERE id = ? AND json_extract(data, '$.status') = ? AND updated_at = ?
  `).bind(JSON.stringify(next), next.lastUpdatedAt, id, current.status, expectedUpdatedAt).run();
  if (!Number(updated.meta?.changes || 0)) return json({ ok: false, error: "status_conflict" }, 409);

  const auditDetails = {};
  for (const field of Object.keys(changes)) auditDetails[field] = { oldValue: current[field] ?? null, newValue: next[field] ?? null };
  if (next.status !== current.status) {
    auditDetails.status = { oldValue: current.status, newValue: next.status };
  }
  for (const field of ["leadershipApprover", "approvalDate", "processorName", "refundProcessedDate"]) {
    if (next[field] !== current[field]) {
      auditDetails[field] = { oldValue: current[field] ?? null, newValue: next[field] ?? null };
    }
  }
  await env.DB.prepare(`
    INSERT INTO refund_request_audit (request_id, occurred_at, actor, action, details)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, next.lastUpdatedAt, normalizeEmail(access.auth.email), "workflow_updated", JSON.stringify(auditDetails)).run();
  await notify(env);
  return json({ ok: true, request: { ...next, id } });
}
