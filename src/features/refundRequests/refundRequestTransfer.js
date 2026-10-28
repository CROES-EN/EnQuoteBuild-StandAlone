const COLUMNS = [
  ["Response ID", "externalResponseId"], ["Submitted At", "submittedAt"],
  ["Requestor Name", "requestorName"], ["Requestor Department", "requestorDepartment"],
  ["Requestor Email", "requestorEmail"], ["Subscription ID", "subscriptionId"],
  ["Site ID", "siteId"], ["Customer Name", "customerName"],
  ["Refund Amount Requested", "refundAmountRequested"], ["Refund Reason", "refundReason"],
  ["Site Visit Completed", "siteVisitCompleted"], ["Refund Type", "refundType"],
  ["Leadership Approval Required", "leadershipApprovalRequired"],
  ["Leadership Approval Justification", "leadershipApprovalJustification"],
  ["Additional Notes", "additionalNotes"], ["Status", "status"],
  ["Customer Email", "customerEmail"], ["Case Number", "caseNumber"],
  ["Cancellation Timing", "cancellationTiming"], ["Refund Requested", "refundChoice"],
  ["Services Completed", "servicesCompleted"], ["Customer Escalated", "customerEscalated"],
  ["Other Reason", "otherReason"], ["Store Team Notes", "storeTeamNotes"],
  ["Escalation Notes", "escalationNotes"], ["Refund Processed Date", "refundProcessedDate"],
  ["Processor Name", "processorName"], ["Leadership Approver", "leadershipApprover"],
  ["Approval Date", "approvalDate"], ["Last Updated At", "lastUpdatedAt"]
];

function csvCell(value) {
  let text = value == null ? "" : typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function refundRequestsCsv(records) {
  return "\uFEFF" + [
    COLUMNS.map(([label]) => label),
    ...records.map(record => COLUMNS.map(([, field]) => record[field]))
  ].map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
