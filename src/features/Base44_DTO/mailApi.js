const bridge = () => globalThis.window?.enquoteLocal?.retroMail;

async function call(method, ...args) {
  const fn = bridge()?.[method];
  if (typeof fn !== "function") throw new Error("The separate Mail Center requires the updated EnQuote desktop app.");
  const result = await fn(...args);
  if (!result || result.ok === false) {
    const code = result?.error || result?.reason;
    const messages = {
      recipient_not_allowed: "That recipient is not an active EnQuote user.",
      subject_required: "Enter a subject.",
      message_required: "Enter a message.",
      message_too_long: "The message exceeds the allowed length.",
      invalid_folder: "That mail folder is not available.",
      message_not_found: "That message is no longer available.",
      not_found: "The Mail Center service is not available yet. Apply its database migration and deploy the updated EnQuote Worker, then restart EnQuote."
    };
    throw new Error(messages[code] || code || "Could not access Mail Center.");
  }
  return result;
}

export const retroMailApi = {
  list: (folder) => call("list", folder),
  contacts: () => call("contacts"),
  send: (message) => call("send", message),
  setState: (payload) => call("setState", payload),
  delete: (id) => call("delete", id),
  onChanged(callback) {
    const subscribe = bridge()?.onChanged;
    return typeof subscribe === "function" ? subscribe(callback) : () => {};
  }
};
