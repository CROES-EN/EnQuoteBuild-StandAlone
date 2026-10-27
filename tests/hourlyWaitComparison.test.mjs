import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {build} from "esbuild";

test("hourly comparison renders exactly the two chosen date groups and their own totals", async () => {
  const require = createRequire(import.meta.url);
  const headers = [];
  const period = {preset: "compareDays", selectedDay: "2026-10-26", comparisonDay: "2026-10-23"};
  const wrapper = ({children}) => React.createElement("div", null, children);
  const mocks = {
    "@/features/supervisorDashboard/useReportingPeriodPreference": {useReportingPeriodPreference: () => [period, () => {}]},
    "lucide-react": {CalendarRange: () => null, Clock: () => null},
    "@/components/ui/table": new Proxy({}, {get: (_, name) => name === "TableHead"
      ? props => {if (props.colSpan === 6) headers.push(props.children); return wrapper(props);}
      : wrapper})
  };
  const bundle = await build({
    entryPoints: [path.resolve("src\\components\\supervisor\\HourlyWaitTimeChart.jsx")],
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    jsx: "automatic", alias: {"@": path.resolve("src")},
    plugins: [{name: "hourly-boundaries", setup(builder) {
      builder.onResolve({filter: /./}, args => Object.hasOwn(mocks, args.path) || args.path.startsWith("@/components/ui/")
        ? {path: args.path, external: true} : undefined);
    }}]
  });
  const module = {exports: {}};
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(
    name => mocks[name] || (name.startsWith("@/components/ui/") ? new Proxy({}, {get: () => wrapper}) : require(name)),
    module, module.exports
  );
  const rows = [
    ["2026-10-23", 11], ["2026-10-24", 777], ["2026-10-25", 888], ["2026-10-26", 22]
  ].map(([date, calls]) => ({"PST Date": date, "PST Hours": 8, "# Calls": calls}));
  const html = renderToStaticMarkup(React.createElement(module.exports.default, {rows}));
  assert.deepEqual(headers, ["2026-10-23", "2026-10-26"]);
  assert.match(html, /2026-10-23 vs 2026-10-26/);
  assert.match(html, />11</);
  assert.match(html, />22</);
  assert.doesNotMatch(html, />777<|>888</);
});
