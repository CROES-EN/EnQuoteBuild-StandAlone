export const MAX_AVATAR_BYTES = 512 * 1024;
export const MAX_GIF_DIMENSION = 1024;
export const AVATAR_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function avatarTypeFromBytes(bytes) {
  const at = (offset, ...values) => values.every((value, index) => bytes[offset + index] === value);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return "";
}

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
