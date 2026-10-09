import test from "node:test";
import assert from "node:assert/strict";
import {downloadGiphyAvatar, giphyAvatarCandidates} from "../src/features/profiles/giphyAvatar.js";

function gifBytes(width = 200, height = 200, size = 64) {
  const bytes = new Uint8Array(size);
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, width & 255, width >> 8, height & 255, height >> 8]);
  return bytes;
}

function response(bytes, {ok = true, length} = {}) {
  return {
    ok,
    headers: {get: (name) => (name === "content-length" && length != null ? String(length) : null)},
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

test("only https GIPHY media URLs are candidates, with a smaller fallback", () => {
  const urls = giphyAvatarCandidates({
    url: "https://media2.giphy.com/media/abc/200.gif?cid=x&rid=200.gif",
    previewUrl: "https://media2.giphy.com/media/abc/100w.webp",
  });
  assert.deepEqual(urls, [
    "https://media2.giphy.com/media/abc/200.gif?cid=x&rid=200.gif",
    "https://media2.giphy.com/media/abc/100.gif?cid=x",
    "https://media2.giphy.com/media/abc/100w.webp",
  ]);
  assert.deepEqual(giphyAvatarCandidates({url: "http://media.giphy.com/a.gif", previewUrl: "https://evil.example/giphy.com/a.gif"}), []);
  assert.deepEqual(giphyAvatarCandidates({url: "https://media.giphy.com.evil.example/a.gif"}), []);
});

test("downloads a valid GIF and reports its real type", async () => {
  const result = await downloadGiphyAvatar({url: "https://i.giphy.com/abc.gif"}, async () => response(gifBytes()));
  assert.equal(result.type, "image/gif");
  assert.equal(result.bytes[0], 0x47);
});

test("falls back to a smaller rendition when the first is too large", async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return url.endsWith("/200.gif") ? response(gifBytes(), {length: 900 * 1024}) : response(gifBytes(100, 100));
  };
  const result = await downloadGiphyAvatar({url: "https://media.giphy.com/media/abc/200.gif"}, fetchImpl);
  assert.equal(result.type, "image/gif");
  assert.equal(seen.length, 2);
});

test("rejects oversized or non-image downloads", async () => {
  const tooBig = async () => response(gifBytes(200, 200, 600 * 1024));
  await assert.rejects(downloadGiphyAvatar({url: "https://i.giphy.com/abc.gif"}, tooBig), /too large/);
  const html = async () => response(new TextEncoder().encode("<html></html>"));
  await assert.rejects(downloadGiphyAvatar({url: "https://i.giphy.com/abc.gif"}, html), /too large/);
});
