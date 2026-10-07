import {chatApi} from "@/features/collab/collabApi";
import {isSalesforceCaseId} from "@/lib/externalLinks";

export function createCaseTaskRequest({row, recipient, note = "", dueLocal}, clientId = crypto.randomUUID()) {
  const caseNumber = String(row?.["Case Number"] ?? "").trim();
  const caseId = String(row?.["Case ID"] ?? "").trim();
  const due = new Date(dueLocal);
  if (!/^\d{1,30}$/.test(caseNumber)) throw new Error("This row needs a valid case number before tagging.");
  if (!recipient?.trim()) throw new Error("Choose a teammate.");
  if (!dueLocal || !Number.isFinite(due.getTime())) throw new Error("Pick a due date and time.");
  if (note.length > 2000) throw new Error("Keep the note to 2,000 characters or fewer.");
  const attachment = {
    type: "case_task", version: 1, recipient: recipient.trim().toLowerCase(),
    caseNumber, caseId: isSalesforceCaseId(caseId) ? caseId : "",
    note: note.trim(), dueAt: due.toISOString()
  };
  return {
    clientId, attachment,
    body: [`Tagged you to review case ${caseNumber}.`, `Due: ${due.toLocaleString()}`, attachment.note].filter(Boolean).join("\n")
  };
}

export async function sendCaseTaskRequest(request) {
  const conversation = await chatApi.openDm(request.attachment.recipient);
  if (!conversation?.id) throw new Error("Could not open a conversation with this teammate.");
  let message;
  try {
    message = await chatApi.send({
      conversationId: conversation.id, clientId: request.clientId,
      body: request.body, attachments: [request.attachment]
    });
  } catch (error) {
    if (error.code === "invalid_attachment_type") {
      throw new Error("Case tagging requires the backend update. The sync service does not support this request yet.");
    }
    throw error;
  }
  if (message?.caseTaskId !== `case-tag:${request.clientId}`) {
    throw new Error("The service did not confirm task creation. Retry the same request; do not send a new tag.");
  }
  return message;
}
