export function clampChatWindowSize({width, height}, viewport) {
  const maxWidth = Math.max(1, viewport.width);
  const maxHeight = Math.max(1, viewport.height - 56);
  return {
    width: Math.min(maxWidth, Math.max(Math.min(320, maxWidth), width)),
    height: Math.min(maxHeight, Math.max(Math.min(300, maxHeight), height))
  };
}
