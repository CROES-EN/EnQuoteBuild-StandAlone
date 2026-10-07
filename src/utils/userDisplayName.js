export function userDisplayName(user) {
  const email = String(user?.email || "").trim();
  const prefix = email.split("@")[0].toLowerCase();
  const candidates = [user?.display_name, user?.full_name, user?.name].map(value => String(value || "").trim());
  return candidates.find(name => name && name.toLowerCase() !== email.toLowerCase() && name.toLowerCase() !== prefix) || "";
}

export function userOptionLabel(user) {
  const name = userDisplayName(user);
  const email = String(user?.email || "").trim();
  return name && email ? `${name} (${email})` : name || email;
}

export function labelForEmail(email, users = []) {
  const key = String(email || "").trim().toLowerCase();
  const user = users.find(item => String(item?.email || "").trim().toLowerCase() === key);
  return user ? userOptionLabel(user) : String(email || "");
}
