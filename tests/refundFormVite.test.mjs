import assert from "node:assert/strict";
import test from "node:test";
import {createServer} from "vite";

test("Vite dev converts the shared CommonJS refund schema into a browser-importable module", async () => {
  const server = await createServer({
    server: {port: 0, host: "127.0.0.1"},
    logLevel: "error"
  });
  try {
    await server.listen();
    const address = server.httpServer.address();
    const base = `http://127.0.0.1:${address.port}`;
    const component = await fetch(`${base}/src/components/enphaseCare/RefundRequestForm.jsx`);
    assert.equal(component.status, 200);
    const source = await component.text();
    const dependency = source.match(/["']([^"']*\/node_modules\/\.vite\/deps\/[^"']*refund[^"']*)["']/);
    assert.ok(dependency, `development import must be prebundled: ${source.split("\n").filter((line) => line.includes("refundForm")).join("\n")}`);
    const response = await fetch(new URL(dependency[1], base));
    assert.equal(response.status, 200);
    const schema = await response.text();
    assert.match(schema, /export\s+default\s/);
    assert.match(schema, /When should the Enphase Care plan be canceled/);
  } finally {
    await server.close();
  }
});
