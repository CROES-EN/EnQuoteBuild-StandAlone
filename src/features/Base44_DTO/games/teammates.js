export async function loadEnSpaceTeammates(listProfiles, owner) {
  const profiles = new Map(), cursors = new Set();
  let cursor;
  do {
    const result = await listProfiles(cursor);
    if (!Array.isArray(result?.profiles)) throw new Error("The EnSpace directory returned an invalid profile list. Refresh and try again.");
    for (const profile of result.profiles) {
      if (typeof profile.email !== "string" || !profile.email.trim()) continue;
      const email = profile.email.trim().toLowerCase();
      if (email !== owner.trim().toLowerCase()) profiles.set(email, {email, name: profile.name?.trim() || email});
    }
    cursor = result.cursor;
    if (cursor) {
      if (typeof cursor !== "string" || cursors.has(cursor)) throw new Error("The EnSpace directory could not finish loading. Refresh and try again.");
      cursors.add(cursor);
    }
  } while (cursor);
  return [...profiles.values()].sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
}
