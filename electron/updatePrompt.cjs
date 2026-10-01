function createUpdatePrompt({ showDialog, downloadUpdate, installUpdate, sendStatus, logger = console }) {
  let promptedVersion = null;
  let installAfterDownload = false;
  let promptOpen = false;

  async function offer(version) {
    const targetVersion = typeof version === "string" ? version.trim() : "";
    if (!targetVersion || promptOpen || targetVersion === promptedVersion) return "ignored";

    promptedVersion = targetVersion;
    promptOpen = true;
    let response;
    try {
      response = await showDialog(targetVersion);
    } catch (error) {
      promptedVersion = null;
      logger.error("[updater] Could not show update prompt:", error.message);
      return "failed";
    } finally {
      promptOpen = false;
    }

    if (response !== 0) {
      sendStatus("deferred", { version: targetVersion });
      return "deferred";
    }

    installAfterDownload = true;
    sendStatus("downloading", { version: targetVersion, percent: 0 });
    try {
      await downloadUpdate();
      return "downloading";
    } catch (error) {
      installAfterDownload = false;
      promptedVersion = null;
      logger.error("[updater] Could not download update:", error.message);
      sendStatus("error", { message: error.message });
      return "failed";
    }
  }

  function onDownloaded() {
    if (!installAfterDownload) return false;
    installAfterDownload = false;
    installUpdate();
    return true;
  }

  function onError() {
    if (!installAfterDownload) return;
    installAfterDownload = false;
    promptedVersion = null;
  }

  return { offer, onDownloaded, onError };
}

module.exports = { createUpdatePrompt };
