import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {build} from "esbuild";
import {parseNotificationTimestamp} from "../src/features/notifications/notificationTimestamp.js";

test("reported Base44 timestamp is 4:20 PM Mountain time, not 10:20 PM", () => {
  const time = parseNotificationTimestamp("2026-10-07T22:20:21.083334");
  assert.equal(time, Date.parse("2026-10-07T22:20:21.083Z"));
  assert.equal(new Date(time).toLocaleTimeString("en-US", {
    timeZone: "America/Denver", hour: "numeric", minute: "2-digit", hour12: true
  }), "4:20 PM");
  assert.equal(parseNotificationTimestamp("2026-10-07T16:20:21.083-06:00"), time);
  assert.ok(Number.isNaN(parseNotificationTimestamp(null)));
});

test("bell shows recorded editors and assignment sender, links tasks, and refreshes on task sync", async () => {
  let cursor = 0;
  const effects = [];
  let subscribed;
  let loaded = 0;
  let unsubscribed = false;
  const notices = [{id: "assignment", type: "task_assigned", taskId: "task id",
    taskTitle: "Call homeowner", changedBy: "sender@example.com", occurredAt: "2026-10-07T20:00:00Z"}];
  const wrapper = ({children}) => React.createElement("div", null, children);
  const mocks = {
    react: {...React, useState: initial => [cursor++ === 0 ? notices : initial, () => {}],
      useEffect: effect => effects.push(effect), useCallback: fn => fn, useRef: value => ({current: value})},
    "react-router-dom": {Link: ({to, children}) => React.createElement("a", {href: to}, children)},
    "lucide-react": {ArrowUpRight: () => null, Bell: () => null, X: () => null},
    "@/components/ui/popover": {Popover: wrapper, PopoverContent: wrapper, PopoverTrigger: wrapper},
    "@/utils": {createPageUrl: value => value},
    "@/features/notifications/appNotifications": {
      listNotifications: async () => {loaded++; return notices;},
      markAllRead: async () => {}, clearNotification: async () => {}, clearAllNotifications: async () => {}
    },
    "@/lib/userScopedStorage": {onUserSessionChanged: () => () => {}},
    "@/features/collab/collabApi": {subscribe: (group, event, callback) => {
      assert.equal(group, "tasks");
      assert.equal(event, "onChanged");
      subscribed = callback;
      return () => {unsubscribed = true;};
    }},
    sonner: {toast: {error: assert.fail}}
  };
  const result = await build({
    entryPoints: [path.resolve("src\\components\\NotificationBell.jsx")], bundle: true, write: false,
    platform: "node", format: "cjs", packages: "external", jsx: "automatic",
    plugins: [{name: "notification-boundaries", setup(builder) {
      builder.onResolve({filter: /./}, args => Object.hasOwn(mocks, args.path) ? {path: args.path, external: true} : undefined);
    }}]
  });
  const module = {exports: {}};
  const require = createRequire(import.meta.url);
  new Function("require", "module", "exports", result.outputFiles[0].text)(name => mocks[name] || require(name), module, module.exports);
  const format = module.exports.formatNotificationMessage;
  const base = {type: "quote_updated", quoteNumber: "Q-123", occurredAt: notices[0].occurredAt};
  assert.match(format({...base, changedBy: "editor@example.com"}), /Q-123 updated by editor@example.com/);
  assert.match(format({...base, updated_by: "external@example.com"}), /updated by external@example.com/);
  assert.match(format(base), /updater not recorded/);
  assert.match(format({...base, changedBy: "demo@example.invalid"}), /updater not recorded/);
  assert.match(format({...base, changedBy: "status.author@example.com", attributionSource: "status_history"}),
    /Q-123 updated \(last status update by status.author@example.com\)/);
  assert.match(format({...base, changedBy: "demo@example.invalid", updated_by: "real@example.com"}),
    /updated by real@example.com/);
  assert.equal(
    format({...base, occurredAt: "2026-10-07T22:20:21.083334"}),
    format({...base, occurredAt: "2026-10-07T22:20:21.083Z"}),
    "Base44's timezone-less UTC timestamp renders like the same explicit UTC instant"
  );
  assert.match(format({...base, occurredAt: "invalid"}), /time not recorded/);
  assert.match(format({...base, type: "product_updated", productName: "Panel", changedBy: "editor@example.com"}), /Panel updated by editor@example.com/);
  const html = renderToStaticMarkup(React.createElement(module.exports.default));
  assert.match(html, /Task assigned by sender@example.com: Call homeowner/);
  assert.match(html, /href="\/Tasks\?task=task%20id"/);
  const cleanups = effects.map(effect => effect());
  try {
    await subscribed();
    assert.equal(loaded, 2, "initial load and task-sync refresh run");
  } finally {cleanups.forEach(cleanup => cleanup?.());}
  assert.equal(unsubscribed, true);
});
