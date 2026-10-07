export const CUSTOM_EMOJI_MAX_BYTES = 512 * 1024;
export const CUSTOM_EMOJI_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const validCustomEmojiId = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const validCustomEmojiName = value => typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(value);
export const customReactionId = id => `custom:${id}`;
export const customEmojiIdFromReaction = value =>
  typeof value === "string" && value.startsWith("custom:") && validCustomEmojiId(value.slice(7)) ? value.slice(7) : null;
