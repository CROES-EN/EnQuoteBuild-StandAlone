import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {build} from "esbuild";

const output = await build({
  entryPoints: [path.resolve("src/lib/fstLocation.js")], bundle: true, write: false, platform: "node", format: "cjs"
});
const module = {exports: {}};
new Function("module", "exports", output.outputFiles[0].text)(module, module.exports);
const {locationStatus, fstNeedsAttention, parseCoordinates, pinnedGeo, geoFromLookup, locateFstAddresses} = module.exports;

const address = "9613 Juniper Knoll, San Antonio, TX 78254";

test("location status follows the address text so a move invalidates the old spot", () => {
  assert.equal(locationStatus("", null), "missing");
  assert.equal(locationStatus(address, null), "pending");
  assert.equal(locationStatus(address, {address, lat: 29.5, lng: -98.6, precision: "zip"}), "zip");
  assert.equal(locationStatus(address, {address, lat: 29.5, lng: -98.6, precision: "street"}), "street");
  assert.equal(locationStatus(address, {address, lat: null, lng: null, precision: null}), "not_found");
  assert.equal(locationStatus(address, {address, lat: 29.5, lng: -98.6}), "pending", "legacy geo without precision is re-checked");
  const pinned = pinnedGeo(address, {lat: 29.52811234567, lng: -98.6948}, {by: "me@enphaseenergy.com"});
  assert.equal(locationStatus(address, pinned), "pinned");
  assert.equal(pinned.lat, 29.528112);
  assert.equal(pinned.pinnedBy, "me@enphaseenergy.com");
  assert.equal(locationStatus("500 New Home Rd, San Antonio, TX 78201", pinned), "pending", "moving resets the pin");
});

test("FSTs needing attention are those with ZIP-only or unfound addresses", () => {
  assert.equal(fstNeedsAttention({home_address: address, home_geo: {address, lat: 1, lng: 1, precision: "zip"}}), true);
  assert.equal(fstNeedsAttention({home_address: address, home_geo: pinnedGeo(address, {lat: 1, lng: 1})}), false);
  assert.equal(fstNeedsAttention({shipping_address: "x", ship_geo: geoFromLookup("x", null)}), true);
});

test("coordinates are read from plain pairs and Google Maps links", () => {
  assert.deepEqual(parseCoordinates("29.5282, -98.6948"), {lat: 29.5282, lng: -98.6948});
  assert.deepEqual(parseCoordinates("(29.5282 -98.6948)"), {lat: 29.5282, lng: -98.6948});
  assert.deepEqual(parseCoordinates("https://www.google.com/maps/place/9613+Juniper+Knoll/@29.52,-98.69,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d29.5282055!4d-98.6948841"), {lat: 29.5282055, lng: -98.6948841});
  assert.deepEqual(parseCoordinates("https://maps.google.com/?q=29.5282,-98.6948"), {lat: 29.5282, lng: -98.6948});
  assert.deepEqual(parseCoordinates("https://www.google.com/maps/@29.5282,-98.6948,18z"), {lat: 29.5282, lng: -98.6948});
  assert.equal(parseCoordinates("9613 Juniper Knoll"), null);
  assert.equal(parseCoordinates("129.5, -98.6"), null);
});

test("saving locates only unchecked addresses, keeps pins, and reports failed lookups", async () => {
  const pin = pinnedGeo(address, {lat: 29.5282, lng: -98.6948});
  const looked = [];
  const lookup = async (text) => {
    looked.push(text);
    if (text.startsWith("bad")) throw new Error("Geocoding service unavailable");
    return geoFromLookup(text, {lat: 30, lng: -97, precision: "street"});
  };

  const kept = await locateFstAddresses({home_address: address, home_geo: pin, shipping_address: "", ship_geo: {address: "old", lat: 1, lng: 1, precision: "street"}}, lookup);
  assert.deepEqual(looked, [], "pinned and blank addresses are not looked up");
  assert.equal(kept.record.home_geo, pin);
  assert.equal(kept.record.ship_geo, null, "a blank address clears its old location");
  assert.deepEqual(kept.failures, []);

  const moved = await locateFstAddresses({home_address: "500 New Home Rd, San Antonio, TX 78201", home_geo: pin, shipping_address: "bad address", ship_geo: null}, lookup);
  assert.deepEqual(looked, ["500 New Home Rd, San Antonio, TX 78201", "bad address"]);
  assert.equal(moved.record.home_geo.precision, "street", "a moved FST gets a fresh location instead of the old pin");
  assert.equal(moved.record.ship_geo, null);
  assert.deepEqual(moved.failures, [{label: "Ship To", address: "bad address", message: "Geocoding service unavailable"}]);
});
