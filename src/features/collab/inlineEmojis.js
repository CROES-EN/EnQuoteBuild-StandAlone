import {validCustomEmojiId, validCustomEmojiName} from "../../../shared/customEmojiRules.js";
export {splitInlineEmojis, inlineEmojiPreview} from "../../../shared/inlineEmojiRules.cjs";

export function customEmojiToken(emoji) {
  if (!validCustomEmojiId(emoji.id) || !validCustomEmojiName(emoji.name)) {
    throw new Error("This emoji is invalid. Refresh the emoji picker and try again.");
  }
  return `<:${emoji.name}:${emoji.id}>`;
}

export function readComposerText(root) {
  function read(node) {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return "";
    if (node.dataset.emojiToken) return node.dataset.emojiToken;
    if (node.tagName === "BR") return "\n";
    let value = "";
    for (const child of node.childNodes) {
      if (["DIV", "P"].includes(child.nodeName) && value && !value.endsWith("\n")) value += "\n";
      value += read(child);
    }
    return value;
  }
  // A lone BR is the browser's empty-editor placeholder, not a message.
  if (root.childNodes.length === 1 && root.firstChild.nodeName === "BR") return "";
  return read(root);
}
