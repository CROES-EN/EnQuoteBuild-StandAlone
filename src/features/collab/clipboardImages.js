export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function clipboardImageFiles(clipboardData) {
  return Array.from(clipboardData?.items || [])
    .filter(item => item.kind === "file" && item.type.startsWith("image/"))
    .map(item => item.getAsFile()).filter(Boolean);
}

export async function screenshotAttachments(files, slots, readDataUrl = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error("Could not read the pasted screenshot."));
  reader.onabort = () => reject(new Error("Screenshot reading was cancelled."));
  reader.readAsDataURL(file);
})) {
  if (files.length > slots) throw new Error("Messages can contain up to 10 attachments. Remove an attachment before pasting.");
  for (const file of files) {
    if (!IMAGE_TYPES.has(file.type)) throw new Error("Paste a PNG, JPEG, WebP, or GIF image.");
    if (!file.size || file.size > MAX_SCREENSHOT_BYTES) throw new Error("Screenshots must be 5 MB or smaller.");
  }
  return Promise.all(files.map(async file => ({
    type: "image", id: crypto.randomUUID(), name: "Screenshot", mimeType: file.type,
    dataUrl: await readDataUrl(file)
  })));
}
