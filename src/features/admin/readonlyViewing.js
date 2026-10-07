export const isReadonlyViewing = () => globalThis.window?.enquotePreview?.active === true;

export function rejectViewingAction() {
  throw new Error("This action is unavailable in read-only viewing mode. Exit viewing mode to use your own account.");
}
