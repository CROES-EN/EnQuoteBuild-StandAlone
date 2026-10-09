const crypto = require("node:crypto");

const WORKBOOK_FIELDS = [
  "submittedAt",
  "requestorName",
  "requestorDepartment",
  "requestorEmail",
  "subscriptionId",
  "siteId",
  "customerName",
  "refundAmountRequested",
  "refundReason",
  "siteVisitCompleted",
  "refundType",
  "leadershipApprovalRequired",
  "leadershipApprovalJustification",
  "additionalNotes",
  "status",
  "storeTeamNotes",
  "escalationNotes",
  "refundProcessedDate",
  "processorName",
  "leadershipApprover",
  "approvalDate",
  "managerApproved",
  "cancellationTiming", "refundChoice", "servicesCompleted", "customerEscalated",
  "customerEmail", "caseNumber", "otherReason"
];

const MAPPED_COLUMNS = new Set([
  "ID", "Start time", "Completion time", "Requester Email", "Requester Name",
  "Customer name", "Subscription ID", "Site ID", "Refund amount (USD)",
  "Primary reason for the cancel and/or refund request", "Primary reason for the refund request",
  "Detailed explanation of the refund request",
  "Manager Approved", "Status", "EnQuote Requestor Department", "EnQuote Refund Type",
  "EnQuote Site Visit Completed", "EnQuote Leadership Approval Required",
  "EnQuote Leadership Approval Justification", "EnQuote Store Team Notes",
  "EnQuote Escalation Notes", "EnQuote Refund Processed Date", "EnQuote Processor Name",
  "EnQuote Leadership Approver", "EnQuote Approval Date", "EnQuote Last Updated At",
  "EnQuote Sync Status",
  "When should the Enphase Care plan be canceled?", "Is a refund also being requested?",
  "Services completed", "Is the customer escalated?", "Customer email address", "Case number",
  'Add reason if the "Other" is selected'
]);

const INCOMPLETE_FIELDS = [
  "requestorDepartment",
  "refundType",
  "siteVisitCompleted",
  "leadershipApprovalRequired"
];
const VALID_STATUSES = new Set(["Submitted", "Under Review", "Approved", "Denied", "Completed", "Cancelled"]);

function normalizeStatus(status) {
  return ({New: "Submitted", Processed: "Completed", Closed: "Completed"})[status] || status || "Submitted";
}

function text(value) {
  if (value == null) return null;
  const clean = String(value).trim();
  return clean || null;
}

function existingColumn(row, ...names) {
  return names.find((name) => Object.hasOwn(row, name)) || names[0];
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLocaleLowerCase();
  if (["yes", "true", "1"].includes(normalized)) return true;
  if (["no", "false", "0"].includes(normalized)) return false;
  return null;
}

function parseAmount(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const cleaned = String(value ?? "").replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const amount = Number(cleaned);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function parseDate(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function workbookRowToRecord(row) {
  const externalResponseId = text(row?.ID);
  if (!externalResponseId) return null;
  const submittedAt = parseDate(row["Completion time"]) || parseDate(row["Start time"]);
  const sourceStatus = text(row.Status);
  const normalizedStatus = normalizeStatus(sourceStatus);
  const status = VALID_STATUSES.has(normalizedStatus) ? normalizedStatus : "Submitted";
  const record = {
    externalResponseId,
    submittedAt,
    requestorName: text(row["Requester Name"]),
    requestorDepartment: text(row["EnQuote Requestor Department"]),
    requestorEmail: text(row["Requester Email"])?.toLocaleLowerCase() || null,
    subscriptionId: text(row["Subscription ID"]),
    siteId: text(row["Site ID"]),
    customerName: text(row["Customer name"]),
    cancellationTiming: text(row["When should the Enphase Care plan be canceled?"]) || text(row["When should the Enphase Care plan be cancelled?"]),
    refundChoice: text(row["Is a refund also being requested?"]),
    servicesCompleted: parseBoolean(row["Services completed"]),
    customerEscalated: parseBoolean(row["Is the customer escalated?"]),
    customerEmail: text(row["Customer email address"]),
    caseNumber: text(row["Case number"]),
    otherReason: text(row['Add reason if the "Other" is selected']),
    refundAmountRequested: parseAmount(row["Refund amount (USD)"]),
    refundReason: text(row["Primary reason for the cancel and/or refund request"] ?? row["Primary reason for the refund request"]),
    siteVisitCompleted: parseBoolean(row["EnQuote Site Visit Completed"]),
    refundType: text(row["EnQuote Refund Type"]),
    leadershipApprovalRequired: parseBoolean(row["EnQuote Leadership Approval Required"]),
    leadershipApprovalJustification: text(row["EnQuote Leadership Approval Justification"]),
    additionalNotes: text(row["Detailed explanation of the refund request"]),
    storeTeamNotes: text(row["EnQuote Store Team Notes"]) || "",
    escalationNotes: text(row["EnQuote Escalation Notes"]) || "",
    refundProcessedDate: parseDate(row["EnQuote Refund Processed Date"]),
    processorName: text(row["EnQuote Processor Name"]),
    leadershipApprover: text(row["EnQuote Leadership Approver"]),
    approvalDate: parseDate(row["EnQuote Approval Date"]),
    managerApproved: parseBoolean(row["Manager Approved"]),
    status,
    source: "workbook",
    missingEnQuoteFields: []
  };
  if (!VALID_STATUSES.has(normalizedStatus)) record.workbookStatus = sourceStatus;
  record.missingEnQuoteFields = [
    ...INCOMPLETE_FIELDS.filter((field) => record[field] == null),
    ...(!record.submittedAt ? ["submittedAt"] : []),
    ...(!record.requestorName ? ["requestorName"] : []),
    ...(!record.requestorEmail ? ["requestorEmail"] : []),
    ...(!record.subscriptionId ? ["subscriptionId"] : []),
    ...(!record.siteId ? ["siteId"] : []),
    ...(!record.customerName ? ["customerName"] : []),
    ...(record.refundAmountRequested == null ? ["refundAmountRequested"] : []),
    ...(!record.refundReason ? ["refundReason"] : [])
  ];
  if (!VALID_STATUSES.has(normalizedStatus)) record.missingEnQuoteFields.push("status");
  return record;
}

function recordToWorkbookRow(record, existing = {}) {
  const row = { ...existing };
  const values = {
    ID: record.externalResponseId,
    "Start time": record.submittedAt,
    "Completion time": record.submittedAt,
    "Requester Email": record.requestorEmail,
    "Requester Name": record.requestorName,
    "Customer name": record.customerName,
    "When should the Enphase Care plan be canceled?": record.cancellationTiming,
    "Is a refund also being requested?": record.refundChoice,
    "Services completed": record.servicesCompleted,
    "Is the customer escalated?": record.customerEscalated,
    "Customer email address": record.customerEmail,
    "Case number": record.caseNumber,
    'Add reason if the "Other" is selected': record.otherReason,
    "Subscription ID": record.subscriptionId,
    "Site ID": record.siteId,
    "Refund amount (USD)": record.refundAmountRequested,
    [existingColumn(row, "Primary reason for the cancel and/or refund request", "Primary reason for the refund request")]: record.refundReason,
    "Detailed explanation of the refund request": record.additionalNotes,
    "Manager Approved": record.managerApproved,
    Status: normalizeStatus(record.status),
    "EnQuote Requestor Department": record.requestorDepartment,
    "EnQuote Refund Type": record.refundType,
    "EnQuote Site Visit Completed": record.siteVisitCompleted,
    "EnQuote Leadership Approval Required": record.leadershipApprovalRequired,
    "EnQuote Leadership Approval Justification": record.leadershipApprovalJustification,
    "EnQuote Store Team Notes": record.storeTeamNotes,
    "EnQuote Escalation Notes": record.escalationNotes,
    "EnQuote Refund Processed Date": record.refundProcessedDate,
    "EnQuote Processor Name": record.processorName,
    "EnQuote Leadership Approver": record.leadershipApprover,
    "EnQuote Approval Date": record.approvalDate,
    "EnQuote Last Updated At": record.lastUpdatedAt,
    "EnQuote Sync Status": record.missingEnQuoteFields?.length ? "Incomplete" : "Synced"
  };
  for (const [field, column] of Object.entries({
    cancellationTiming: "When should the Enphase Care plan be canceled?",
    refundChoice: "Is a refund also being requested?",
    servicesCompleted: "Services completed",
    customerEscalated: "Is the customer escalated?",
    customerEmail: "Customer email address",
    caseNumber: "Case number",
    otherReason: 'Add reason if the "Other" is selected'
  })) {
    if (record[field] === undefined) delete values[column];
  }
  for (const [column, value] of Object.entries(values)) {
    if (column in row || MAPPED_COLUMNS.has(column)) row[column] = value ?? null;
  }
  return row;
}

function comparable(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Math.round(value * 100) / 100;
  if (typeof value === "boolean") return value;
  return String(value).trim();
}

function buildSyncPlan(workbookRows, requests, baseline = {}, deletedExternalResponseIds = []) {
  requests = requests.map((request) => ({ ...request, status: normalizeStatus(request.status) }));
  const rowsById = new Map();
  const invalidRows = [];
  for (const [index, row] of workbookRows.entries()) {
    if (Object.values(row).every((value) => text(value) == null)) continue;
    const record = workbookRowToRecord(row);
    if (!record) {
      invalidRows.push({ tableRow: index + 1, reason: "missing_response_id" });
      continue;
    }
    if (rowsById.has(record.externalResponseId)) {
      invalidRows.push({ tableRow: index + 1, externalResponseId: record.externalResponseId, reason: "duplicate_response_id" });
      continue;
    }
    rowsById.set(record.externalResponseId, { row, record });
  }

  const requestsByExternalId = new Map(requests.map((request) => [request.externalResponseId, request]));
  const imports = [];
  const updates = [];
  const writeRows = [];
  const conflicts = [];
  const nextBaseline = { ...baseline };
  const deletedIds = new Set(deletedExternalResponseIds);
  const deleteRows = [];
  const deletions = [];

  for (const [externalResponseId, { row, record: workbookRecord }] of rowsById) {
    if (deletedIds.has(externalResponseId)) {
      deleteRows.push(externalResponseId);
      delete nextBaseline[externalResponseId];
      continue;
    }
    const request = requestsByExternalId.get(externalResponseId);
    if (!request) {
      imports.push(workbookRecord);
      nextBaseline[externalResponseId] = Object.fromEntries(WORKBOOK_FIELDS.map((field) => [field, comparable(workbookRecord[field])]));
      continue;
    }

    const previous = baseline[externalResponseId];
    const changes = {};
    const writeBack = {};
    for (const field of WORKBOOK_FIELDS) {
      const workbookValue = comparable(workbookRecord[field]);
      const appValue = comparable(field === "status" ? normalizeStatus(request[field]) : request[field]);
      if (!previous) {
        if (workbookValue == null && appValue != null) writeBack[field] = request[field];
        else if (appValue == null && workbookValue != null) changes[field] = workbookRecord[field];
        else if (workbookValue != null && appValue != null && workbookValue !== appValue) {
          conflicts.push({ externalResponseId, field, workbookValue: workbookRecord[field], enquoteValue: request[field] });
        }
        continue;
      }
      const baseValue = comparable(field === "status" ? normalizeStatus(previous[field]) : previous[field]);
      const workbookChanged = workbookValue !== baseValue;
      const appChanged = appValue !== baseValue;
      if (workbookChanged && appChanged && workbookValue !== appValue) {
        conflicts.push({ externalResponseId, field, workbookValue: workbookRecord[field], enquoteValue: request[field] });
      } else if (workbookChanged && !appChanged) {
        changes[field] = workbookRecord[field];
      } else if (appChanged && !workbookChanged) {
        writeBack[field] = request[field];
      }
    }
    if (Object.keys(changes).length) updates.push({ externalResponseId, expectedUpdatedAt: request.lastUpdatedAt, changes });
    if (Object.keys(writeBack).length) writeRows.push(recordToWorkbookRow({ ...request, ...writeBack }, row));
    if (!conflicts.some((item) => item.externalResponseId === externalResponseId)) {
      nextBaseline[externalResponseId] = Object.fromEntries(WORKBOOK_FIELDS.map((field) => [
        field,
        comparable(Object.hasOwn(writeBack, field) ? writeBack[field] : Object.hasOwn(changes, field) ? changes[field] : request[field])
      ]));
    }
  }

  for (const request of requests) {
    if (!rowsById.has(request.externalResponseId)) {
      if (Object.hasOwn(baseline, request.externalResponseId)) {
        deletions.push({externalResponseId: request.externalResponseId, expectedUpdatedAt: request.lastUpdatedAt});
        delete nextBaseline[request.externalResponseId];
      } else {
        writeRows.push(recordToWorkbookRow(request));
        nextBaseline[request.externalResponseId] = Object.fromEntries(WORKBOOK_FIELDS.map((field) => [field, comparable(request[field])]));
      }
    }
  }

  return { imports, updates, writeRows, deletions, deleteRows, conflicts, invalidRows, nextBaseline };
}

function createSyncConflictId(conflict) {
  return crypto.createHash("sha256")
    .update(`${conflict.externalResponseId}\0${conflict.field}`)
    .digest("hex")
    .slice(0, 24);
}

module.exports = {
  WORKBOOK_FIELDS,
  buildSyncPlan,
  createSyncConflictId,
  parseAmount,
  parseBoolean,
  parseDate,
  recordToWorkbookRow,
  workbookRowToRecord
};
