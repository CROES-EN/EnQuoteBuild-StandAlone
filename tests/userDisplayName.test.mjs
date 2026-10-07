import test from "node:test";
import assert from "node:assert/strict";
import {labelForEmail, userDisplayName, userOptionLabel} from "../src/utils/userDisplayName.js";

test("prefers the real display name over an email-prefix full_name", () => {
  const user = {email: "jwood@enphaseenergy.com", full_name: "jwood", display_name: "Joey Wood"};
  assert.equal(userDisplayName(user), "Joey Wood");
  assert.equal(userOptionLabel(user), "Joey Wood (jwood@enphaseenergy.com)");
});

test("does not repeat the email when no real name is known", () => {
  assert.equal(userOptionLabel({email: "x@enphaseenergy.com", full_name: "x", name: "x@enphaseenergy.com"}), "x@enphaseenergy.com");
});

test("labels an owner email case-insensitively and falls back to the email", () => {
  const users = [{email: "Shane@enphaseenergy.com", display_name: "Shane Mosely"}];
  assert.equal(labelForEmail("shane@enphaseenergy.com", users), "Shane Mosely (Shane@enphaseenergy.com)");
  assert.equal(labelForEmail("other@enphaseenergy.com", users), "other@enphaseenergy.com");
});
