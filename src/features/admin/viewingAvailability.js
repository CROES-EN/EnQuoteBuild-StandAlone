export const VIEWING_RESTART_MESSAGE = "The running desktop process does not support viewing mode. Save your work and fully quit EnQuote, then reopen it. If you are using an installed older version, install the new desktop release; a UI refresh cannot add this feature.";

export async function getViewingAvailability(bridge = globalThis.window?.enquoteLocal?.viewing) {
  if (typeof bridge?.status !== "function" || typeof bridge?.start !== "function") {
    return {ready: false, message: VIEWING_RESTART_MESSAGE};
  }
  let result;
  try {
    result = await bridge.status();
  } catch (error) {
    if (/No handler registered for ['"]viewing:status['"]/.test(error.message)) {
      return {ready: false, message: VIEWING_RESTART_MESSAGE};
    }
    throw error;
  }
  if (result?.ok !== true || result.supported !== true) {
    throw new Error(result?.error || "The desktop service returned an invalid viewing-mode capability response.");
  }
  return result.ready === true
    ? {ready: true, message: ""}
    : {ready: false, message: "The desktop viewing service is still initializing. Use the Developer Console refresh icon to check again. If this persists, fully quit and reopen EnQuote."};
}

export async function startDesktopViewing(targetEmail, bridge = globalThis.window?.enquoteLocal?.viewing) {
  const availability = await getViewingAvailability(bridge);
  if (!availability.ready) throw new Error(availability.message);
  let result;
  try {
    result = await bridge.start(targetEmail);
  } catch (error) {
    if (/No handler registered for ['"]viewing:start['"]/.test(error.message)) {
      throw new Error(VIEWING_RESTART_MESSAGE);
    }
    throw error;
  }
  if (result?.ok !== true) throw new Error(result?.error || "The desktop service could not open viewing mode.");
}
