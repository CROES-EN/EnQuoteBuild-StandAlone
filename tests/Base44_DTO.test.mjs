import test from "node:test";
import assert from "node:assert/strict";
import {createSecretSequence, RETRO_SEQUENCE} from "../src/features/Base44_DTO/sequence.js";
import {canAccessPage} from "../src/lib/rolePageAccess.js";
import {retroApi} from "../src/features/Base44_DTO/api.js";
import {createRequire} from "node:module";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {TOM_TRIBUTE} from "../src/features/Base44_DTO/tribute.js";
import {BASE_STYLE_MARKER, BLEND_MARKER, CLASSIC_PROFILE_CSS, PICTURE_LOCK_CSS, materializeProfile} from "../src/features/Base44_DTO/template.js";
import {sniffImageType} from "../src/features/Base44_DTO/imageType.js";
import {describeTheme, themeSummary} from "../src/features/Base44_DTO/themeImport.js";
import {FRIEND_MESSAGE, buildRetroPreview} from "../src/features/Base44_DTO/preview.js";

test("classic profiles supply content for CSS-only themes and escape profile fields", () => {
  const draft = {layout: "classic", name: '<script>bad</script>', mood: "Happy", html: "", css: "<style>body{background:black}</style>", about: "Hello", music: "Rock", heroes: "Friends"};
  const profile = materializeProfile(draft);
  assert.ok(profile.html.includes('class="row profile"'));
  assert.ok(profile.html.includes("About me"));
  assert.ok(profile.html.includes("&lt;script&gt;"));
  assert.equal(profile.html.includes("<script>"), false);
  assert.ok(profile.css.startsWith("<style>"));
  assert.ok(profile.css.includes(draft.css));
  assert.ok(profile.css.includes("width:100%!important;max-width:none!important"), "Classic profile fills the page column edge to edge");
  assert.ok(profile.css.includes("border-radius:0 0 8px 8px") && profile.css.includes("padding:0!important") && profile.css.includes("margin:0 0 24px!important"), "Classic profile frame attaches directly below the page header");
  assert.ok(profile.css.includes("grid-template-columns:300px minmax(0,1fr)"), "Classic profile matches Tom's two-column fit");
  assert.ok(profile.css.includes("box-shadow:0 2px 8px rgba(0,0,0,.12)"), "Classic sections have defined card frames");
  assert.throws(() => materializeProfile({...draft, picture: "javascript:alert(1)"}), /HTTPS/);
  const custom = {...draft, layout: "custom", html: "<h1>Custom</h1>"};
  assert.equal(materializeProfile(custom), custom);
  const gothic = materializeProfile({...draft, appearance: "gothic"});
  assert.ok(gothic.css.includes("linear-gradient"));
  assert.equal(gothic.css.includes(draft.css), false, "Preset does not mix with saved imported CSS");
  assert.ok(profile.css.includes("--eqp-glass") && profile.css.indexOf("--eqp-glass") > profile.css.indexOf(draft.css), "Imported themes get the EnQuote blend layer after the theme");
  const raw = materializeProfile({...draft, appearance: "imported-raw"});
  assert.ok(raw.css.includes(draft.css) && !raw.css.includes("--eqp-glass"), "Raw imported mode skips the blend layer");
  const withAvatar = materializeProfile({...draft, appearance: "classic"}, "data:image/gif;base64,R0lG");
  assert.ok(withAvatar.html.includes('src="data:image/gif;base64,R0lG"'));
  assert.ok(profile.html.includes('class="picture-placeholder">&lt;</div>') && !profile.html.includes("Upload a picture"), "Missing pictures show an initial, not instructions");
  const withFriends = materializeProfile(draft, "", [{name: "Tom", picture: "https://example.com/tom.jpg"}, {name: "Ana <b>", picture: "data:image/png;base64,iVBOR"}, {name: "Bo", picture: "javascript:alert(1)"}]);
  assert.ok(withFriends.html.includes('<img class="friend-pic" src="https://example.com/tom.jpg" alt="Tom">'), "Friend tiles show friend pictures");
  assert.ok(withFriends.html.includes('src="data:image/png;base64,iVBOR" alt="Ana &lt;b&gt;"'), "Inlined EnQuote avatars are allowed and names escaped");
  assert.ok(withFriends.html.includes('<div class="friend-placeholder">B</div>') && !withFriends.html.includes("javascript:"), "Unsafe friend pictures fall back to an initial");
  assert.ok(withFriends.html.includes("<strong>3</strong> friends"));
  assert.ok(withAvatar.css.includes("letter-spacing:normal"));
  for (const selector of ['class="general-about"', 'class="mood"', 'class="contact"', 'class="url-info"', 'class="table-section"', 'class="profile-info extended-network"', 'class="blog-preview"', 'class="blurbs"', 'class="friends-grid"', 'class="friends comments"']) {
    assert.ok(profile.html.includes(selector), `Classic structure provides ${selector}`);
  }
  assert.ok(profile.html.includes('class="col right"') && profile.html.includes('class="profile-center"') && profile.html.includes('class="profile-side"') && profile.html.includes('class="profile-name"'), "Profile uses Tom's left info column and right content column");
});

test("tribute music has balanced category markup and a separate Heroes row", () => {
  const music = TOM_TRIBUTE.html.match(/<dt>Music<\/dt><dd>([\s\S]*?)<\/dd><dt>Heroes<\/dt><dd>(.*?)<\/dd>/);
  assert.ok(music);
  assert.equal((music[1].match(/<p>/g) || []).length, 3);
  assert.equal((music[1].match(/<\/p>/g) || []).length, 3);
  for (const label of ["Bands:", "Solo Artists:", "Singers:"]) assert.ok(music[1].includes(`<strong>${label}</strong>`));
  assert.equal(music[1].includes("<b>"), false, "Bold styling does not leak into artist lists or Heroes");
  assert.equal(music[2], "People who help their teammates.");
});

test("desktop registers every shared profile handler before authentication", async () => {
  const {setupCollabFeatures} = createRequire(import.meta.url)("../electron/collabFeatures.cjs");
  const directory = mkdtempSync(join(tmpdir(), "enquote-profile-ipc-"));
  const handlers = new Map();
  let features;
  try {
    features = setupCollabFeatures({
      ipcMain: {handle: (channel, handler) => handlers.set(channel, handler)},
      getMainWindow: () => null, storageDir: directory,
      workerUrl: "https://example.invalid", getEmail: () => "",
      getOutboundToken: () => "", getAccessHeaders: () => ({})
    });
    for (const method of ["list", "get", "save", "remove"]) {
      const handler = handlers.get(`Base44_DTO:${method}`);
      assert.equal(typeof handler, "function", `Registered ${method}`);
      const result = await handler({});
      assert.equal(result.ok, false, "Unauthenticated call is an explicit error, not a missing handler");
    }
  } finally {
    features?.stop();
    rmSync(directory, {recursive: true, force: true});
  }
});

test("missing desktop handlers give restart guidance without hiding other errors", async () => {
  const original = globalThis.window;
  try {
    globalThis.window = {enquoteLocal: {Base44_DTO: {list: async () => {throw new Error("No handler registered for 'Base44_DTO:list'");}}}};
    await assert.rejects(retroApi.list(), /including its tray icon/);
    globalThis.window.enquoteLocal.Base44_DTO.list = async () => {throw new Error("Network unavailable");};
    await assert.rejects(retroApi.list(), /Network unavailable/);
    globalThis.window.enquoteLocal.Base44_DTO.list = async () => ({ok: false, error: "not_found"});
    await assert.rejects(retroApi.list(), /Deploy the updated EnQuote Worker/);
  } finally {
    if (original === undefined) delete globalThis.window;
    else globalThis.window = original;
  }
});

test("secret arrow sequence opens once and respects typing, timeout, modifiers, and repeats", () => {
  let time = 0;
  let opens = 0;
  const handler = createSecretSequence(() => opens++, () => time);
  const press = (key, extra = {}) => handler({key, preventDefault() {}, ...extra});
  RETRO_SEQUENCE.forEach((key) => press(key));
  assert.equal(opens, 1);
  RETRO_SEQUENCE.forEach((key) => press(key, {target: {closest: () => true}}));
  assert.equal(opens, 1);
  press("ArrowLeft"); time += 2100;
  RETRO_SEQUENCE.slice(1).forEach((key) => press(key));
  assert.equal(opens, 1);
  RETRO_SEQUENCE.forEach((key) => press(key, {repeat: true}));
  RETRO_SEQUENCE.forEach((key) => press(key, {ctrlKey: true}));
  assert.equal(opens, 1);
  RETRO_SEQUENCE.forEach((key) => press(key));
  assert.equal(opens, 2);
});

test("retro space is accessible to assigned roles, with explicit hide still winning", () => {
  assert.equal(canAccessPage({app_role: "submitter"}, "Base44_DTO", {rolePages: {}}), true);
  assert.equal(canAccessPage({app_role: "submitter", deny_pages: ["Base44_DTO"]}, "Base44_DTO"), false);
  assert.equal(canAccessPage(null, "Base44_DTO"), false);
});

test("friend tiles are clickable through a nonce-only script, and plain previews stay script-free", () => {
  const profile = materializeProfile({layout: "classic", name: "Ana", mood: "", html: "", css: ""}, "", [{name: "Tom", picture: ""}, {name: "Bo", picture: ""}]);
  assert.ok(profile.html.includes('<div class="person" data-friend="0" role="link" tabindex="0"') && profile.html.includes('data-friend="1"'), "Each friend tile carries its index");
  if (typeof globalThis.DOMParser !== "function") return;
  const linked = buildRetroPreview(profile.html, profile.css, false, true, {friendLinks: true});
  const nonce = linked.match(/script-src 'nonce-([a-f0-9]{32})'/)?.[1];
  assert.ok(nonce && linked.includes(`<script nonce="${nonce}">`) && linked.includes(FRIEND_MESSAGE));
  assert.notEqual(buildRetroPreview(profile.html, profile.css, false, true, {friendLinks: true}).match(/nonce-([a-f0-9]+)/)[1], nonce, "Nonce is random per render");
  const plain = buildRetroPreview(profile.html, profile.css);
  assert.ok(plain.includes("script-src 'none'") && !plain.includes("<script"));
});

test("avatar types are read from image bytes instead of trusting stored metadata", () => {
  assert.equal(sniffImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d])), "image/png");
  assert.equal(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffImageType(new TextEncoder().encode("GIF89a")), "image/gif");
  assert.equal(sniffImageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
  assert.equal(sniffImageType(new TextEncoder().encode("<svg onload=alert(1)>")), "");
  assert.equal(sniffImageType(new Uint8Array()), "");
});

test("pasted themes are recognized and summarized in plain language", () => {
  assert.equal(describeTheme("  ").kind, "empty");
  assert.equal(describeTheme("https://layouts.spacehey.com/layout?id=611").kind, "link");
  assert.equal(describeTheme("just some words").kind, "notCode");
  assert.equal(describeTheme(".profile{color:red}").kind, "theme");
  const info = describeTheme('<!-- Layout created by Jasmine (do not remove) --><style>body{background-image:url(https://x.test/a.gif)}</style>\nCODE BELOW GOES HERE\n<img src="giforimageurl"><img src="https://x.test/b.gif">');
  assert.deepEqual(info, {kind: "theme", credit: "Jasmine", images: 1, skippedImages: 1, skippedNotes: true, background: true});
  assert.equal(themeSummary(info), "Theme added \u2014 by Jasmine. Includes background art and 1 image. Skipped setup notes and 1 placeholder image that only make sense on SpaceHey.");
  assert.equal(themeSummary({kind: "link"}), "");
});

test("imported themes cannot replace the profile pictures users set", () => {
  for (const css of ['.profile-pic:after{background-image:url("https://x.test/theme.gif");content:""}', '<style>.profile-pic img{content:url(https://x.test/theme.gif)}</style>']) {
    for (const appearance of ["imported", "imported-raw"]) {
      const profile = materializeProfile({name: "A", mood: "", html: "", css, layout: "classic", appearance}, "data:image/gif;base64,R0lGODlhAQABAAAAACw=");
      assert.ok(profile.css.lastIndexOf(PICTURE_LOCK_CSS) > profile.css.indexOf("x.test/theme.gif"), `${appearance} locks pictures after the theme`);
    }
  }
  assert.match(PICTURE_LOCK_CSS, /\.profile-pic[^{]*::after[^{]*\{content:none!important;display:none!important/);
  assert.match(PICTURE_LOCK_CSS, /\.friend-pic\)\{content:normal!important/);
});

test("SpaceHey themes keep their palette while EnQuote keeps the profile layout", () => {
  assert.ok(CLASSIC_PROFILE_CSS.includes("var(--lighter-blue,#73a0be)") && CLASSIC_PROFILE_CSS.includes("var(--light-orange,#ffcc99)"), "SpaceHey color variables restyle the classic template");
  const draft = {name: "A", mood: "", html: "", css: ".profile .contact{background:#520030}", layout: "classic"};
  const imported = materializeProfile({...draft, appearance: "imported"}).css;
  const blocks = imported.split(/<\/style>/).map((block) => block.trim()).filter(Boolean);
  assert.equal(blocks.length, 3, "Plain CSS themes get their own style block");
  assert.ok(blocks[0].startsWith(`<style>${BASE_STYLE_MARKER}`) && blocks[2].startsWith(`<style>${BASE_STYLE_MARKER}`) && blocks[1] === `<style>${draft.css}`, "Only EnQuote blocks carry the base marker");
  assert.ok(imported.includes(BLEND_MARKER) && imported.includes("html:not(.eqp-sample):not(.eqp-plain) body"), "Blend layer can be switched off for sampling and snippet themes");
  assert.ok(imported.includes("transform:none!important;border-image:none!important"), "Theme geometry (rotations, scroll boxes, frames) is reset");
  const raw = materializeProfile({...draft, appearance: "imported-raw"}).css;
  assert.ok(!raw.includes(BLEND_MARKER) && !raw.includes("border-image:none!important"), "Untidied themes keep their own layout");
  assert.ok(materializeProfile({...draft, css: "a{content:'</style><b>'}", appearance: "imported"}).css.includes("<\\/style><b>"), "Plain CSS cannot close its style block");
});