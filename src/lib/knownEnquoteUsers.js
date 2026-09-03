// Static bootstrap list of known EnQuote users (name, email). This is only a fallback for
// the login account picker - the live, synced Base44 "User" records (via getUsers()) are
// always preferred when available. This list exists so a brand-new install that hasn't
// synced with Base44 yet still has a usable account picker on first run.
//
// Keep this in sync with the Base44 "User" entity if the roster changes - it does not need
// to be perfectly current since it's never the source of truth, only a convenience. Also
// mirrored in electron/knownEnquoteUsers.cjs for the main process (which cannot import this
// ES module) - update both if the roster changes.
export const KNOWN_ENQUOTE_USERS = [
  { name: "abermudez", email: "abermudez@enphaseenergy.com" },
  { name: "ajennings", email: "ajennings@enphaseenergy.com" },
  { name: "Denice Ankenman", email: "REDACTED-USER4@example.invalid" },
  { name: "aschilling", email: "aschilling@enphaseenergy.com" },
  { name: "asharma", email: "asharma@enphaseenergy.com" },
  { name: "bkittelmann", email: "bkittelmann@enphaseenergy.com" },
  { name: "clmorrow", email: "clmorrow@enphaseenergy.com" },
  { name: "cmckenna", email: "cmckenna@enphaseenergy.com" },
  { name: "croeschberger", email: "croeschberger@enphaseenergy.com" },
  { name: "cwilson", email: "cwilson@enphaseenergy.com" },
  { name: "dankenman", email: "dankenman@enphaseenergy.com" },
  { name: "dtorchy", email: "dtorchy@enphaseenergy.com" },
  { name: "dudavis", email: "dudavis@enphaseenergy.com" },
  { name: "hmackey", email: "hmackey@enphaseenergy.com" },
  { name: "isison", email: "isison@enphaseenergy.com" },
  { name: "jlasley", email: "jlasley@enphase.com" },
  { name: "jlasley", email: "jlasley@enphaseenergy.com" },
  { name: "Joey Wood", email: "jwood@enphaseenergy.com" },
  { name: "khaumann", email: "khaumann@enphaseenergy.com" },
  { name: "mjb", email: "mjb@enphaseenergy.com" },
  { name: "mkuriakose", email: "mkuriakose@enphaseenergy.com" },
  { name: "mmccullough", email: "mmccullough@enphaseenergy.com" },
  { name: "mosley196", email: "REDACTED-USER2@example.invalid" },
  { name: "nchoudhary", email: "nchoudhary@enphaseenergy.com" },
  { name: "semani", email: "semani@enphaseenergy.com" },
  { name: "sfrederick", email: "sfrederick@enphaseenergy.com" },
  { name: "shawkins", email: "shawkins@enphaseenergy.com" },
  { name: "smosley", email: "smosley@enphaseenergy.com" },
  { name: "Todd Meyer", email: "REDACTED-USER1@example.invalid" },
  { name: "tmeyer", email: "tmeyer@enphaseenergy.com" },
  { name: "virginiaenphase", email: "REDACTED-USER3@example.invalid" },
  { name: "vseganos", email: "vseganos@enphaseenergy.com" }
];
