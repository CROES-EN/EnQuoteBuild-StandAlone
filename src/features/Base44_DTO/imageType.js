// Stored avatar types can be missing or generic (application/octet-stream), so the type is read from the image bytes.
export function sniffImageType(bytes) {
  const at = (offset, ...values) => values.every((value, index) => bytes[offset + index] === value);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return "";
}
