import {chatApi} from "./collabApi";

export function createAssignedTaskRequest({conversationId, recipient, title, notes = "", dueLocal, task}, clientId = crypto.randomUUID()) {
  const due = new Date(dueLocal);
  if (!conversationId || !recipient?.trim()) throw new Error("Choose a teammate in this conversation.");
  if (!title?.trim() || title.trim().length > 200) throw new Error("Enter a task title of up to 200 characters.");
  const noteLimit = task ? 4000 : 2000;
  if (notes.length > noteLimit) throw new Error(`Keep notes to ${noteLimit.toLocaleString()} characters or fewer.`);
  if (!dueLocal || !Number.isFinite(due.getTime())) throw new Error("Pick a due date and time.");
  return {
    conversationId, clientId,
    body: [`Assigned task: ${title.trim()}`, `Due: ${due.toLocaleString()}`, notes.trim()].filter(Boolean).join("\n").slice(0, 4000),
    attachments: [{type: "assigned_task", version: task ? 2 : 1, recipient: recipient.trim().toLowerCase(),
      title: title.trim(), note: notes.trim(), dueAt: due.toISOString(),
      ...(task ? {task: {
        type: task.type, remind_at: task.remind_at,
        quote_id: task.quote_id, quote_label: task.quote_label,
        site_id: task.site_id, case_number: task.case_number, case_id: task.case_id || null,
        contact_name: task.contact_name, contact_phone: task.contact_phone
      }} : {})}]
  };
}

export async function sendAssignedTaskRequest(request) {
  let message;
  try {message = await chatApi.send(request);}
  catch (error) {
    if (error.code === "invalid_attachment_type" || (request.attachments?.[0]?.version === 2 && error.code === "invalid_assigned_task")) {
      throw new Error("Task assignment requires the updated sync service. Ask your administrator to deploy the task-panel update.");
    }
    throw error;
  }
  if (message?.assignedTaskId !== `chat-task:${request.clientId}`) {
    throw new Error("Task creation was not confirmed. Retry this same request to avoid duplicate tasks.");
  }
  return message;
}
