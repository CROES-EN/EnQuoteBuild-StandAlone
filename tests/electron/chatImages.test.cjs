const test = require("node:test");
const assert = require("node:assert/strict");
const {createChatService} = require("../../electron/chatService.cjs");

test("chat reaction bridge forwards authenticated reads and idempotent mutations", async () => {
  const calls = [];
  const result = {ok: true, conversationId: "chat", reactions: {message: [{emoji: "heart", users: ["me@example.com"]}]}};
  const chat = createChatService({
    client: {
      get: async (...args) => {calls.push(args); return result;},
      post: async (...args) => {calls.push(args); return result;}
    }, getEmail: () => "me@example.com", storageDir: "."
  });
  assert.deepEqual(await chat.reactions({conversationId: "chat", messageIds: ["a", "b"]}), result);
  const payload = {conversationId: "chat", messageId: "a", emoji: "heart", active: true};
  assert.deepEqual(await chat.react(payload), result);
  assert.deepEqual(calls, [
    ["/api/chat/reactions", {conversationId: "chat", messageIds: "a,b"}],
    ["/api/chat/reactions", payload]
  ]);
});

test("chat uploads clipboard screenshots before sending and does not store base64 in message history", async () => {
  const fileId = "a".repeat(64);
  const calls = [];
  const image = {type: "image", fileId, mimeType: "image/png", name: "Screenshot"};
  const client = {
    upload: async (route, payload) => {
      calls.push({route, payload});
      return {ok: true, image};
    },
    post: async (route, payload) => {
      calls.push({route, payload});
      return {ok: true, message: payload};
    },
    download: async route => {
      calls.push({route});
      return {bytes: new Uint8Array([1, 2, 3]), type: "image/png"};
    }
  };
  const chat = createChatService({client, getEmail: () => "user@example.com", storageDir: "."});
  const attachment = {type: "image", dataUrl: "data:image/png;base64,AQID"};
  const result = await chat.send({conversationId: "thread 1", clientId: "send-1", attachments: [attachment], body: ""});
  assert.equal(calls[0].route, "/api/chat/images?conversationId=thread%201");
  assert.deepEqual([...calls[0].payload.bytes], [1, 2, 3]);
  assert.deepEqual(result.message.attachments, [image]);
  assert.equal(JSON.stringify(result.message).includes("data:"), false);
  assert.equal((await chat.getImage({conversationId: "thread 1", fileId})).dataUrl, "data:image/png;base64,AQID");
  await assert.rejects(chat.getImage({conversationId: "thread 1", fileId: "bad"}), /Invalid screenshot/);
  await assert.rejects(chat.send({conversationId: "x", attachments: [{type: "image", dataUrl: "data:image/svg+xml;base64,AQID"}]}), /supported image/);
});

test("screenshot upload failures never send a success-shaped message", async () => {
  let sent = false;
  const chat = createChatService({
    client: {upload: async () => {throw new Error("Offline");}, post: async () => {sent = true;}},
    getEmail: () => "user@example.com", storageDir: "."
  });
  await assert.rejects(chat.send({conversationId: "x", attachments: [{type: "image", dataUrl: "data:image/png;base64,AQID"}]}), /Offline/);
  assert.equal(sent, false);
});

test("shared emoji bridge validates image inputs and uses authenticated catalog routes", async () => {
  const id = "b".repeat(64), calls = [];
  const emoji = {id, name: "team", mimeType: "image/png"};
  const chat = createChatService({
    client: {
      get: async route => {calls.push(route); return {ok: true, emojis: [emoji]};},
      upload: async (route, payload) => {calls.push({route, payload}); return {ok: true, emoji};},
      download: async route => {calls.push(route); return {type: "image/png", bytes: new Uint8Array([1, 2, 3])};}
    },
    getEmail: () => "me@example.com", storageDir: "."
  });

  assert.deepEqual((await chat.emojis()).emojis, [emoji]);
  assert.deepEqual((await chat.uploadEmoji({name: "team", dataUrl: "data:image/png;base64,AQID"})).emoji, emoji);
  assert.equal((await chat.getEmoji(id)).dataUrl, "data:image/png;base64,AQID");
  assert.equal(calls[0], "/api/chat/emojis");
  assert.equal(calls[1].route, "/api/chat/emojis?name=team");
  assert.deepEqual([...calls[1].payload.bytes], [1, 2, 3]);
  assert.equal(calls[2], `/api/chat/emojis/image?id=${id}`);
  await assert.rejects(chat.uploadEmoji({name: "Bad name", dataUrl: "data:image/png;base64,AQID"}), /emoji name/);
  await assert.rejects(chat.uploadEmoji({name: "team", dataUrl: "data:image/svg+xml;base64,AQID"}), /PNG/);
  await assert.rejects(chat.uploadEmoji({name: "team", dataUrl: `data:image/png;base64,${Buffer.alloc(512 * 1024 + 1).toString("base64")}`}), /512 KB/);
  await assert.rejects(chat.getEmoji("bad"), /Invalid custom emoji/);
  assert.equal(calls.length, 3, "invalid inputs never reach the service");
});

test("GIF emoji bridge sends only the GIF ID and name and preserves downloaded animation bytes", async () => {
  const calls = [], id = "c".repeat(64);
  const bytes = Buffer.from("47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30030100000021f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b", "hex");
  const chat = createChatService({
    client: {
      post: async (...args) => {calls.push(args); return {ok: true, emoji: {id, name: "blink"}};},
      download: async () => ({bytes, type: "image/gif"})
    }, getEmail: () => "me@example.com", storageDir: "."
  });
  const payload = {gifId: "gif123", name: "blink"};
  assert.equal((await chat.saveGifEmoji(payload)).emoji.id, id);
  assert.deepEqual(calls, [["/api/chat/emojis/from-gif", payload]]);
  assert.equal((await chat.getEmoji(id)).dataUrl, `data:image/gif;base64,${bytes.toString("base64")}`);
});
