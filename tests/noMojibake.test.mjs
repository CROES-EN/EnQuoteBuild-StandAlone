import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Double-encoded UTF-8 (e.g. "â€”", "Ã—") or replacement/C1 control characters in UI text.
const MOJIBAKE = /[\u00c2-\u00f0][\u0080-\u00bf\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013\u2014\u2018\u2019\u201a\u201c\u201d\u201e\u2020\u2021\u2022\u2026\u2030\u2039\u203a\u20ac\u2122]|\ufffd|[\u0080-\u009f]/;
const ROOTS = ["src", "electron", "enquote-sync-worker/src", "INSTRUCTION MANUAL.MD"];
const EXTENSIONS = /\.(jsx?|tsx?|cjs|mjs|css|html|md)$/i;

function* files(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) { yield target; return; }
  for (const entry of fs.readdirSync(target, {withFileTypes: true})) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (EXTENSIONS.test(entry.name)) yield full;
  }
}

test("source and docs contain no mojibake", () => {
  const hits = [];
  for (const root of ROOTS) {
    for (const file of files(path.resolve(root))) {
      fs.readFileSync(file, "utf8").split(/\r?\n/).forEach((line, index) => {
        if (MOJIBAKE.test(line)) hits.push(`${path.relative(process.cwd(), file)}:${index + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
  }
  assert.deepEqual(hits, []);
});
