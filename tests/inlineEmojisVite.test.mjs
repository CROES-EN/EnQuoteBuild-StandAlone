import assert from "node:assert/strict";
import {Buffer} from "node:buffer";
import test from "node:test";
import {createServer} from "vite";

test("Vite dev serves inline emoji helpers as browser-importable ES modules", async () => {
  const server = await createServer({
    server: {port: 0, host: "127.0.0.1"},
    logLevel: "error"
  });
  try {
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    const response = await fetch(`${base}/src/features/collab/inlineEmojis.js`);
    assert.equal(response.status, 200);
    const source = await response.text();
    const dependency = source.match(/from\s+["']([^"']*\/shared\/inlineEmojiRules\.js[^"']*)["']/);
    assert.ok(dependency, "Renderer imports the shared ESM helper");
    const helper = await fetch(new URL(dependency[1], base));
    assert.equal(helper.status, 200);
    const helperSource = await helper.text();
    assert.doesNotMatch(helperSource, /module\.exports/);
    const {splitInlineEmojis, inlineEmojiPreview} = await import(
      `data:text/javascript;base64,${Buffer.from(helperSource).toString("base64")}`
    );
    const token = `<:test:${"a".repeat(64)}>`;
    assert.equal(splitInlineEmojis(token)[0].token, token);
    assert.equal(inlineEmojiPreview(`Hello ${token}`), "Hello :test:");
  } finally {
    await server.close();
  }
});
