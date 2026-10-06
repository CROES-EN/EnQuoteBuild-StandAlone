export const MAX_AVATAR_BYTES = 512 * 1024;
export const MAX_GIF_DIMENSION = 1024;
export const AVATAR_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function gifAvatarError(bytes) {
  if (bytes.byteLength > MAX_AVATAR_BYTES) return "file_too_large";
  if (bytes.length < 10) return "invalid_gif_avatar";
  const signature = String.fromCharCode(...bytes.subarray(0, 6));
  if (signature !== "GIF87a" && signature !== "GIF89a") return "invalid_gif_avatar";
  const width = bytes[6] | (bytes[7] << 8);
  const height = bytes[8] | (bytes[9] << 8);
  if (!width || !height) return "invalid_gif_avatar";
  if (width > MAX_GIF_DIMENSION || height > MAX_GIF_DIMENSION) return "gif_dimensions_too_large";
  return null;
}
