import test from "node:test";
import assert from "node:assert/strict";
import {loadEnSpaceTeammates} from "../src/features/Base44_DTO/games/teammates.js";

test("teammates include every published profile page, exclude self, deduplicate, and sort by name", async () => {
  const calls = [];
  const profiles = await loadEnSpaceTeammates(async cursor => {
    calls.push(cursor);
    return cursor ? {profiles:[{email:"b@example.com",name:"Amy"},{email:"a@example.com",name:"Zoe"}],cursor:null}
      : {profiles:[{email:" ME@example.com ",name:"Me"},{email:"A@example.com",name:"Old"}],cursor:"page2"};
  }, "me@example.com");
  assert.deepEqual(calls, [undefined,"page2"]);
  assert.deepEqual(profiles, [{email:"b@example.com",name:"Amy"},{email:"a@example.com",name:"Zoe"}]);
});

test("directory failures and repeated cursors are explicit instead of returning partial success", async () => {
  await assert.rejects(loadEnSpaceTeammates(async () => {throw new Error("Offline");}, "me"), /Offline/);
  await assert.rejects(loadEnSpaceTeammates(async () => ({profiles:[],cursor:"same"}), "me"), /finish loading/);
  await assert.rejects(loadEnSpaceTeammates(async () => ({}), "me"), /invalid profile list/);
  assert.deepEqual(await loadEnSpaceTeammates(async () => ({profiles:[],cursor:null}), "me"), []);
});
