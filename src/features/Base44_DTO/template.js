const escape = (value) => String(value || "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[character]));

const initial = (name) => escape(String(name || "?").trim().charAt(0).toUpperCase() || "?");
const SAFE_IMAGE = /^(https:\/\/[^\s"'<>]+|data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=]+)$/i;

function friendTile(friend, index) {
  const picture = SAFE_IMAGE.test(String(friend.picture || "")) ? friend.picture : "";
  return `<div class="person" data-friend="${index}" role="link" tabindex="0" title="Visit ${escape(friend.name)}'s page">${picture ? `<img class="friend-pic" src="${escape(picture)}" alt="${escape(friend.name)}">` : `<div class="friend-placeholder">${initial(friend.name)}</div>`}<p>${escape(friend.name)}</p></div>`;
}

export function buildClassicProfile(profile, avatar = "", friends = []) {
  const picture = String(profile.picture || "").trim();
  if (picture && !/^https:\/\/[^\s]+$/i.test(picture)) throw new Error("Profile picture must use an HTTPS image URL.");
  const image = avatar || picture;
  const section = (title, content) => `<div class="section"><h4>${escape(title)}</h4><p>${escape(content || "Not shared yet.")}</p></div>`;
  const friendCount = friends.length;
  return `<div class="container"><main><div class="row profile">
<aside class="col w-40 left">
<h1 class="profile-name">${escape(profile.name)}</h1>
<div class="general-about"><div class="profile-pic">${image ? `<img src="${escape(image)}" alt="Profile picture">` : `<div class="picture-placeholder">${initial(profile.name)}</div>`}</div>
<div class="details"><p>${escape(profile.tagline || "My corner of the web.")}</p><p>${escape(profile.location || "Here for friends and teammates.")}</p></div></div>
<div class="contact"><div class="heading"><h4>Contacting ${escape(profile.name)}</h4></div><div class="inner">
<div class="f-row"><div class="f-col">EnQuote Messages</div><div class="f-col">Browse teammates</div></div>
<p class="contact-note">Use the app controls above this profile. Friend requests and rankings are not available.</p></div></div>
<div class="url-info"><p><strong>Profile</strong><br>${escape(profile.name)}</p></div>
<div class="table-section"><div class="heading"><h4>Interests</h4></div><div class="inner"><table class="details-table"><tbody>
${[["General", profile.interests], ["Music", profile.music], ["Movies", profile.movies], ["Television", profile.television], ["Books", profile.books], ["Heroes", profile.heroes]].map(([title, text]) => `<tr><td>${title}</td><td>${escape(text || "Not shared yet.")}</td></tr>`).join("")}
</tbody></table></div></div>
<div class="table-section"><div class="heading"><h4>Details</h4></div><div class="inner"><table class="details-table"><tbody><tr><td>Here for</td><td>Friends and teammates</td></tr></tbody></table></div></div></aside>
<div class="col right"><div class="profile-center"><div class="profile-info extended-network"><p>Welcome to ${escape(profile.name)}'s space.</p></div>
<div class="blog-preview"><h4>Latest notes</h4><p>${escape(profile.notes || "No notes shared yet.")}</p></div>
<div class="blurbs"><div class="heading"><h4>${escape(profile.name)}'s Blurbs</h4></div><div class="inner">${section("About me", profile.about)}${section("Who I'd like to meet", profile.meet)}</div></div>
</div>
<div class="profile-side"><div class="mood"><div class="heading"><h4>Mood</h4></div><div class="inner"><p>${escape(profile.mood || "Just hanging out.")}</p></div></div>
<div class="friends"><div class="heading"><h4>${escape(profile.name)}'s Friend Space</h4></div><div class="inner"><p>${escape(profile.name)} has <strong>${friendCount}</strong> ${friendCount === 1 ? "friend" : "friends"}.</p><div class="friends-grid">${friends.map(friendTile).join("")}</div></div></div>
<div class="friends comments"><div class="heading"><h4>Profile Comments</h4></div><div class="inner"><p>Profile comments are not available. Use EnQuote Messages to keep in touch.</p></div></div>
</div></div></div></main></div>`;
}

export const CLASSIC_PROFILE_CSS = `body{font:12px Arial,Helvetica,sans-serif;color:#111;background:#e5efff}
.container{max-width:800px;margin:auto}main{background:white;padding:18px}
.row{display:grid;grid-template-columns:300px minmax(0,1fr);gap:24px}.col{min-width:0}
h1{font-size:18px;margin:0 0 16px}h4,p{margin:0}.general-about{display:flex;gap:12px;margin-bottom:12px}
.profile-pic{width:150px;flex-shrink:0}.profile-pic img{width:150px;max-height:180px;object-fit:cover}
.picture-placeholder{height:150px;display:grid;place-items:center;background:#d5e8fb;color:#245589}
.details{min-width:0}.details p+p{margin-top:12px}.mood{margin-bottom:16px}.table-section,.contact{border:1px solid var(--lighter-blue,#8ca9c3);margin-bottom:16px;background:#fff}
.general-about{background:#f5f8fc;border:1px solid #8ca9c3;padding:8px}
.contact .inner{padding:8px}.f-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;color:var(--darker-blue,#245589);font-size:11px}
.contact-note{font-size:10px;margin-top:8px}.url-info{border:1px solid #8ca9c3;padding:6px;margin-bottom:16px}
.heading{background:var(--lighter-blue,#73a0be);color:white;padding:4px 6px}.details-table{width:100%;border-spacing:3px;font-size:11px}
.details-table td{background:var(--lightest-blue,#d5e8fb);padding:5px;vertical-align:top;white-space:pre-wrap}
.details-table td:first-child{width:75px;background:var(--even-lighter-blue,#b1d0ef);color:var(--logo-blue,#111);font-weight:bold}
.extended-network{border:2px solid #777;text-align:center;font-weight:bold;font-size:16px;padding:20px;margin-bottom:18px}
.blog-preview{margin-bottom:18px}.blog-preview p{margin-top:10px}
.blurbs>.heading,.friends>.heading{background:var(--light-orange,#ffcc99);color:var(--dark-orange,#a34d00)}
.section{margin:12px 4px}.section h4{color:var(--dark-orange,#a34d00)}.section p{white-space:pre-wrap;margin-top:4px}
.friends{margin-top:20px}.friends .inner{padding:12px}.friends-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.person{margin-top:12px;text-align:center;color:var(--darker-blue,#245589);font-size:11px}.friend-placeholder{display:grid;place-items:center;height:70px;background:#b1d0ef;font-size:30px}
@media(max-width:600px){.row{grid-template-columns:1fr}.general-about{flex-wrap:wrap}}`;

export const PROFILE_SPACING_CSS = `*{box-sizing:border-box}
html,body{width:100%;min-width:0;margin:0;padding:0}html{overflow-x:hidden}
body{font-size:14px;line-height:1.55}
.container{width:100%!important;max-width:none!important;margin:0 0 24px!important;padding:0!important;border:0!important;background:transparent!important;box-shadow:none!important}
main{width:100%!important;max-width:none!important;min-height:0!important;margin:0!important;padding:16px 22px 16px 12px;border:1px solid rgba(20,35,55,.25);border-top:0;border-radius:0 0 8px 8px;box-shadow:0 10px 24px rgba(0,0,0,.32)}
.row.profile{display:grid;width:100%!important;grid-template-columns:300px minmax(0,1fr);align-items:start;gap:26px}
.profile>.col,.row.profile>.col{width:auto!important;min-width:0;margin:0!important}
.profile p,.profile h1,.profile h2,.profile h3,.profile h4{letter-spacing:normal;text-shadow:none;line-height:1.4}
.profile p{font-weight:normal;line-height:1.55}
.profile h1{font-size:22px;margin:0 0 14px}
.profile .profile-name{display:block!important;position:static!important;visibility:visible!important;opacity:1!important;margin:0 0 14px!important;font-size:20px!important;font-weight:700!important;line-height:1.3!important;text-indent:0!important;transform:none!important}
.profile .profile-side{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:0 14px;align-items:start}
.profile .profile-side .friends{margin-top:0}
.profile .general-about{display:grid;grid-template-columns:150px minmax(0,1fr);align-items:start;gap:12px;padding:10px;border:1px solid rgba(90,115,140,.55);border-radius:4px;margin-bottom:14px}
.profile .profile-pic{width:100%;min-width:0;padding:4px;border:1px solid rgba(90,115,140,.45)}
.profile .profile-pic img{display:block;width:100%;height:auto;max-height:250px;object-fit:cover}
.profile .picture-placeholder{min-height:190px;height:auto;padding:16px;text-align:center}
.profile .details{display:grid;gap:6px}.profile .details p+p{margin:0}
:where(.profile) :is(.contact,.url-info,.table-section,.extended-network,.blog-preview,.blurbs,.friends,.mood){border:1px solid rgba(90,115,140,.62);border-radius:4px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.12)}
.profile .contact,.profile .url-info,.profile .table-section,.profile .blog-preview,.profile .blurbs,.profile .friends,.profile .mood{margin:0 0 14px}
.profile .heading{padding:7px 10px;border-bottom:1px solid rgba(30,45,60,.18)}
.profile .inner{padding:12px}
.profile .mood .inner{padding:10px 12px;font-weight:600}
.profile .contact .inner{padding:10px}
.profile .f-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.profile .details-table{table-layout:fixed;width:100%;border-collapse:separate;border-spacing:3px}
.profile .details-table td{color:inherit;overflow-wrap:anywhere}
.profile .details-table td:first-child{width:78px}
.profile .extended-network{padding:18px;text-align:center;font-size:17px;font-weight:bold}
.profile .blog-preview{padding:12px}
.profile .blog-preview h4{font-size:14px;margin-bottom:8px}
.profile .blurbs .section{margin:0;padding:12px 14px}
.profile .blurbs .section+.section{border-top:1px solid rgba(90,115,140,.35)}
.profile .blurbs .section h4{font-size:14px}
.profile .blurbs .section p{margin-top:6px;white-space:pre-wrap}
.profile .friends-grid{grid-template-columns:repeat(auto-fill,minmax(78px,1fr));gap:10px}
.profile .person{margin-top:10px;min-width:0}
.profile .person[data-friend]{cursor:pointer;border-radius:6px;transition:transform .15s ease}.profile .person[data-friend]:hover,.profile .person[data-friend]:focus-visible{transform:translateY(-2px);outline:2px solid currentColor;outline-offset:3px}
.profile .person .friend-pic{display:block;width:100%!important;max-width:110px;height:auto!important;aspect-ratio:1;margin:0 auto;object-fit:cover}
.profile .friend-placeholder{width:100%;max-width:110px;height:auto;aspect-ratio:1;margin:0 auto;font-size:28px;font-weight:700;border:1px solid rgba(90,115,140,.4)}
.profile .person p{margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.profile .picture-placeholder{font-size:56px;font-weight:700}
@media(max-width:900px){.row.profile{grid-template-columns:240px minmax(0,1fr);gap:18px}.profile .general-about{grid-template-columns:1fr}}
@media(max-width:620px){main{padding:12px}.row.profile{grid-template-columns:minmax(0,1fr);gap:14px}.profile .general-about{grid-template-columns:minmax(110px,.8fr) minmax(0,1fr);align-items:start}.profile .picture-placeholder{min-height:140px}}
@media(max-width:400px){.profile .general-about{grid-template-columns:1fr}.profile .profile-pic{max-width:220px}.profile .details-table td:first-child{width:68px}}`;

const GOTHIC_CSS = `body{background:#16131c;color:#eee9f4}
main{background:linear-gradient(135deg,#25202e,#17141f)}
.container{border:1px solid #675572}
.profile .contact,.profile .url-info,.profile .table-section,.profile .extended-network,.profile .blog-preview,.profile .blurbs,.profile .friends,.profile .mood{background:rgba(29,25,37,.96);border-color:#796686;color:#eee9f4}
.profile .general-about,.profile .profile-pic{background:#211b2a;border-color:#796686}
.profile .heading,.profile .blurbs>.heading,.profile .friends>.heading{background:#493650;color:#f7f1fc}
.profile .section h4{color:#dbc2ea}.profile .details-table td{background:#2c2535;color:#eee9f4}
.profile .details-table td:first-child{background:#3d3048;color:#f4e7ff}
.profile .extended-network,.profile .table-section{border-color:#796686}
.profile .picture-placeholder{background:#3d3048;color:#f4e7ff}
.profile .friends .inner{background:#211b2a}.profile .person,.profile .f-row{color:#dbc2ea}
.profile .friend-placeholder{background:#3d3048;color:#f4e7ff}`;

// Imported layouts are written for SpaceHey markup and only restyle part of our template, so this layer re-skins
// every panel to keep the result cohesive. Its palette is plain variables: the preview samples the theme's own colors
// at render time (see THEME_PALETTE_SCRIPT in preview.js) and overrides them, so a pink theme stays pink. The defaults
// are tinted dark glass for themes that only bring background art. ".eqp-sample" turns the layer off while sampling
// and ".eqp-plain" leaves snippet-only themes (blinkies, stamps) on the classic look.
export const BLEND_MARKER = "/*eqp-blend*/";
// Marks style blocks EnQuote writes itself, so the preview can tell them apart from a pasted theme's blocks.
export const BASE_STYLE_MARKER = "/*eqp-base*/";
const BLEND = "html:not(.eqp-sample):not(.eqp-plain) body";
const PANELS = ":is(.general-about,.contact,.url-info,.table-section,.extended-network,.blog-preview,.blurbs,.mood,.friends)";
export const IMPORTED_BLEND_CSS = BLEND_MARKER + `${BLEND}{--eqp-accent:var(--borders,#6f5a80);--eqp-ink:#f4effa;--eqp-soft:#e3d6ee;--eqp-line:rgba(255,255,255,.16);--eqp-edge:1px solid var(--eqp-line);--eqp-glass:rgba(12,10,18,.64);--eqp-veil:rgba(6,5,10,.28);--eqp-head-bg:linear-gradient(90deg,color-mix(in srgb,var(--eqp-accent) 75%,#000),color-mix(in srgb,var(--eqp-accent) 20%,transparent));--eqp-head-ink:var(--eqp-ink);--eqp-head2-bg:var(--eqp-head-bg);--eqp-head2-ink:var(--eqp-head-ink);--eqp-label-bg:color-mix(in srgb,var(--eqp-accent) 45%,rgba(255,255,255,.08));--eqp-label-ink:var(--eqp-soft);--eqp-cell-bg:rgba(255,255,255,.05);--eqp-cell-ink:var(--eqp-ink);--eqp-shadow:0 1px 2px rgba(0,0,0,.6);--eqp-head-shadow:0 1px 3px rgba(0,0,0,.7);--eqp-name:var(--eqp-ink);--eqp-name-shadow:0 2px 6px rgba(0,0,0,.75)}
html.eqp-clear-main:not(.eqp-sample):not(.eqp-plain) body main{background:transparent!important}
${BLEND} main{color:var(--eqp-ink)!important;box-shadow:inset 0 0 0 100vmax var(--eqp-veil),0 10px 24px rgba(0,0,0,.32)!important}
${BLEND} main .profile ${PANELS}{background:var(--eqp-glass)!important;background-image:none!important;color:var(--eqp-ink)!important;border:var(--eqp-edge)!important;border-radius:8px!important;box-shadow:0 8px 22px rgba(0,0,0,.38),inset 0 1px 0 rgba(255,255,255,.06)!important;-webkit-backdrop-filter:blur(6px) saturate(115%);backdrop-filter:blur(6px) saturate(115%);margin:0 0 14px!important;text-align:left!important}
${BLEND} main .profile .heading{background:var(--eqp-head-bg)!important;color:var(--eqp-head-ink)!important;border:0!important;border-bottom:1px solid var(--eqp-line)!important;border-radius:0!important;box-shadow:none!important;margin:0!important;padding:8px 12px!important;text-align:left!important}
${BLEND} main .profile :is(.blurbs,.friends)>.heading{background:var(--eqp-head2-bg)!important;color:var(--eqp-head2-ink)!important}
${BLEND} main .profile .heading h4,${BLEND} main .profile .blog-preview h4{color:var(--eqp-head-ink)!important;font-family:inherit!important;font-size:13px!important;font-style:normal!important;font-weight:700!important;letter-spacing:.06em!important;text-transform:uppercase;text-shadow:var(--eqp-head-shadow)!important;text-align:left!important;box-shadow:none!important}
${BLEND} main .profile :is(.blurbs,.friends)>.heading h4{color:var(--eqp-head2-ink)!important}
${BLEND} main .profile .blog-preview h4{color:var(--eqp-ink)!important}
${BLEND} main .profile .inner{background:transparent!important;background-image:none!important;border:0!important;border-radius:0!important;box-shadow:none!important;margin:0!important;text-align:left!important}
${BLEND} main .profile :is(p,td,.f-row,.person){color:var(--eqp-ink)!important;letter-spacing:.01em!important;text-shadow:var(--eqp-shadow)!important}
${BLEND} main .profile p{font-weight:500!important}
${BLEND} main .profile :is(.heading h4,.section h4,.blog-preview h4,p,.f-col,.details,.section,strong,span,a){background-color:transparent!important;background-image:none!important}
${BLEND} main .profile .section h4{color:var(--eqp-soft)!important;font-family:inherit!important;font-size:14px!important;font-weight:700!important;letter-spacing:.02em!important;text-shadow:var(--eqp-shadow)!important}
${BLEND} main .profile .blurbs .section+.section{border-top:1px solid var(--eqp-line)!important}
${BLEND} main .profile .blurbs::after,${BLEND} main .profile .blurbs::before{display:none!important}
${BLEND} main .profile .details-table td{background:var(--eqp-cell-bg)!important;color:var(--eqp-cell-ink)!important;border-radius:3px}
${BLEND} main .profile .details-table td:first-child{background:var(--eqp-label-bg)!important;color:var(--eqp-label-ink)!important;font-weight:700}
${BLEND} main .profile .profile-pic{background:rgba(0,0,0,.25)!important;border-color:var(--eqp-line)!important;border-radius:6px}
${BLEND} main .profile :is(.picture-placeholder,.friend-placeholder){background:rgba(255,255,255,.08)!important;color:var(--eqp-ink)!important;border:1px solid var(--eqp-line)!important;border-radius:6px}
${BLEND} main .profile .extended-network{text-align:center!important}
${BLEND} main .profile .extended-network p{font-size:17px;font-weight:700!important}
${BLEND} main .profile .blog-preview{padding:12px!important}
${BLEND} main .profile .person p{display:block!important;color:var(--eqp-soft)!important;font-size:11px}
${BLEND} main .profile .profile-name{color:var(--eqp-name)!important;text-shadow:var(--eqp-name-shadow)!important}`;

// SpaceHey layouts often move, resize, rotate or scroll-box the profile to fit their art (a Game Boy screen, a
// fixed sidebar). Our template has different boxes, so tidied imports keep their colors and art but not geometry.
const BOXES = ":is(.profile-name,.general-about,.contact,.url-info,.table-section,.extended-network,.blog-preview,.blurbs,.mood,.friends,.profile-center,.profile-side)";
export const IMPORTED_LAYOUT_CSS = `html body main{position:relative!important;inset:auto!important;transform:none!important;border-image:none!important;height:auto!important;max-height:none!important;overflow:visible!important;zoom:1!important}
html body main .row.profile{position:static!important;display:grid!important;height:auto!important;max-height:none!important;overflow:visible!important;transform:none!important;padding:0!important;margin:0!important;writing-mode:horizontal-tb!important}
html body main .profile>.col{position:static!important;display:block!important;width:auto!important;height:auto!important;max-height:none!important;overflow:visible!important;transform:none!important;float:none!important;padding:0!important;writing-mode:horizontal-tb!important}
html body main .profile ${BOXES}{position:relative!important;inset:auto!important;width:auto!important;max-width:none!important;height:auto!important;min-height:0!important;max-height:none!important;transform:none!important;float:none!important;writing-mode:horizontal-tb!important}
html body main .profile .general-about{display:grid!important}
html body main .profile :is(.inner,.details,.section){position:static!important;width:auto!important;height:auto!important;max-height:none!important;overflow:visible!important;transform:none!important}
html body main .profile .details-table{display:table!important;width:100%!important;height:auto!important}html body main .profile .details-table tbody{display:table-row-group!important}
html body main .profile .details-table tr{display:table-row!important;height:auto!important}html body main .profile .details-table td{display:table-cell!important;height:auto!important;max-height:none!important;overflow:visible!important;margin:0!important}
html body main .profile .friends-grid{display:grid!important;height:auto!important;overflow:visible!important}html body main .profile .person{display:block!important;width:auto!important;height:auto!important;position:static!important}`;

// Themes often ship their own profile picture (pseudo-element art, backgrounds, or content:url on the img).
// Picture slots only ever show the pictures EnQuote users set; themes may still frame them.
const PICTURE_SLOTS = ".profile-pic,.picture-placeholder,.person,.friend-pic,.friend-placeholder";
export const PICTURE_LOCK_CSS = `html body main .profile :is(${PICTURE_SLOTS})::before,html body main .profile :is(${PICTURE_SLOTS})::after,
html body main .profile :is(.profile-pic,.person) *::before,html body main .profile :is(.profile-pic,.person) *::after{content:none!important;display:none!important;background:none!important}
html body main .profile :is(.profile-pic,.person,.picture-placeholder,.friend-placeholder){background-image:none!important}
html body main .profile :is(.profile-pic img,.friend-pic){content:normal!important;background-image:none!important;display:block!important;visibility:visible!important;opacity:1!important}`;

export function materializeProfile(draft, avatar = "", friends = []) {
  if (draft.layout !== "classic") return draft;
  const appearance = draft.appearance || (draft.css.trim() ? "imported" : "classic");
  const importedTheme = appearance === "imported" || appearance === "imported-raw" ? draft.css : "";
  const presetTheme = appearance === "gothic" ? GOTHIC_CSS : appearance === "imported" ? `${IMPORTED_LAYOUT_CSS}\n${IMPORTED_BLEND_CSS}` : "";
  const background = String(draft.background || "").trim();
  if (background && !/^https:\/\/[^\s"'()\\]+$/i.test(background)) throw new Error("Background must use an HTTPS image URL.");
  const backdrop = background ? `body{background-image:url("${background}");background-size:cover;background-position:center;background-attachment:fixed}` : "";
  const theme = !importedTheme.trim() || /<style(?:\s|>)/i.test(importedTheme) ? importedTheme : `<style>${importedTheme.replace(/<\/style/gi, "<\\/style")}</style>`;
  const css = `<style>${BASE_STYLE_MARKER}${CLASSIC_PROFILE_CSS}</style>\n${theme}\n<style>${BASE_STYLE_MARKER}${PROFILE_SPACING_CSS}\n${presetTheme}\n${backdrop}\n${PICTURE_LOCK_CSS}</style>`;
  return {...draft, html: buildClassicProfile(draft, avatar, friends), css};
}
