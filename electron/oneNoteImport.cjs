const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const {execFile} = require("node:child_process");
const {promisify} = require("node:util");
const {MAX_FILE_BYTES} = require("./sopLibrary.cjs");

const runFile = promisify(execFile);
const MAX_TOTAL_BYTES = 500 * 1024 * 1024;
const SESSION_MS = 30 * 60 * 1000;
const MAX_FILES = 20;
const DEFAULT_WORKBOOK_ID = "workbook-sop-library";

async function exportSection(sourcePath, outputDirectory) {
  const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  try {
    await runFile(powershell, [
      "-NoProfile", "-NonInteractive", "-STA", "-File", path.join(__dirname, "oneNoteExport.ps1"),
      "-SourcePath", sourcePath, "-OutputDirectory", outputDirectory
    ], {windowsHide: true, timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024});
  } catch (error) {
    throw new Error(error.stderr?.trim() || "OneNote did not finish exporting. Check that Windows OneNote desktop is installed, open the section there, and retry.");
  }
}

function createOneNoteImport({sops, chooseFile, getEmail = () => "", exportImpl = exportSection, platform = process.platform, onProgress = () => {}, logger = console}) {
  const sessions = new Map();
  let preparing = false;

  async function dispose(session) {
    await fs.rm(session.directory, {recursive: true, force: true});
    clearTimeout(session.timer);
    sessions.delete(session.id);
  }

  function armExpiry(session) {
    clearTimeout(session.timer);
    session.timer = setTimeout(() => {
      if (session.busy) { armExpiry(session); return; }
      void dispose(session).catch((error) => logger.warn("[onenote] Could not remove temporary export:", error.message));
    }, SESSION_MS);
    session.timer.unref?.();
  }

  async function prepare() {
    if (platform !== "win32") throw new Error("Importing .one sections requires the Windows OneNote desktop app.");
    if (preparing) throw new Error("A OneNote section is already being read. Wait for it to finish.");
    preparing = true;
    const prepared = [];
    try {
      const chosen = await chooseFile();
      const sources = [...new Set((Array.isArray(chosen) ? chosen : [chosen]).filter(Boolean))];
      if (sources.length === 0) return {ok: true, cancelled: true};
      if (sources.length > MAX_FILES) throw new Error(`Choose up to ${MAX_FILES} .one files at a time.`);
      for (const source of sources) {
        if (path.extname(source).toLowerCase() !== ".one") throw new Error(`"${path.basename(source)}" is not a OneNote section (.one) file.`);
      }
      for (const [index, source] of sources.entries()) {
        onProgress({stage: "reading", completed: index, total: sources.length, title: path.basename(source)});
        try {
          prepared.push(await prepareSource(source));
        } catch (error) {
          throw new Error(sources.length > 1 ? `${path.basename(source)}: ${error.message}` : error.message);
        }
      }
      return {ok: true, previews: prepared};
    } catch (error) {
      for (const preview of prepared) {
        const session = sessions.get(preview.sessionId);
        if (session) await dispose(session).catch((cleanupError) => logger.warn("[onenote] Could not remove temporary export:", cleanupError.message));
      }
      throw error;
    } finally {
      preparing = false;
    }
  }

  async function prepareSource(source) {
    let directory;
    try {
      const sourceStat = await fs.stat(source);
      if (!sourceStat.isFile() || sourceStat.size > 250 * 1024 * 1024) throw new Error("Choose a .one section file no larger than 250 MB.");
      directory = await fs.mkdtemp(path.join(os.tmpdir(), "enquote-onenote-"));
      await exportImpl(source, directory);
      const manifestPath = path.join(directory, "manifest.json");
      if ((await fs.stat(manifestPath)).size > 50 * 1024 * 1024) throw new Error("The exported section is too large. Split it into smaller sections.");
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      if (!Array.isArray(manifest.pages) || manifest.pages.length > 500) throw new Error("OneNote returned an invalid page list.");
      let totalBytes = 0;
      const ancestors = [];
      const pages = [];
      for (const [index, page] of manifest.pages.entries()) {
        if (!page || typeof page.title !== "string" || typeof page.html !== "string" || page.pdf !== `page-${index}.pdf`) {
          throw new Error("OneNote returned invalid page content.");
        }
        if (page.title.length > 200 || page.html.length > 900_000) throw new Error(`"${page.title.slice(0, 100)}" exceeds the SOP title/content limit. Shorten or split it in OneNote before importing.`);
        const pdfPath = path.join(directory, page.pdf);
        const pdfSize = (await fs.stat(pdfPath)).size;
        const file = await fs.open(pdfPath, "r");
        const header = Buffer.alloc(5);
        try { await file.read(header, 0, 5, 0); } finally { await file.close(); }
        if (header.toString() !== "%PDF-") throw new Error(`OneNote did not create a valid PDF for "${page.title}".`);
        if (pdfSize > MAX_FILE_BYTES) throw new Error(`The PDF for "${page.title}" is larger than 20 MB. Split that page in OneNote before importing.`);
        totalBytes += pdfSize;
        if (totalBytes > MAX_TOTAL_BYTES) throw new Error("PDF snapshots exceed 500 MB. Split the section before importing.");
        const level = Number(page.level);
        if (!Number.isInteger(level) || level < 1 || level > 10 || level > ancestors.length + 1) throw new Error(`OneNote returned an invalid nesting level for "${page.title}".`);
        const record = {
          id: `onenote-page-${crypto.randomUUID()}`,
          title: page.title || "Untitled page",
          content_html: page.html,
          parent_id: level > 1 ? ancestors[level - 2] : null,
          depth: level - 1,
          pdfPath,
          pdfSize,
          warnings: Array.isArray(page.warnings) ? page.warnings.filter((warning) => typeof warning === "string") : [],
          saved: false,
          file: null
        };
        ancestors.length = level;
        ancestors[level - 1] = record.id;
        pages.push(record);
      }
      const title = String(manifest.title || path.basename(source, ".one")).trim();
      if (!title || title.length > 200) throw new Error("The section name must be between 1 and 200 characters.");
      const session = {id: crypto.randomUUID(), directory, title, sectionId: `section-onenote-${crypto.randomUUID()}`, pages, busy: false, destinationChosen: false, sectionSaved: false, email: getEmail()};
      armExpiry(session);
      sessions.set(session.id, session);
      return {
        ok: true,
        sessionId: session.id,
        title,
        totalBytes,
        pages: pages.map((page) => ({id: page.id, title: page.title, depth: page.depth, pdfSize: page.pdfSize, warnings: page.warnings})),
        warnings: [
          "Imported pages are shared with everyone who can access the SOP Library.",
          "This is a one-time copy, not a live OneNote sync. Each page includes editable text/tables and an original PDF snapshot.",
          "Embedded attachments, audio/video and OneNote tags are not extracted. Their contents are not preserved by a PDF; retain the original .one file.",
          "OneNote may leave the selected file open under Recent Opened Sections."
        ]
      };
    } catch (error) {
      if (directory) await fs.rm(directory, {recursive: true, force: true});
      throw error;
    }
  }

  async function importSection({sessionId, sectionId = null}) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error("This import preview expired. Choose the .one file again.");
    if (session.email !== getEmail()) throw new Error("Your signed-in account changed. Cancel this preview and choose the .one file again.");
    if (session.busy) throw new Error("This section is already being imported.");
    const destinationSection = sectionId ? sops.list().find((record) => !record.deleted && record.kind === "section" && record.id === sectionId) : null;
    if (sectionId && !destinationSection) throw new Error("Choose an available destination section.");
    if (session.destinationChosen && session.destinationSectionId !== sectionId) throw new Error("A partial import must be retried in the same section.");
    session.busy = true;
    session.destinationChosen = true;
    session.destinationSectionId = sectionId;
    const targetSectionId = sectionId || session.sectionId;
    let imported = session.pages.filter((page) => page.saved).length;
    try {
      onProgress({sessionId, completed: imported, total: session.pages.length, title: sectionId ? "Creating parent page" : "Creating section"});
      if (!session.sectionSaved) {
        if (sectionId && !session.parentPageId) session.parentPageId = `onenote-parent-${crypto.randomUUID()}`;
        const result = await sops.save(sectionId ? {
          id: session.parentPageId, title: session.title, section_id: sectionId, parent_id: null,
          order: Math.max(-1, ...sops.list().filter((record) => !record.deleted && record.section_id === sectionId && !record.parent_id).map((record) => Number(record.order) || 0)) + 1,
          category: destinationSection.title, content_html: "", files: [], import_source: "onenote-export"
        } : {
          id: session.sectionId, kind: "section", title: session.title, workbook_id: DEFAULT_WORKBOOK_ID,
          order: sops.list().filter((record) => !record.deleted && record.kind === "section").length,
          import_source: "onenote-export"
        });
        if (result.ok === false) throw new Error(sectionId ? "The imported parent page could not be saved." : "The imported section could not be saved.");
        session.sectionSaved = true;
      }
      const siblingOrders = new Map();
      for (const page of session.pages) {
        if (session.email !== getEmail()) throw new Error("Your signed-in account changed. Import stopped.");
        const order = siblingOrders.get(page.parent_id) || 0;
        siblingOrders.set(page.parent_id, order + 1);
        if (page.saved) continue;
        onProgress({sessionId, completed: imported, total: session.pages.length, title: page.title});
        if (!page.file) {
          const uploaded = await sops.uploadFile({
            name: `${page.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 180)} - OneNote.pdf`,
            type: "application/pdf", bytes: new Uint8Array(await fs.readFile(page.pdfPath))
          });
          if (!uploaded?.file?.fileId) throw new Error(`Could not upload the PDF snapshot for "${page.title}".`);
          page.file = uploaded.file;
        }
        const result = await sops.save({
          id: page.id, title: page.title, section_id: targetSectionId, parent_id: page.parent_id || session.parentPageId || null, order,
          category: destinationSection?.title || session.title, content_html: page.content_html, files: [page.file],
          import_source: "onenote-export", import_warnings: page.warnings
        });
        if (result.ok === false) throw new Error(`Could not save "${page.title}".`);
        page.saved = true;
        imported++;
      }
      onProgress({sessionId, completed: imported, total: session.pages.length, title: ""});
      const result = {ok: true, sectionId: targetSectionId, parentPageId: session.parentPageId || null, imported};
      await dispose(session);
      return result;
    } catch (error) {
      throw new Error(`Imported ${imported} of ${session.pages.length} pages. ${error.message} Retry this preview to continue without duplicating pages, or keep the partial import and cancel.`);
    } finally {
      session.busy = false;
      if (sessions.has(session.id)) armExpiry(session);
    }
  }

  async function cancel(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return {ok: true};
    if (session.busy) throw new Error("Wait for the current import to finish before closing it.");
    await dispose(session);
    return {ok: true};
  }

  return {prepare, importSection, cancel};
}

module.exports = {createOneNoteImport};
