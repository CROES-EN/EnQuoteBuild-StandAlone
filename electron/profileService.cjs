const fs = require("node:fs");
const path = require("node:path");

function createProfileService({ client, storageDir, logger = console, onChanged = () => {} }) {
  const avatarDir = path.join(storageDir, "profile-avatars");

  function avatarPath(avatarId) {
    return path.join(avatarDir, `${String(avatarId || "").toLowerCase()}.bin`);
  }

  function metaPath(avatarId) {
    return path.join(avatarDir, `${String(avatarId || "").toLowerCase()}.json`);
  }

  async function list() {
    const result = await client.get("/api/profiles");
    return { ok: true, profiles: Array.isArray(result.profiles) ? result.profiles : [] };
  }

  async function setAvatar({ bytes, type } = {}) {
    const buffer = Buffer.from(bytes || []);
    const result = await client.upload("/api/profiles/avatar", { bytes: buffer, type: String(type || "application/octet-stream") });
    try {
      fs.mkdirSync(avatarDir, { recursive: true });
      fs.writeFileSync(avatarPath(result.avatarId), buffer);
      fs.writeFileSync(metaPath(result.avatarId), JSON.stringify({ type }), "utf8");
    } catch (error) {
      logger.warn?.("[profiles] Could not cache avatar:", error.message);
    }
    return { ok: true, avatarId: result.avatarId };
  }

  async function removeAvatar() {
    await client.post("/api/profiles/avatar/remove", {});
    return { ok: true };
  }

  async function getAvatar(avatarId) {
    const id = String(avatarId || "").toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(id)) return { ok: false, reason: "invalid_avatar_id", error: "invalid_avatar_id" };
    try {
      const bytes = fs.readFileSync(avatarPath(id));
      let type = "application/octet-stream";
      try { type = JSON.parse(fs.readFileSync(metaPath(id), "utf8"))?.type || type; } catch {}
      return { ok: true, bytes: new Uint8Array(bytes), type };
    } catch {
      const downloaded = await client.download(`/api/profiles/avatar/${id}`);
      try {
        fs.mkdirSync(avatarDir, { recursive: true });
        fs.writeFileSync(avatarPath(id), Buffer.from(downloaded.bytes));
        fs.writeFileSync(metaPath(id), JSON.stringify({ type: downloaded.type }), "utf8");
      } catch (error) {
        logger.warn?.("[profiles] Could not cache downloaded avatar:", error.message);
      }
      return { ok: true, ...downloaded };
    }
  }

  function changed() {
    try { onChanged({}); } catch (error) { logger.warn?.("[profiles] Change listener failed:", error.message); }
  }

  return { list, setAvatar, removeAvatar, getAvatar, changed };
}

module.exports = { createProfileService };
