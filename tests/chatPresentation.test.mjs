import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {build} from "esbuild";

const require = createRequire(import.meta.url);
async function load(entry, extraMocks = {}) {
  const mocks = {
    "@/lib/utils": {cn: (...values) => values.filter(Boolean).join(" ")},
    ...extraMocks
  };
  const result = await build({
    entryPoints: [path.resolve(entry)], bundle: true, write: false,
    platform: "node", format: "cjs", jsx: "automatic", packages: "external",
    alias: {"@": path.resolve("src")},
    plugins: [{name: "presentation-test", setup(builder) {
      builder.onResolve({filter: /./}, args => Object.hasOwn(mocks, args.path)
        ? {path: args.path, external: true} : undefined);
    }}]
  });
  const module = {exports: {}};
  new Function("require", "module", "exports", result.outputFiles[0].text)(
    id => Object.hasOwn(mocks, id) ? mocks[id] : require(id), module, module.exports);
  return module.exports;
}

test("GIF-only messages fill the bubble without theme color, padding, or an inner frame", async () => {
  const {default: Bubble, GifAttachment, isGifOnlyMessage} = await load("src\\components\\messages\\MessageBubble.jsx");
  const gif = {type: "gif", url: "https://example.invalid/image.gif", width: 240, height: 140, title: "GIF"};
  for (const mine of [true, false]) {
    for (const status of [undefined, "sending", "failed"]) {
      const message = {body: "", attachments: [gif], status};
      assert.equal(isGifOnlyMessage(message), true);
      const html = renderToStaticMarkup(React.createElement(Bubble, {
        message, mine, bubbleStyle: {backgroundColor: "#ffff00"}
      }, React.createElement(GifAttachment, {attachment: gif, edgeToEdge: true})));
      assert.match(html, /overflow-hidden bg-transparent/);
      assert.match(html, /group-hover\/message:ring-2/);
      assert.doesNotMatch(html, /background-color|px-3|py-2|border-white|bg-black/);
      assert.match(html, /class="block w-full object-cover"/);
      assert.match(html, /aspect-ratio:240 \/ 140/);
      assert.equal(html.includes("opacity-70"), status === "sending");
    }
  }
  for (const message of [
    {body: "Caption", attachments: [gif]},
    {body: "", attachments: [gif, {type: "app_link"}]},
    {body: "Text", attachments: []}
  ]) {
    assert.equal(Boolean(isGifOnlyMessage(message)), false);
    const html = renderToStaticMarkup(React.createElement(Bubble, {
      message, mine: true, bubbleStyle: {backgroundColor: "#ffff00"}
    }, "Content"));
    assert.match(html, /px-3 py-2/);
    assert.match(html, /background-color:#ffff00/);
    assert.match(html, /min-w-0 max-w-full \[overflow-wrap:anywhere\]/);
  }
});

test("shared app links wrap the entire label within a shrinkable chip", async () => {
  const {default: Attachment} = await load("src\\components\\messages\\AppLinkAttachment.jsx", {
    "lucide-react": {MousePointer2: () => null, X: () => null},
    "react-router-dom": {Link: ({to, children, ...props}) => React.createElement("a", {...props, href: to}, children)}
  });
  const attachment = {type: "app_link", label: "SiteIdCaseNumberCustomerStatusViewDetails".repeat(4).slice(0, 160),
    path: "/Quotes", target: {kind: "page"}};
  for (const onRemove of [undefined, () => {}]) {
    const html = renderToStaticMarkup(React.createElement(Attachment, {attachment, onRemove}));
    assert.match(html, /inline-flex min-w-0 max-w-full/);
    assert.match(html, /whitespace-normal \[overflow-wrap:anywhere\]/);
    assert.ok(html.includes(attachment.label));
    assert.doesNotMatch(html, /\btruncate\b/);
  }
});

test("Shift pointer resizing broadcasts bounded sizes; normal dragging remains local", async () => {
  globalThis.window = {innerWidth: 1280, innerHeight: 900};
  const local = [], shared = [];
  try {
    const {default: Window} = await load("src\\components\\messages\\ResizableChatWindow.jsx", {
      react: {...React,
        useState: initial => [typeof initial === "function" ? initial() : initial, value => local.push(value)],
        useRef: initial => ({current: initial}), useEffect: () => {}
      },
      "framer-motion": {motion: {section: "section"}, useReducedMotion: () => false}
    });
    const tree = Window({title: "Andrew", visible: true, onResizeAll: size => shared.push(size)});
    const handle = tree.props.children[0];
    handle.props.onPointerDown({button: 0, pointerId: 1, clientX: 400, clientY: 300,
      preventDefault() {}, currentTarget: {setPointerCapture() {}}});
    handle.props.onPointerMove({clientX: 350, clientY: 260, shiftKey: true});
    assert.deepEqual(shared, [{width: 430, height: 580}]);
    handle.props.onPointerMove({clientX: 330, clientY: 240, shiftKey: false});
    assert.deepEqual(local.at(-1), {width: 450, height: 600});
    assert.equal(shared.length, 1);
    handle.props.onPointerMove({clientX: -5000, clientY: -5000, shiftKey: true});
    assert.deepEqual(shared.at(-1), {width: 1280, height: 844});
    handle.props.onPointerUp();
    handle.props.onPointerMove({clientX: 0, clientY: 0, shiftKey: true});
    assert.equal(shared.length, 2, "pointer-up ends resizing");
    const hidden = Window({title: "Andrew", visible: false});
    assert.equal(hidden.props.style.display, "none");
    assert.equal(hidden.props.animate.display, "none");
  } finally {delete globalThis.window;}
});
