const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function createSalesforceAttachment({nativeImage, shell, clipboard}) {
  let directory = null;
  let prepared = null;
  let generation = 0;
  function clear(owner) {
    if (owner && prepared && prepared.owner !== owner) return;
    generation++;
    if (directory) fs.rmSync(directory, {recursive: true, force: true});
    directory = null;
    prepared = null;
  }
  async function prepare({name, reference, bytes, emailText = ""}, owner, canCommit = () => true) {
    const request = generation;
    const {customerQuoteFilename} = await import("../shared/customerQuoteFilename.js");
    if (!owner) throw new Error("Sign in before preparing a quote attachment.");
    const filename = customerQuoteFilename(name, reference);
    if (typeof emailText !== "string" || emailText.length > 100000) throw new Error("The homeowner email must be text up to 100,000 characters.");
    if (!(bytes instanceof Uint8Array) || bytes.length < 5 || bytes.length > 25 * 1024 * 1024 ||
        Buffer.from(bytes.subarray(0, 5)).toString("ascii") !== "%PDF-") {
      throw new Error("A valid Customer Copy PDF up to 25 MB is required.");
    }
    if (request !== generation || !canCommit()) throw new Error("The Salesforce case changed before the PDF was saved.");
    clear();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "enquote-customer-quote-"));
    const file = path.join(directory, filename);
    fs.writeFileSync(file, bytes);
    prepared = {file, filename, owner, emailText};
    return {filename, hasEmail: Boolean(emailText)};
  }
  function requireFile(owner) {
    if (!prepared || prepared.owner !== owner) throw new Error("Prepare a Customer Copy PDF for your account first.");
    if (!fs.existsSync(prepared.file)) throw new Error("The prepared PDF is no longer available. Prepare it again.");
    return prepared;
  }
  function state(owner) {
    return prepared?.owner === owner ? {filename: prepared.filename, hasEmail: Boolean(prepared.emailText)} : null;
  }
  function drag(contents, owner) {
    const item = requireFile(owner);
    const pixels = Buffer.alloc(32 * 32 * 4);
    for (let offset = 0; offset < pixels.length; offset += 4) {
      pixels[offset] = 220;
      pixels[offset + 1] = 80;
      pixels[offset + 2] = 40;
      pixels[offset + 3] = 255;
    }
    const icon = nativeImage.createFromBitmap(pixels, {width: 32, height: 32, scaleFactor: 1});
    contents.startDrag({file: item.file, icon});
  }
  function reveal(owner) {
    shell.showItemInFolder(requireFile(owner).file);
  }
  async function copyEmail(owner) {
    const item = requireFile(owner);
    if (!item.emailText) throw new Error("Prepare this quote again to generate its homeowner email.");
    if (!clipboard) throw new Error("Clipboard access is unavailable.");
    await clipboard.writeText(item.emailText);
  }
  return {prepare, state, drag, reveal, clear, copyEmail};
}

module.exports = {createSalesforceAttachment};
