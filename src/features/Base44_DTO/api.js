async function call(method, payload) {
  const bridge = globalThis.window?.enquoteLocal?.Base44_DTO;
  if (typeof bridge?.[method] !== "function") throw new Error("Retro profiles require the updated EnQuote desktop app.");
  let result;
  try {
    result = await bridge[method](payload);
  } catch (error) {
    if (/No handler registered for ['"]Base44_DTO:/.test(error.message)) {
      throw new Error("This desktop process does not include shared profile support. Fully quit EnQuote (including its tray icon) and restart the updated desktop build. Refresh App updates the screen only; it cannot update desktop handlers.");
    }
    throw error;
  }
  if (result?.ok === false && (result.error === "not_found" || result.reason === "not_found")) {
    throw new Error("Shared profiles are not available on the sync service yet. Deploy the updated EnQuote Worker, then refresh friends or publish again. Your local draft is still saved on this PC.");
  }
  if (!result || result.ok === false) throw new Error(result?.error || result?.reason || "Could not load retro profiles.");
  return result;
}
export const retroApi = {
  list: (cursor) => call("list", cursor),
  get: (email) => call("get", email),
  save: (profile) => call("save", profile),
  remove: () => call("remove")
};
