import React, {useCallback, useEffect, useLayoutEffect, useRef, useState} from "react";
import {ChevronsRight, Cloud, FileText, FolderOpen, Mail, Maximize2, Minimize2, RefreshCw} from "lucide-react";
import {toast} from "sonner";
import {useAppPreferences} from "@/hooks/useAppPreferences";
import {writeAppPreferences} from "@/lib/appPreferences";
import PrepareSalesforceQuote from "@/components/quotes/PrepareSalesforceQuote";
import {useSalesforceAutoQuote} from "@/hooks/useSalesforceAutoQuote";

export default function SalesforceLauncher() {
  const preferences = useAppPreferences();
  const [busy, setBusy] = useState(false);
  const [prepareOpen, setPrepareOpen] = useState(false);
  const [copyNotice, setCopyNotice] = useState(0);
  const [workspace, setWorkspace] = useState({visible: false, loading: false, error: null});
  const [width, setWidth] = useState(preferences.salesforcePanelWidth);
  const [expanded, setExpanded] = useState(preferences.salesforcePanelExpanded);
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const content = useRef(null);
  const drag = useRef(null);
  const boundsError = useRef(false);
  const bridge = globalThis.window?.enquoteLocal?.salesforce;
  const available = Boolean(bridge?.openWorkspace);
  const autoQuote = useSalesforceAutoQuote({visible: workspace.visible, loading: workspace.loading});

  useEffect(() => {
    if (!copyNotice) return;
    const timer = setTimeout(() => setCopyNotice(0), 2500);
    return () => clearTimeout(timer);
  }, [copyNotice]);

  useEffect(() => {
    setCopyNotice(0);
  }, [workspace.attachment?.filename, workspace.visible]);

  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const action = useCallback(async (name, bounds) => {
    try {
      const result = await bridge.workspaceAction(name, bounds);
      if (!result?.ok) throw new Error(result?.error || "Could not update the Salesforce panel.");
      return result;
    } catch (error) {
      toast.error(error?.message || "Could not update the Salesforce panel.");
      return null;
    }
  }, [bridge]);

  useEffect(() => {
    setWidth(preferences.salesforcePanelWidth);
    setExpanded(preferences.salesforcePanelExpanded);
  }, [preferences.salesforcePanelWidth, preferences.salesforcePanelExpanded]);

  useEffect(() => {
    if (!workspace.visible) return;
    const onKeyDown = event => {
      if (event.key === "Escape") {
        event.preventDefault();
        action("hide");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [workspace.visible, action]);

  useEffect(() => {
    if (!available || !bridge?.workspaceAction) return;
    let active = true;
    const apply = state => { if (active) setWorkspace(state); };
    const unsubscribe = bridge.onWorkspaceState(apply);
    action("state").then(result => { if (result) apply(result); });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [available, bridge, action]);

  useLayoutEffect(() => {
    if (!available || !bridge?.workspaceAction || !content.current) return;
    let active = true, frame;
    function update() {
      const rect = content.current?.getBoundingClientRect();
      if (!rect) return;
      bridge.workspaceAction("bounds", {x: rect.x, y: rect.y, width: rect.width, height: rect.height})
        .then(result => {
          if (active && !result?.ok && !boundsError.current) {
            boundsError.current = true;
            toast.error(result?.error || "Could not resize the Salesforce panel.");
          }
        }).catch(error => {
          if (active && !boundsError.current) {
            boundsError.current = true;
            toast.error(error?.message || "Could not resize the Salesforce panel.");
          }
        });
    }
    boundsError.current = false;
    const observer = new ResizeObserver(update);
    observer.observe(content.current);
    window.addEventListener("resize", update);
    // Native content must track each frame of the HTML drawer's slide, not just its final size.
    const start = performance.now();
    function animate() {
      update();
      if (performance.now() - start < 240) frame = requestAnimationFrame(animate);
    }
    frame = requestAnimationFrame(animate);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [available, bridge, width, expanded, workspace.visible, workspace.error, prepareOpen]);

  async function toggleWorkspace() {
    setBusy(true);
    try {
      const result = bridge.workspaceAction
        ? await bridge.workspaceAction("toggle")
        : await bridge.openWorkspace();
      if (!result?.ok) throw new Error(result?.error || "Could not open the Salesforce workspace.");
    } catch (error) {
      toast.error(error?.message || "Could not open the Salesforce workspace.");
    } finally {
      setBusy(false);
    }
  }

  function clampWidth(value) {
    const availableWidth = Math.max(0, window.innerWidth - 80);
    return Math.max(Math.min(320, availableWidth), Math.min(1600, availableWidth, value));
  }

  function saveWidth(value) {
    try {
      writeAppPreferences({...preferences, salesforcePanelWidth: value, salesforcePanelExpanded: false});
    } catch (error) {
      toast.error(error?.message || "Could not save the Salesforce panel width.");
    }
  }

  function toggleExpanded() {
    try {
      writeAppPreferences({...preferences, salesforcePanelExpanded: !expanded});
    } catch (error) {
      toast.error(error?.message || "Could not save the Salesforce panel layout.");
    }
  }

  function displayedWidth() {
    return Math.round(content.current?.parentElement?.getBoundingClientRect().width || clampWidth(width));
  }

  async function attachmentAction(name) {
    try {
      const result = await bridge.attachment(name);
      if (!result?.ok) throw new Error(result?.error || "Could not access the prepared PDF.");
      if (name === "copy-email") {
        setCopyNotice(value => value + 1);
        toast.success("Homeowner email copied. Paste into Salesforce, review it, and attach the PDF before sending.");
      }
    } catch (error) {
      toast.error(error?.message || "Could not access the prepared PDF.");
    }
  }

  async function generateQuote() {
    if (autoQuote.needsName) {
      setPrepareOpen(true);
      toast.info("Enter the homeowner name, then click Generate Quote.");
      return;
    }
    try {
      await autoQuote.generate();
      setPrepareOpen(false);
      toast.success("Customer Copy PDF and homeowner email generated. Verify the PDF before attaching.");
    } catch (error) {
      toast.error(error?.message || "Could not generate the quote.");
    }
  }

  if (!available) return null;
  return (
    <>
      {preferences.showSalesforceLauncher && (
        <button type="button" aria-label="Open Salesforce workspace" aria-expanded={Boolean(workspace.visible)}
          title={workspace.visible ? "Tuck away Salesforce" : "Show Salesforce panel"}
          disabled={busy} onClick={toggleWorkspace}
          className="fixed top-28 right-4 z-[70] flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-lg transition hover:bg-accent disabled:opacity-50">
          <Cloud className="h-5 w-5 text-sky-500" />
        </button>
      )}
      {bridge.workspaceAction && (
        <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
        <button type="button" aria-label="Return to EnQuote" tabIndex={-1} data-salesforce-backdrop
          disabled={!workspace.visible} onClick={() => action("hide")}
          className="absolute inset-0 bg-black/60 transition-opacity duration-200"
          style={{opacity: workspace.visible ? 1 : 0, pointerEvents: workspace.visible ? "auto" : "none"}} />
        <section aria-label="Salesforce side panel" aria-hidden={!workspace.visible} data-salesforce-panel
          data-expanded={expanded}
          className="absolute top-2 bottom-2 right-16 flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl transition-transform duration-200 ease-out"
          style={{width: expanded ? "calc(100vw - 96px)" : width, maxWidth: "calc(100vw - 80px)", transform: workspace.visible ? "translateX(0)" : "translateX(calc(100% + 64px))",
            pointerEvents: workspace.visible ? "auto" : "none"}}
          inert={!workspace.visible ? "" : undefined}>
          <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border pl-4 pr-1 text-foreground">
            <Cloud className="h-4 w-4 shrink-0 text-sky-500" />
            <h2 className="text-sm font-semibold">Salesforce</h2>
            {bridge.attachment && <button type="button" onClick={() => setPrepareOpen(value => !value)}
              aria-expanded={prepareOpen} className="shrink-0 rounded border border-border px-2 py-1 text-xs hover:bg-accent">
              Prepare Homeowner Quote
            </button>}
            {autoQuote.candidate && <button type="button" aria-label="Generate Quote" onClick={generateQuote}
              disabled={autoQuote.busy || !autoQuote.canGenerate}
              title={autoQuote.disabledReason || (autoQuote.needsName ? "Enter the homeowner name to generate this quote" : "Generate the matched quote PDF and homeowner email")}
              aria-describedby={!workspace.attachment ? "salesforce-quote-status" : undefined}
              className="shrink-0 rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {autoQuote.busy ? "Generating..." : "Generate Quote"}
            </button>}
            <div className="min-w-0 flex-1">
              {workspace.attachment && <div className="relative flex min-w-0 items-center gap-1">
                <span draggable onDragStart={event => {event.preventDefault(); attachmentAction("drag");}}
                  title={`Drag ${workspace.attachment.filename} into Salesforce's attachment uploader. Verify the attachment before sending.`}
                  aria-label={`Drag PDF: ${workspace.attachment.filename}`}
                  className="inline-flex min-w-0 cursor-grab items-center gap-1 rounded border border-border px-2 py-1 text-xs">
                  <FileText className="h-3 w-3 shrink-0" /><span className="truncate">{workspace.attachment.filename}</span>
                </span>
                <button type="button" onClick={() => attachmentAction("copy-email")} aria-label="Copy homeowner email"
                  disabled={!workspace.attachment.hasEmail} title="Copy a homeowner email explaining this quote"
                  className="shrink-0 rounded p-1 hover:bg-accent disabled:opacity-50">
                  <Mail className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => attachmentAction("reveal")} aria-label="Show prepared PDF in folder"
                  title="Show PDF in folder if Salesforce does not accept drops" className="shrink-0 rounded p-1 hover:bg-accent">
                  <FolderOpen className="h-4 w-4" />
                </button>
                {copyNotice > 0 && <span role="status" aria-label="Email clipboard confirmation"
                  className="pointer-events-none absolute inset-0 flex items-center rounded border border-emerald-500/50 bg-card px-2 text-xs font-medium text-foreground shadow-sm">
                  Copied to clipboard
                </span>}
              </div>}
              {!workspace.attachment && <p id="salesforce-quote-status" role="status" aria-label="Salesforce quote status"
                title={(autoQuote.candidate && autoQuote.disabledReason) || (autoQuote.needsName ? "Homeowner name needed - click Generate Quote to enter it." : autoQuote.message)}
                className="truncate text-xs text-muted-foreground">{(autoQuote.candidate && autoQuote.disabledReason) ||
                  (autoQuote.needsName ? "Homeowner name needed - click Generate Quote to enter it." : autoQuote.message)}</p>}
            </div>
            {workspace.loading && <span role="status" className="text-xs text-muted-foreground">Loading...</span>}
            <button type="button" aria-label="Reload Salesforce" title="Reload Salesforce" onClick={() => action("reload")}
              className="rounded p-2 text-muted-foreground hover:bg-accent hover:text-foreground"><RefreshCw className="h-4 w-4" /></button>
            <button type="button" aria-label={expanded ? "Restore Salesforce panel" : "Expand Salesforce panel"}
              title={expanded ? "Restore narrower view" : "Expand focus view"} onClick={toggleExpanded}
              className="rounded p-2 text-muted-foreground hover:bg-accent hover:text-foreground">
              {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button type="button" aria-label="Tuck away Salesforce" title="Tuck away Salesforce" onClick={() => action("hide")}
              className="rounded p-2 hover:bg-accent"><ChevronsRight className="h-4 w-4" /></button>
          </header>
          <PrepareSalesforceQuote open={prepareOpen} onClose={() => setPrepareOpen(false)} quoteState={autoQuote} />
          {workspace.error && <p role="alert" className="px-5 pb-2 text-sm text-destructive">{workspace.error}</p>}
          <div ref={content} className="mx-2 mb-2 min-h-0 flex-1 bg-white" />
          <div role="separator" aria-label="Resize Salesforce panel" aria-orientation="vertical"
            aria-valuemin={Math.max(0, Math.min(320, viewportWidth - 80))} aria-valuemax={Math.max(0, viewportWidth - 80)}
            aria-valuenow={expanded ? Math.max(0, viewportWidth - 96) : clampWidth(width)} tabIndex={workspace.visible ? 0 : -1}
            className="absolute inset-y-0 left-0 w-2 cursor-col-resize touch-none hover:bg-sky-500/30 focus-visible:bg-sky-500/30"
            onPointerDown={event => {
              if (event.button !== 0) return;
              drag.current = {x: event.clientX, width: displayedWidth()};
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event => {
              if (drag.current) {
                setExpanded(false);
                setWidth(clampWidth(drag.current.width + drag.current.x - event.clientX));
              }
            }}
            onPointerUp={event => {
              if (!drag.current) return;
              const next = clampWidth(drag.current.width + drag.current.x - event.clientX);
              drag.current = null;
              setExpanded(false);
              setWidth(next);
              saveWidth(next);
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => { drag.current = null; }}
            onKeyDown={event => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const next = clampWidth(displayedWidth() + (event.key === "ArrowLeft" ? 40 : -40));
              setExpanded(false);
              setWidth(next);
              saveWidth(next);
            }} />
        </section>
        </div>
      )}
    </>
  );
}
