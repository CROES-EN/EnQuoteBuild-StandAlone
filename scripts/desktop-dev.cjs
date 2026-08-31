const { spawn } = require("node:child_process");
const path = require("node:path");
const http = require("node:http");

const root = path.resolve(__dirname, "..");
const vitePath = path.join(root, "node_modules", "vite", "bin", "vite.js");
const electronPath = require("electron");
const environment = { ...process.env, VITE_DATA_SOURCE: "local" };
const vite = spawn(process.execPath, [vitePath, "--host", "127.0.0.1"], { cwd: root, env: environment, stdio: "inherit" });
let electron;
let shuttingDown = false;

function waitForVite() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const request = http.get("http://127.0.0.1:5173", response => {
        response.resume();
        resolve();
      });
      request.on("error", () => {
        if (Date.now() - started > 30000) reject(new Error("Vite did not start within 30 seconds."));
        else setTimeout(check, 250);
      });
    };
    check();
  });
}

async function start() {
  await waitForVite();
  electron = spawn(electronPath, ["."], { cwd: root, env: environment, stdio: "inherit" });
  electron.on("exit", code => shutdown(code || 0));
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  vite.kill();
  if (electron && !electron.killed) electron.kill();
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
vite.on("exit", code => {
  if (!shuttingDown && code) shutdown(code);
});
start().catch(error => {
  console.error(error.message);
  shutdown(1);
});
