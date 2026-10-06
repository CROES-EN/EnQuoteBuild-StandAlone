export function createAvatarCache({load, createUrl, revokeUrl, maxUnused = 32}) {
  const entries = new Map();

  function prune() {
    const unused = [...entries].filter(([, entry]) => entry.url && entry.users === 0);
    while (unused.length > maxUnused) {
      const [id, entry] = unused.shift();
      entries.delete(id);
      revokeUrl(entry.url);
    }
  }

  async function acquire(id) {
    let entry = entries.get(id);
    if (!entry) {
      entry = {users: 0, url: "", promise: null};
      entries.set(id, entry);
      entry.promise = Promise.resolve().then(() => load(id)).then((result) => {
        entry.url = createUrl(result);
        return entry.url;
      });
    }
    entries.delete(id);
    entries.set(id, entry);
    entry.users += 1;
    try {
      const url = await entry.promise;
      let released = false;
      return {
        url,
        release() {
          if (released) return;
          released = true;
          entry.users -= 1;
          prune();
        }
      };
    } catch (error) {
      entry.users -= 1;
      if (entries.get(id) === entry) entries.delete(id);
      throw error;
    }
  }

  function dispose() {
    for (const entry of entries.values()) {
      if (entry.url) revokeUrl(entry.url);
      else entry.promise.then(revokeUrl, () => {});
    }
    entries.clear();
  }

  return {acquire, dispose};
}
