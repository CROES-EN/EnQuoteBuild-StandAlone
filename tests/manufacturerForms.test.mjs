import test from "node:test";
import assert from "node:assert/strict";
import {openManufacturerForm, saveManufacturerForm, validateManufacturerFormUrl} from "../src/features/rma/manufacturerForms.js";

test("old desktop handler failures get restart instructions, other errors stay explicit", async () => {
  const url = "https://jinkosolar.us/warranty-form-1/";
  for (const bridge of [{}, {panelRmaForms:{open:async () => {throw new Error("Error invoking remote method 'panelRmaForms:open': Error: No handler registered for 'panelRmaForms:open'");}}},
    {panelRmaForms:{open:async () => ({ok:false,error:"No handler registered for 'panelRmaForms:open'"})}}]) {
    await assert.rejects(openManufacturerForm(url, bridge), /stop the desktop:dev terminal.*Reloading the page does not load/);
  }
  await assert.rejects(openManufacturerForm(url,{panelRmaForms:{open:async () => ({ok:false,error:"Network unavailable"})}}), /Network unavailable/);
  assert.deepEqual(await openManufacturerForm(url,{panelRmaForms:{open:async () => ({ok:true})}}),{ok:true});
});

test("reusable manufacturer forms save to shared SOPs and append without losing prior content or files", async () => {
  const records = [];
  let options;
  const api = {list:async () => records, uploadFile:async () => ({fileId:"pdf-id",name:"Blank claim.pdf"}),
    save:async (record, opts) => {options=opts;records.splice(0,records.length,{...record,updated_date:"2026-10-13"});return {ok:true};}};
  await saveManufacturerForm({manufacturer:"Jinko Solar",label:"Warranty claim",url:"https://jinkosolar.us/warranty-form-1/"},api);
  assert.equal(records[0].category,"Panel-Module RMA");
  assert.match(records[0].content_html,/https:\/\/jinkosolar.us\/warranty-form-1\//);
  const content = records[0].content_html;
  await saveManufacturerForm({manufacturer:"Jinko Solar",label:"Blank claim",url:"",file:{name:"Blank claim.pdf"}},api);
  assert.equal(records.length,1);
  assert.equal(records[0].content_html,content);
  assert.equal(records[0].files[0].fileId,"pdf-id");
  assert.equal(options.baseUpdatedAt,"2026-10-13");
  await saveManufacturerForm({manufacturer:"Jinko Solar",label:'Form <script>"',url:"https://jinko.example/claim"},api);
  assert.doesNotMatch(records[0].content_html, /<script>/);
});

test("invalid forms, failed uploads and conflicting saves never claim success", async () => {
  const api = {list:async () => [],save:async () => ({ok:false,reason:"conflict"}),uploadFile:async () => null};
  await assert.rejects(saveManufacturerForm({manufacturer:"Jinko",label:"Claim",url:""},api),/URL or choose/);
  await assert.rejects(saveManufacturerForm({manufacturer:"Jinko",label:"Claim",url:"javascript:alert(1)"},api),/HTTPS/);
  await assert.rejects(saveManufacturerForm({manufacturer:"Jinko",label:"Claim",url:"",file:{}},api),/Nothing was saved/);
  await assert.rejects(saveManufacturerForm({manufacturer:"Jinko",label:"Claim",url:"https://jinko.example/"},api),/changed while saving/);
  for (const url of ["http://example.com","https://127.0.0.1","https://[::1]","https://user:pass@example.com"]) assert.throws(() => validateManufacturerFormUrl(url));
});
