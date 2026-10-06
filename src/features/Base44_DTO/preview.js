import DOMPurify from "dompurify";
import {BASE_STYLE_MARKER, BLEND_MARKER} from "./template.js";

export const STARTER_HTML = `<header><h1>Welcome to my space!</h1><p>Thanks for stopping by. Leave your worries at the door.</p></header>
<div class="columns"><aside><h2>About me</h2><p>Online and feeling nostalgic.</p><p>Interests: music, friends, and getting things done.</p></aside>
<main><h2>My little corner of the internet</h2><p>Edit the HTML and CSS to make this page yours!</p><div class="badge">★ 2005 vibes ★</div><h2>Who I'd like to meet</h2><p>My awesome teammates.</p></main></div>`;
export const STARTER_CSS = `body { background: #dcecff; color: #17264a; font-family: Verdana, sans-serif; }
header { background: #064b98; color: white; padding: 24px; border-bottom: 8px solid #ff9933; }
.columns { display: grid; grid-template-columns: 1fr 2fr; gap: 20px; padding: 20px; }
aside, main { background: white; border: 2px solid #7aa7d5; padding: 16px; }
h2 { background: #ffdbb6; color: #a34d00; padding: 8px; font-size: 16px; }
.badge { padding: 20px; text-align: center; background: #ffe58f; border: 3px dashed #ec008c; }
@media (max-width: 600px) { .columns { grid-template-columns: 1fr; } }`;

function extractStyleText(markup) {
  const document = new DOMParser().parseFromString(String(markup), "text/html");
  const blocks = [...document.querySelectorAll("style")].map((style) => style.textContent);
  return {document, blocks};
}

// Each source <style> stays its own stylesheet so an unclosed block in a pasted theme can't swallow later CSS.
// Blocks that did not come from EnQuote are tagged so the palette script can compare the page with and without them.
function styleTags(blocks) {
  return blocks.filter((block) => block.trim()).map((block) => `<style${block.startsWith(BASE_STYLE_MARKER) ? "" : " data-eqp-theme"}>${block.replace(/</g, "\\3c ")}</style>`).join("\n");
}

function cssBlocks(html, css) {
  const cssText = String(css);
  const cssParts = /<style(?:\s|>)/i.test(cssText) ? extractStyleText(cssText) : null;
  const htmlParts = extractStyleText(html);
  return {htmlParts, cssParts, blocks: [...htmlParts.blocks, ...(cssParts ? cssParts.blocks : [cssText])]};
}

const LOADABLE_IMAGE = /^(https:\/\/\S+|data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=]+)$/i;

function dropDeadImages(root) {
  root.querySelectorAll("img").forEach((image) => {
    if (!LOADABLE_IMAGE.test(image.getAttribute("src")?.trim() || "")) image.remove();
  });
}

// Pasted themes often carry template leftovers outside their <style> blocks: setup instructions, placeholder
// <img src="yourimageurl"> tags, and embeds meant for other sites. Keep only what a theme can actually display:
// elements the author named with a class or id (decorations its CSS positions) and loadable images, which are
// gathered into a framed strip so they never spill under the profile as loose page content.
// Credit badges for cursor sites are link-backs meant for the corner of a SpaceHey page, not part of the look.
const CREDIT_BADGE = /cursors?-4u|cursor\.png/i;

function themeDecorations(body) {
  dropDeadImages(body);
  body.querySelectorAll("img").forEach((image) => {
    if (CREDIT_BADGE.test(image.getAttribute("src") || "") || CREDIT_BADGE.test(image.closest("a")?.getAttribute("href") || "")) image.remove();
  });
  const decorations = [];
  const extras = [];
  for (const node of [...body.childNodes]) {
    if (node.nodeType !== 1) continue;
    if (node.id || node.getAttribute("class")?.trim()) decorations.push(node);
    else extras.push(...(node.matches("img") ? [node] : node.querySelectorAll("img")));
  }
  return {decorations, extras};
}

function placeThemeDecorations(htmlDocument, themeBody) {
  if (!themeBody) return;
  const {decorations, extras} = themeDecorations(themeBody);
  const body = htmlDocument.body;
  if (extras.length) {
    const strip = htmlDocument.createElement("div");
    strip.className = "eqp-theme-extras";
    extras.forEach((image) => strip.append(htmlDocument.importNode(image, true)));
    (body.querySelector(".profile-center") || body.querySelector("main") || body).append(strip);
  }
  decorations.forEach((node) => body.append(htmlDocument.importNode(node, true)));
}

const THEME_EXTRAS_CSS = "html body .eqp-theme-extras{display:flex!important;flex-wrap:wrap;justify-content:center;align-items:center;gap:8px;margin:12px 0 0!important;padding:10px!important;border-radius:8px;background:rgba(0,0,0,.25)}html body .eqp-theme-extras img{display:block;max-width:min(100%,350px)!important;height:auto!important;max-height:220px;object-fit:contain}";

// SpaceHey themes commonly @import a hosted stylesheet or a Google Font, so HTTPS styles and fonts may load like
// HTTPS images already do. Scripts stay nonce-only and the frame is sandboxed, so this cannot run theme code.
function previewCsp(nonce = "") {
  return "default-src 'none'; script-src " + (nonce ? `'nonce-${nonce}'` : "'none'") + "; style-src 'unsafe-inline' https:; img-src https: data:; font-src https: data:; connect-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
}

export function buildRetroBackground(html, css) {
  const themeStyles = styleTags(cssBlocks(html, css).blocks);
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${previewCsp()}">
<meta name="referrer" content="no-referrer"><style>
html,body{box-sizing:border-box;width:100%;height:100%;min-height:100%;margin:0}
*,*::before,*::after{animation:none!important;transition:none!important}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
</style>${themeStyles}</head><body></body></html>`;
}

// Snowflake decorations get a self-contained falling layer so a theme's broken media query can't stack them on the page.
const SNOWFLAKE_FALLBACK_CSS = `html body .snowflakes{position:fixed!important;inset:0!important;width:auto!important;height:auto!important;margin:0!important;padding:0!important;overflow:hidden!important;z-index:2147483647!important;pointer-events:none!important}
html body .snowflakes .snowflake{position:absolute!important;top:-10%;margin:0!important;user-select:none;animation-name:eqp-heart-fall,eqp-heart-shake;animation-duration:10s,3s;animation-timing-function:linear,ease-in-out;animation-iteration-count:infinite,infinite}
@keyframes eqp-heart-fall{0%{top:-10%}100%{top:100%}}@keyframes eqp-heart-shake{0%,100%{transform:translateX(0)}50%{transform:translateX(80px)}}
${[[1, 0, 0], [7, 1, 1], [13, 6, .5], [19, 4, 2], [25, 2, 2], [31, 8, 3], [37, 6, 2], [43, 2.5, 1], [49, 1, 0], [55, 3, 1.5], [61, 2, 0], [67, 4, 2.5], [73, 7, 1], [79, 5, .5], [85, 9, 2], [91, 3.5, 1]]
    .map(([left, fall, shake], index) => `html body .snowflakes .snowflake:nth-of-type(${index + 1}){left:${left}%;animation-delay:${fall}s,${shake}s}`).join("")}`;
// SpaceHey-style layouts center a fixed-width .container; viewing mode pins it under the page header instead.
const PROFILE_FIT_CSS = "html body .container{box-sizing:border-box!important;width:100%!important;max-width:none!important;min-width:0!important;margin:0!important;left:auto!important;right:auto!important;transform:none!important}html body .container>main,html body>main{box-sizing:border-box!important;width:100%!important;max-width:none!important;min-height:100vh!important;margin:0!important}" + SNOWFLAKE_FALLBACK_CSS;

export const FRIEND_MESSAGE = "eqp-friend";
// The only script allowed in a profile frame: it reports which Friend Space tile was activated and nothing else.
const FRIEND_LINK_SCRIPT = `(function(){function pick(e){var t=e.target&&e.target.closest?e.target.closest("[data-friend]"):null;if(!t)return;e.preventDefault();parent.postMessage({type:"${FRIEND_MESSAGE}",index:Number(t.getAttribute("data-friend"))},"*")}
document.addEventListener("click",pick);document.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" ")pick(e)})})();`;

// Imported themes are re-skinned by IMPORTED_BLEND_CSS. This script reads what the theme actually changed (computed
// styles with and without the theme's blocks, blend layer off) and feeds the theme's own colors into the blend
// variables, nudging text until it is readable. Themes that change no colors or backgrounds keep the classic look.
function themePalette() {
  var root = document.documentElement, body = document.body;
  var parts = {html: "html", body: "body", main: "main", row: ".row.profile", left: ".profile .left", panel: ".profile .blurbs", contact: ".profile .contact", head: ".profile .contact>.heading", headText: ".profile .contact>.heading h4", head2: ".profile .blurbs>.heading", head2Text: ".profile .blurbs>.heading h4", label: ".profile .details-table td:first-child", cell: ".profile .details-table td:last-child", h4: ".profile .blurbs .section h4", text: ".profile .blurbs .section p", name: ".profile .profile-name"};
  var props = ["backgroundColor", "backgroundImage", "color", "borderTopColor", "borderTopWidth", "borderTopStyle"];
  function sample() {
    var out = {};
    Object.keys(parts).forEach(function (key) {
      var element = document.querySelector(parts[key]);
      if (!element) return;
      var style = getComputedStyle(element);
      out[key] = {};
      props.forEach(function (prop) { out[key][prop] = style[prop]; });
    });
    return out;
  }
  function sheets(selector, disabled) { document.querySelectorAll(selector).forEach(function (style) { if (style.sheet) style.sheet.disabled = disabled; }); }
  root.classList.add("eqp-sample");
  sheets("style[data-eqp-frame]", true);
  var theme = sample();
  sheets("style[data-eqp-theme]", true);
  var base = sample();
  sheets("style[data-eqp-theme]", false);
  sheets("style[data-eqp-frame]", false);
  function settle(mode) {
    root.classList.remove("eqp-sample");
    if (mode) root.classList.add(mode);
    root.classList.add("eqp-settle");
    void body.offsetHeight;
    requestAnimationFrame(function () { root.classList.remove("eqp-settle"); });
  }
  function changed(key, prop) { return Boolean(theme[key] && base[key] && theme[key][prop] !== base[key][prop]); }
  function rgba(value) {
    var match = /rgba?\(([^)]+)\)/.exec(value || "");
    if (!match) return null;
    var p = match[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  function solid(key, prop) {
    if (!changed(key, prop || "backgroundColor")) return null;
    var color = rgba(theme[key][prop || "backgroundColor"]);
    return color && color[3] > 0.05 ? color : null;
  }
  function themed(key, prop) { return changed(key, prop) ? rgba(theme[key][prop]) : null; }
  function over(top, under) { return [0, 1, 2].map(function (i) { return top[i] * top[3] + under[i] * (1 - top[3]); }).concat(1); }
  function lum(color) {
    var c = color.slice(0, 3).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  var WHITE = [255, 255, 255, 1], BLACK = [0, 0, 0, 1];
  function readable(color, bg, min) {
    color = over(color, bg);
    if (contrast(color, bg) >= min) return color;
    var target = contrast(WHITE, bg) >= contrast(BLACK, bg) ? WHITE : BLACK;
    // A color that nearly vanishes here was meant for another backdrop; a muddy midpoint would only look dim.
    if (contrast(color, bg) < 2) return target === WHITE ? [244, 239, 250, 1] : [27, 22, 34, 1];
    for (var w = 0.1; w < 1; w += 0.1) {
      var mixed = [0, 1, 2].map(function (i) { return color[i] + (target[i] - color[i]) * w; }).concat(1);
      if (contrast(mixed, bg) >= min) return mixed;
    }
    return target;
  }
  function css(color, alpha) { return "rgba(" + color.slice(0, 3).map(Math.round).join(",") + "," + Math.round((alpha === undefined ? color[3] : alpha) * 1000) / 1000 + ")"; }
  var set = function (name, value) { body.style.setProperty("--eqp-" + name, value); };
  var backgroundChanged = ["html", "body", "main", "row", "panel", "contact"].some(function (key) { return changed(key, "backgroundColor") || changed(key, "backgroundImage"); });
  var textColor = themed("text", "color") || themed("main", "color") || themed("row", "color");
  if (!backgroundChanged) {
    var plainBg = over(rgba(theme.panel.backgroundColor) || [0, 0, 0, 0], over(rgba(theme.main.backgroundColor) || [0, 0, 0, 0], WHITE));
    if (contrast(rgba(theme.text.color) || BLACK, plainBg) >= 3) return settle("eqp-plain");
  }
  var surface = solid("panel") || solid("contact") || solid("row") || solid("main");
  var mainColor = solid("main");
  if (!changed("main", "backgroundColor") && !changed("main", "backgroundImage")) root.classList.add("eqp-clear-main");
  if (mainColor || changed("main", "backgroundImage")) set("veil", "transparent");
  var bg = [24, 20, 30, 1];
  if (surface) {
    var alpha = Math.max(surface[3], 0.82);
    bg = over([surface[0], surface[1], surface[2], alpha], lum(surface) < 0.25 ? BLACK : WHITE);
    set("glass", css(surface, alpha));
  }
  var light = lum(bg) > 0.3;
  var ink = readable(textColor || (light ? [27, 22, 34, 1] : [244, 239, 250, 1]), bg, 4.5);
  set("ink", css(ink));
  set("soft", css(readable(themed("h4", "color") || ink, bg, 4.5)));
  if (light) { set("shadow", "none"); set("head-shadow", "none"); set("cell-bg", "rgba(0,0,0,.04)"); set("label-bg", "color-mix(in srgb,var(--eqp-accent) 22%,transparent)"); }
  var border = themed("panel", "borderTopColor") || themed("contact", "borderTopColor");
  var edgeKey = changed("panel", "borderTopColor") ? "panel" : "contact";
  var edgeWidth = parseFloat(theme[edgeKey] && theme[edgeKey].borderTopWidth) || 0, edgeStyle = theme[edgeKey] && theme[edgeKey].borderTopStyle;
  if (border && border[3] > 0.05 && edgeWidth > 0 && edgeStyle !== "none" && edgeStyle !== "hidden") {
    set("accent", css(border, 1));
    set("line", css(border, 0.5));
    set("edge", Math.min(edgeWidth, 6) + "px " + edgeStyle + " " + css(border));
  }
  var head = solid("head"), head2 = solid("head2") || head;
  if (head) {
    if (!border) set("accent", css(head, 1));
    var headBg = over(head, bg);
    set("head-bg", css(head));
    set("head-ink", css(readable(themed("headText", "color") || themed("head", "color") || ink, headBg, 4.5)));
    set("head-shadow", lum(headBg) > 0.3 ? "none" : "0 1px 3px rgba(0,0,0,.7)");
  } else if (light) {
    set("head-ink", "#f4effa");
  }
  if (head2) {
    var head2Bg = over(head2, bg);
    set("head2-bg", css(head2));
    set("head2-ink", css(readable(themed("head2Text", "color") || themed("head2", "color") || themed("headText", "color") || ink, head2Bg, 4.5)));
  }
  var label = solid("label");
  if (label) {
    set("label-bg", css(label));
    set("label-ink", css(readable(themed("label", "color") || ink, over(label, bg), 4.5)));
  }
  var cell = solid("cell");
  if (cell) {
    set("cell-bg", css(cell));
    set("cell-ink", css(readable(themed("cell", "color") || ink, over(cell, bg), 4.5)));
  }
  var nameColor = themed("name", "color") || textColor || ink;
  var bodyColor = theme.body.backgroundImage === "none" ? solid("body") : null;
  var column = solid("left") ? over(solid("left"), mainColor ? over(mainColor, WHITE) : WHITE) : null;
  var behindName = solid("name") ? over(solid("name"), column || (mainColor ? over(mainColor, WHITE) : WHITE)) : column ? column : mainColor ? over(mainColor, WHITE) : bodyColor ? over(bodyColor, WHITE) : null;
  if (behindName) {
    set("name", css(readable(nameColor, behindName, 4.5)));
    if (lum(behindName) > 0.3) set("name-shadow", "none");
  } else {
    set("name", css(readable(nameColor, [20, 16, 26, 1], 4.5)));
    set("name-shadow", "0 0 2px #000,0 0 6px #000,0 2px 8px rgba(0,0,0,.9)");
  }
  settle("");
}
const THEME_PALETTE_SCRIPT = `(${themePalette.toString()})();`;
const PALETTE_SAMPLE_CSS = "html.eqp-sample *,html.eqp-sample *::before,html.eqp-sample *::after,html.eqp-settle *,html.eqp-settle *::before,html.eqp-settle *::after{transition:none!important}";

// Full-screen pseudo-element art (CRT bezels, scanlines, rain) is painted by the background frame in viewing mode,
// so the profile frame drops it; while editing it sits behind the profile instead of covering it.
const OVERLAY_HIDE_CSS = "html::before,html::after,body::before,body::after{display:none!important}";
const OVERLAY_BEHIND_CSS = "html::before,html::after,body::before,body::after{z-index:-1!important;pointer-events:none!important}";

function randomNonce() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function buildRetroPreview(html, css, animate = false, transparentBackground = false, {friendLinks = false} = {}) {
  const {htmlParts, cssParts, blocks} = cssBlocks(html, css);
  const palette = blocks.some((block) => block.includes(BLEND_MARKER));
  const nonce = friendLinks || palette ? randomNonce() : "";
  htmlParts.document.querySelectorAll("style").forEach((style) => style.remove());
  cssParts?.document.querySelectorAll("style").forEach((style) => style.remove());
  dropDeadImages(htmlParts.document.body);
  placeThemeDecorations(htmlParts.document, cssParts?.document.body);
  const clean = DOMPurify.sanitize(htmlParts.document.body.innerHTML, {
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "textarea", "select", "link", "meta", "base", "audio", "video", "svg", "math", "style"],
    FORBID_ATTR: ["href", "srcset", "autofocus", "contenteditable", "action", "formaction"]
  });
  const themeStyles = styleTags(blocks);
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${previewCsp(nonce)}">
<meta name="referrer" content="no-referrer"><style>body{margin:0;overflow-wrap:anywhere}img{max-width:100%;height:auto}</style>
${themeStyles}<style>${animate ? "" : "*,*::before,*::after{animation:none!important;transition:none!important}"} ${THEME_EXTRAS_CSS} ${PALETTE_SAMPLE_CSS} ${transparentBackground ? OVERLAY_HIDE_CSS : OVERLAY_BEHIND_CSS} @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}</style>
${transparentBackground ? `<style data-eqp-frame>html,body{background:transparent!important;margin:0!important;padding:0!important}${PROFILE_FIT_CSS}</style>` : ""}
</head><body>${clean}${friendLinks ? `<script nonce="${nonce}">${FRIEND_LINK_SCRIPT}</script>` : ""}${palette ? `<script nonce="${nonce}">${THEME_PALETTE_SCRIPT}</script>` : ""}</body></html>`;
}
