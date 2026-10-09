import assert from "node:assert/strict";
import {test} from "node:test";
import {createSupervisorD1} from "../test-helpers/d1Shim.js";
import {handleRetroMail} from "../src/retro-mail.js";
import {signUserToken} from "../src/user-token.js";

const SECRET = "retro-mail-test-user-token-secret";
const OUTBOUND_TOKEN = "retro-mail-test-outbound-token";
const ALLOWED = ["alice@example.com", "bob@example.com", "carol@example.com"];

function makeEnv() {
  const env = {
    DB: createSupervisorD1(["0011_retro_mail.sql"]),
    USER_TOKEN_SECRET: SECRET,
    OUTBOUND_TOKEN,
    ALLOWED_EMAILS_LIST: ALLOWED.join(","),
    broadcasts: [],
    QUOTE_SYNC_ROOM: {
      idFromName: (name) => name,
      get: () => ({fetch: async (_url, init) => {
        env.broadcasts.push(JSON.parse(init.body));
        return new Response("{}");
      }})
    }
  };
  return env;
}

async function userRequest(path, email, {method = "GET", body} = {}) {
  return new Request(`https://worker.example${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${OUTBOUND_TOKEN}`,
      "X-EnQuote-User": await signUserToken(email, SECRET),
      ...(body ? {"Content-Type": "application/json"} : {})
    },
    ...(body ? {body: JSON.stringify(body)} : {})
  });
}

test("mail send, folder visibility, unread state, contacts and deletion stay private per user", async () => {
  const env = makeEnv();
  const send = await handleRetroMail(await userRequest("/api/retro-mail/send", "alice@example.com", {
    method: "POST", body: {to: "bob@example.com", subject: "Hello", body: "A separate note."}
  }), env);
  assert.equal(send.status, 201);
  const {message} = await send.json();
  assert.equal(message.sender, "alice@example.com");
  assert.equal(env.broadcasts.length, 1);

  const aliceSent = await (await handleRetroMail(await userRequest("/api/retro-mail?folder=sent", "alice@example.com"), env)).json();
  const bobInbox = await (await handleRetroMail(await userRequest("/api/retro-mail", "bob@example.com"), env)).json();
  const carolInbox = await (await handleRetroMail(await userRequest("/api/retro-mail", "carol@example.com"), env)).json();
  assert.equal(aliceSent.messages.length, 1);
  assert.equal(bobInbox.messages.length, 1);
  assert.equal(bobInbox.counts.unread, 1);
  assert.equal(carolInbox.messages.length, 0);
  assert.equal(carolInbox.counts.unread, 0);

  const contacts = await (await handleRetroMail(await userRequest("/api/retro-mail?folder=contacts", "bob@example.com"), env)).json();
  assert.deepEqual(contacts.contacts, ["alice@example.com"]);
  const readRequest = () => userRequest("/api/retro-mail/state", "bob@example.com", {
    method: "POST", body: {id: message.id, action: "read"}
  });
  assert.equal((await (await handleRetroMail(await readRequest(), env)).json()).changed, true);
  assert.equal((await (await handleRetroMail(await readRequest(), env)).json()).changed, false, "already-read updates are not rewritten");
  assert.equal((await handleRetroMail(await userRequest("/api/retro-mail/state", "bob@example.com", {
    method: "POST", body: {id: message.id, folder: "sent"}
  }), env)).status, 404);

  const move = (folder) => userRequest("/api/retro-mail/state", "bob@example.com", {
    method: "POST", body: {id: message.id, folder}
  });
  assert.equal((await handleRetroMail(await move("saved"), env)).status, 200);
  assert.equal((await (await handleRetroMail(await userRequest("/api/retro-mail?folder=saved", "bob@example.com"), env)).json()).messages.length, 1);
  assert.equal((await handleRetroMail(await move("trash"), env)).status, 200);
  assert.equal((await handleRetroMail(await userRequest("/api/retro-mail/delete", "bob@example.com", {
    method: "POST", body: {id: message.id}
  }), env)).status, 200);
  assert.equal((await (await handleRetroMail(await userRequest("/api/retro-mail", "bob@example.com"), env)).json()).messages.length, 0);
  assert.equal((await (await handleRetroMail(await userRequest("/api/retro-mail?folder=sent", "alice@example.com"), env)).json()).messages.length, 1,
    "permanent deletion only removes the deleting user's copy");
});

test("mail validates authentication, allowed recipients, required content, folder and body size", async () => {
  const env = makeEnv();
  assert.equal((await handleRetroMail(new Request("https://worker.example/api/retro-mail"), env)).status, 401);
  const send = (body) => userRequest("/api/retro-mail/send", "alice@example.com", {method: "POST", body})
    .then((request) => handleRetroMail(request, env));
  assert.equal((await send({to: "outside@example.net", subject: "Hello", body: "Test"})).status, 400);
  assert.equal((await send({to: "alice@example.com", subject: "Hello", body: "Test"})).status, 400);
  assert.equal((await send({to: "bob@example.com", subject: "", body: "Test"})).status, 400);
  assert.equal((await send({to: "bob@example.com", subject: "x".repeat(161), body: "Test"})).status, 400);
  assert.equal((await send({to: "bob@example.com", subject: "Hello", body: "x".repeat(10_001)})).status, 400);
  assert.equal((await handleRetroMail(await userRequest("/api/retro-mail?folder=unknown", "alice@example.com"), env)).status, 400);
  const tooLarge = await handleRetroMail(new Request("https://worker.example/api/retro-mail/send", {
    method: "POST",
    headers: {Authorization: `Bearer ${OUTBOUND_TOKEN}`, "X-EnQuote-User": await signUserToken("alice@example.com", SECRET)},
    body: "x".repeat(12 * 1024 + 1)
  }), env);
  assert.equal(tooLarge.status, 413);
});
