import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {build} from "esbuild";

test("Executive grid applies equal sizing to every tile and preserves reorder behavior", async () => {
  const require = createRequire(import.meta.url);
  let onDragEnd;
  const dnd = {
    DragDropContext: props => { onDragEnd = props.onDragEnd; return props.children; },
    Droppable: ({children}) => children({innerRef() {}, droppableProps: {}, placeholder: null}),
    Draggable: ({children}) => children({innerRef() {}, draggableProps: {}, dragHandleProps: {}}, {isDragging: false})
  };
  const output = await build({
    entryPoints: [path.join("src", "components", "supervisor", "TileGrid.jsx")],
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic",
    plugins: [{name: "dnd-boundary", setup(builder) {
      builder.onResolve({filter: /^@hello-pangea\/dnd$/}, args => ({path: args.path, external: true}));
    }}]
  });
  const module = {exports: {}};
  new Function("require", "module", "exports", output.outputFiles[0].text)(
    name => name === "@hello-pangea/dnd" ? dnd : require(name), module, module.exports
  );
  let reordered;
  const tiles = ["a", "b", "c", "d", "e"].map(id => ({id, render: () => React.createElement("div", null, id)}));
  const freshness = {a: {text: "Live from EnQuote", stale: false, tone: "live"}, b: {text: "Imported May 1 · Staffing", stale: true, tone: "stale"}};
  const html = renderToStaticMarkup(React.createElement(module.exports.default, {tiles, onReorder: ids => { reordered = ids; }, freshnessFor: id => freshness[id]}));
  assert.match(html, /grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4/);
  // Wrapper stretches the tile + caption column, and the column stretches the tile itself.
  assert.equal((html.match(/\[&amp;&gt;div\]:h-full/g) || []).length, 10);
  assert.equal((html.match(/data-tile-freshness=/g) || []).length, 2);
  assert.match(html, /data-tile-freshness="stale"[^>]*>.*Stale · Imported May 1 · Staffing/);
  onDragEnd({source: {index: 0}, destination: {index: 4}});
  assert.deepEqual(reordered, ["b", "c", "d", "e", "a"]);
  assert.deepEqual(tiles.map(tile => tile.id), ["a", "b", "c", "d", "e"]);
});
