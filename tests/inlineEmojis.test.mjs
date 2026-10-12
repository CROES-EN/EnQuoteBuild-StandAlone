import test from "node:test";
import assert from "node:assert/strict";
import {customEmojiToken, splitInlineEmojis, inlineEmojiPreview} from "../src/features/collab/inlineEmojis.js";

test("custom emojis round-trip inline without changing surrounding text", () => {
  const emoji = {id: "a".repeat(64), name: "pepe-pray"};
  const token = customEmojiToken(emoji);
  const body = `Pray ${token} for me\n${token} <script>not HTML</script>`;
  const parts = splitInlineEmojis(body);
  assert.equal(parts.map(part => part.token || part.text).join(""), body);
  assert.deepEqual(parts[1], {...emoji, token});
  assert.equal(parts.filter(part => part.id).length, 2);
  assert.equal(inlineEmojiPreview(body), "Pray :pepe-pray: for me\n:pepe-pray: <script>not HTML</script>");
});

test("plain messages, unicode emojis and malformed tokens remain text", () => {
  for (const body of ["hello", "\uD83D\uDC4D", "<:bad:123>", "<script>alert(1)</script>"]) {
    assert.deepEqual(splitInlineEmojis(body), [{text: body}]);
  }
  assert.deepEqual(splitInlineEmojis(""), []);
  assert.throws(() => customEmojiToken({id:"invalid", name:"test"}), /invalid/);
  assert.throws(() => customEmojiToken({id:"a".repeat(64), name:"<img>"}), /invalid/);
});
