import test from "node:test";
import assert from "node:assert/strict";
import {buildRmaRecord, saveRmaRecord} from "../src/features/rma/rmaRecords.js";

const form = {case_owner:"owner@example.com",site_id:"123",case_id:"456",panel_manufacturer:"Manufacturer",
  panel_model:"Model",panel_quantity:"2",serial_numbers:"serial1\nserial2",manufacturer_rma_number:"RMA-123",current_status:"New"};
function store() {
  const data = {rmas:[],pvManufacturers:[]};
  return {data,list:async name => structuredClone(data[name]),create:async (name, record) => {
    const saved = {...record,id:record.id || "new-id",updated_date:"2026-10-13T12:00:00Z"};
    data[name].push(saved);return saved;
  },update:async (name,id,changes) => {
    const item = data[name].find(record => record.id === id);Object.assign(item,changes);return item;
  }};
}
test("Panel RMA saves tracker details without blocking quotes",async () => {
  const api = store();
  const saved = await saveRmaRecord({formData:form,email:"owner@example.com",
    source:{source_category:"panel_rma",source_case_number:"456"}},api);
  assert.equal(saved.panel_quantity,2);
  assert.equal(saved.serial_numbers,"serial1\nserial2");
  assert.equal(saved.manufacturer_rma_number,"RMA-123");
  assert.equal(saved.source_category,"panel_rma");
  assert.equal(saved.id,"new-id");
  assert.equal(saved.status_history[0].new_status,"New");
  await assert.rejects(saveRmaRecord({formData:form,email:"owner@example.com"},api), /already has/);
  await saveRmaRecord({formData:{...form,current_status:"RMA Submitted"},existingRma:saved,email:"owner@example.com"},api);
  assert.equal(api.data.rmas.length,1);
  assert.equal(api.data.rmas[0].status_history.length,2);
  assert.equal(api.data.rmas[0].source_category,"panel_rma");
});
test("RMA validation rejects incomplete forms, invalid quantity/status/URL and stale edits",async () => {
  for (const changes of [{site_id:""},{panel_manufacturer:""},{panel_quantity:0},{panel_quantity:1.5},
    {current_status:"unknown"},{rma_url:"javascript:alert(1)"}]) {
    assert.throws(() => buildRmaRecord({...form,...changes},null,"owner@example.com"));
  }
  const api = store();
  const saved = await saveRmaRecord({formData:form,email:"owner@example.com"},api);
  await assert.rejects(saveRmaRecord({formData:form,email:"owner@example.com",
    existingRma:{...saved,updated_date:"old"}},api),/changed while/);
  assert.equal(api.data.rmas.length,1);
});
