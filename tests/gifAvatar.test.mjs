import test from "node:test";
import assert from "node:assert/strict";
import {avatarTypeFromBytes, gifAvatarError, MAX_AVATAR_BYTES, MAX_GIF_DIMENSION} from "../shared/avatarRules.js";

function header(width, height, signature = "GIF89a") {
  const bytes = new Uint8Array(10);
  bytes.set(new TextEncoder().encode(signature));
  bytes[6] = width & 255;
  bytes[7] = width >> 8;
  bytes[8] = height & 255;
  bytes[9] = height >> 8;
  return bytes;
}

test("GIF avatar rules enforce exact byte/dimension bounds and recognized headers", () => {
  assert.equal(gifAvatarError(header(MAX_GIF_DIMENSION, MAX_GIF_DIMENSION)), null);
  assert.equal(gifAvatarError(header(1, 1, "GIF87a")), null);
  assert.equal(gifAvatarError(header(MAX_GIF_DIMENSION + 1, 1)), "gif_dimensions_too_large");
  assert.equal(gifAvatarError(header(1, MAX_GIF_DIMENSION + 1)), "gif_dimensions_too_large");
  assert.equal(gifAvatarError(header(0, 1)), "invalid_gif_avatar");
  assert.equal(gifAvatarError(new Uint8Array(9)), "invalid_gif_avatar");
  assert.equal(gifAvatarError(header(1, 1, "notGIF")), "invalid_gif_avatar");
  const exactLimit = new Uint8Array(MAX_AVATAR_BYTES);
  exactLimit.set(header(1, 1));
  assert.equal(gifAvatarError(exactLimit), null);
  assert.equal(gifAvatarError(new Uint8Array(MAX_AVATAR_BYTES + 1)), "file_too_large");
});

test("avatar MIME type is recovered from image bytes when stored metadata is missing", () => {
  assert.equal(avatarTypeFromBytes(header(1, 1)), "image/gif");
  assert.equal(avatarTypeFromBytes(Uint8Array.from([0x89, 0x50, 0x4e, 0x47])), "image/png");
  assert.equal(avatarTypeFromBytes(Uint8Array.from([0xff, 0xd8, 0xff])), "image/jpeg");
  assert.equal(avatarTypeFromBytes(new TextEncoder().encode("RIFF1234WEBP")), "image/webp");
  assert.equal(avatarTypeFromBytes(new Uint8Array()), "");
});
