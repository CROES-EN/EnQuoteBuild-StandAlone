import test from "node:test";
import assert from "node:assert/strict";
import {clipboardImageFiles, screenshotAttachments, MAX_SCREENSHOT_BYTES} from "../src/features/collab/clipboardImages.js";

test("clipboard extraction handles image files and leaves ordinary text alone", () => {
  const file = {type: "image/png", size: 10};
  assert.deepEqual(clipboardImageFiles({items: [
    {kind: "string", type: "text/plain"},
    {kind: "file", type: "image/png", getAsFile: () => file},
    {kind: "file", type: "application/pdf"},
    {kind: "file", type: "image/png", getAsFile: () => null}
  ]}), [file]);
  assert.deepEqual(clipboardImageFiles(null), []);
});

test("pasted screenshots retain previews and support the exact size and attachment limits", async () => {
  const file = {type: "image/png", size: MAX_SCREENSHOT_BYTES};
  const attachments = await screenshotAttachments([file], 1, async () => "data:image/png;base64,aGVsbG8=");
  assert.equal(attachments[0].type, "image");
  assert.equal(attachments[0].mimeType, "image/png");
  assert.equal(attachments[0].dataUrl, "data:image/png;base64,aGVsbG8=");
  assert.ok(attachments[0].id);
  await assert.rejects(screenshotAttachments([file], 0), /10 attachments/);
  await assert.rejects(screenshotAttachments([{...file, size: MAX_SCREENSHOT_BYTES + 1}], 1), /5 MB/);
  await assert.rejects(screenshotAttachments([{...file, type: "image/svg+xml"}], 1), /PNG/);
  await assert.rejects(screenshotAttachments([{...file, size: 0}], 1), /5 MB/);
  await assert.rejects(screenshotAttachments([file], 1, async () => {throw new Error("Read failed");}), /Read failed/);
});
