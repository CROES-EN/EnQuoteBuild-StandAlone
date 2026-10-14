import {useEffect, useMemo, useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {Link} from "react-router-dom";
import DOMPurify from "dompurify";
import {sopsApi, subscribe} from "@/features/collab/collabApi";
import {selectRmaSops, suggestedRmaChecklist, buildRmaSubmissionText, manufacturerFormResources, manufacturerMatches} from "@/features/rma/rmaSopGuidance";
import {openManufacturerForm} from "@/features/rma/manufacturerForms";
import {buildMailtoUrl, buildRmaEmail, findManufacturerConfig, rmaEmailText} from "@/features/rma/manufacturerSubmission";
import {listLocalCollection} from "@/api/dataClient";
import ManufacturerFormSetup from "./ManufacturerFormSetup";
import SopRichContent from "@/components/sop/SopRichContent";
import SopFilePreview from "@/components/sop/SopFilePreview";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Textarea} from "@/components/ui/textarea";
import {Label} from "@/components/ui/label";
import {toast} from "sonner";

function hostOf(url) {
  try {return new URL(url).hostname.replace(/^www\./, "");} catch {return url;}
}

function ManufacturerFile({file, source, label = file.name}) {
  const [open, setOpen] = useState(false);
  return <details onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer text-sm">{label}</summary>
    {open && <SopFilePreview file={file} />}
    {source && <p className="text-xs text-muted-foreground">Source: {source}. Use Save copy if the document needs an external editor.</p>}
  </details>;
}

export default function RmaSopAssistant({data, preparation, onChange, onBusyChange}) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [updates, setUpdates] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [customItem, setCustomItem] = useState("");
  const [opening, setOpening] = useState(false);
  const [formError, setFormError] = useState("");
  const [showSetup, setShowSetup] = useState(false);
  const query = useQuery({queryKey: ["rma-sop-library"], queryFn: () => sopsApi.list()});
  const manufacturersQuery = useQuery({queryKey: ["pvManufacturers"], queryFn: () => listLocalCollection("pvManufacturers")});
  const config = useMemo(() => findManufacturerConfig(manufacturersQuery.data || [], data.panel_manufacturer),
    [manufacturersQuery.data, data.panel_manufacturer]);
  const usesEmail = config?.configured && (config.method === "email" || config.method === "both");
  const email = usesEmail ? buildRmaEmail(config, data, preparation) : null;
  useEffect(() => subscribe("sops", "onChanged", items => {
    if (Array.isArray(items)) setUpdates(items);
  }), []);
  const docs = updates || query.data || [];
  const ranked = useMemo(() => selectRmaSops(docs, data.panel_manufacturer), [docs, data.panel_manufacturer]);
  const results = useMemo(() => selectRmaSops(docs, data.panel_manufacturer, search), [docs, data.panel_manufacturer, search]);
  const selected = ranked.find(doc => doc.id === selectedId) || results[0];
  const formFiles = ranked.filter(doc => manufacturerMatches(doc.panel_manufacturer || doc.title, data.panel_manufacturer))
    .flatMap(doc => (doc.files || []).map(file => ({file, doc})));
  const resources = useMemo(() => manufacturerFormResources(docs, data.panel_manufacturer, html => {
    const fragment = DOMPurify.sanitize(html, {RETURN_DOM_FRAGMENT:true});
    return [...fragment.querySelectorAll("a[href]")].map(link => {
      const block = link.closest("tr") || link.closest("li") || link.closest("p") || link.parentElement;
      return {text:block?.textContent || "", links:[{href:link.getAttribute("href"), text:link.textContent.trim()}]};
    });
  }), [docs, data.panel_manufacturer]);
  async function openForm(url) {
    setOpening(true);
    setFormError("");
    try {
      await openManufacturerForm(url);
    } catch (error) {
      setFormError(error.message || "Could not open manufacturer form.");
      toast.error(error.message || "Could not open manufacturer form.");
    } finally {setOpening(false);}
  }
  const suggestions = useMemo(() => {
    if (!selected) return [];
    const fragment = DOMPurify.sanitize(selected.content_html || "", {RETURN_DOM_FRAGMENT: true});
    return suggestedRmaChecklist([...fragment.querySelectorAll("li, p, tr")].map(node => node.textContent));
  }, [selected]);
  const checklist = preparation.checklist || {};
  const formUrl = preparation.manufacturer_form_url || "";
  const change = (key, value) => onChange({...preparation, [key]: value});
  const referencedSources = () => [...(preparation.sources || []).filter(source => source.id !== selected.id),
    {id: selected.id, title: selected.title, updated_date: selected.updated_date || ""}];
  function addChecklist() {
    onChange({...preparation, checklist: {...Object.fromEntries(suggestions.map(text => [text, false])), ...checklist},
      sources: referencedSources()});
  }
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard is unavailable. Try again in the desktop app.");
      await navigator.clipboard.writeText(buildRmaSubmissionText(data, preparation, preparation.sources || []));
      toast.success("Submission draft copied. Review it and attach evidence before sending.");
    } catch (error) {toast.error(error.message || "Could not copy the submission draft.");}
  }
  async function copyEmail() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard is unavailable. Try again in the desktop app.");
      await navigator.clipboard.writeText(rmaEmailText(email));
      toast.success("Email copied. Paste it into a new message and attach the evidence files.");
    } catch (error) {toast.error(error.message || "Could not copy the email.");}
  }
  async function openEmail() {
    const {url, truncated} = buildMailtoUrl(email);
    if (truncated) {
      try {await navigator.clipboard?.writeText?.(rmaEmailText(email));} catch {/* the toast below still explains */}
      toast.info("The email was too long for a mail link, so it was shortened. The full text is on your clipboard.");
    }
    window.open(url);
  }
  function useSource() {
    change("sources", referencedSources());
  }
  async function refresh() {
    setRefreshing(true);
    setRefreshError("");
    try {
      await sopsApi.refresh();
      const items = await sopsApi.list();
      setUpdates(items);
    } catch (error) {
      const message = error.message || "Could not refresh SOP guidance.";
      setRefreshError(message);
      toast.error(message);
    } finally {setRefreshing(false);}
  }
  const checklistEntries = Object.entries(checklist);
  const checkedCount = checklistEntries.filter(([, checked]) => checked === true).length;
  const staleSources = (preparation.sources || []).filter(source => {
    const current = docs.find(doc => doc.id === source.id && !doc.deleted);
    return !current || (current.updated_date || "") !== source.updated_date;
  });
  const formLinks = [
    ...(config?.configured && config.method !== "email" && config.formUrl
      ? [{key: "config", label: `Open ${data.panel_manufacturer} claim form`, url: config.formUrl, source: "RMA Wizard Settings"}] : []),
    ...resources.map(resource => ({key: resource.url, label: `Open ${resource.label}`, url: resource.url, source: resource.sourceTitle}))
  ];
  return <section className="space-y-3" aria-label="SOP-guided Panel RMA preparation">
    <div className="space-y-3 rounded-lg border border-border p-4" data-rma-section="forms">
      <div>
        <h3 className="font-semibold">Submit to {data.panel_manufacturer || "the manufacturer"}</h3>
        <p className="text-xs text-muted-foreground">Open the form or email, fill it out, then come back here. Nothing is sent automatically.</p>
      </div>
      {config?.instructions && <p className="whitespace-pre-wrap rounded bg-muted p-2 text-sm" data-rma-config-instructions>{config.instructions}</p>}
      {email && <div className="space-y-2 rounded border border-primary/40 p-3" data-rma-email-submission>
        <p className="text-sm font-medium">{data.panel_manufacturer} accepts RMA requests by email.</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-sm">
          <dt className="text-muted-foreground">To</dt><dd className="break-all">{email.to.join("; ")}</dd>
          {email.cc.length > 0 && <><dt className="text-muted-foreground">Cc</dt><dd className="break-all">{email.cc.join("; ")}</dd></>}
          <dt className="text-muted-foreground">Subject</dt><dd>{email.subject}</dd>
        </dl>
        <details><summary className="cursor-pointer text-sm">Preview email</summary>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{email.body}</pre></details>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={openEmail}>Open in email app</Button>
          <Button type="button" variant="outline" onClick={copyEmail}>Copy email</Button>
        </div>
        <p className="text-xs text-muted-foreground">Attach photos, serial labels and test results in your email app before sending.</p>
      </div>}
      {formLinks.length > 0 && <ul className="space-y-1.5">
        {formLinks.map(link => <li key={link.key} className="flex min-w-0 items-center gap-2">
          <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={opening} onClick={() => openForm(link.url)}>{link.label}</Button>
          <span className="min-w-0 truncate text-xs text-muted-foreground" title={`${link.url}\nSource: ${link.source}`}>{hostOf(link.url)} ? {link.source}</span>
        </li>)}
      </ul>}
      {formFiles.length > 0 && <div className="space-y-1">
        {formFiles.map(({file, doc}) => <ManufacturerFile key={`${doc.id}:${file.fileId || file.name}`}
          file={file} source={doc.title} label={`Open saved form: ${file.name}`} />)}
      </div>}
      {!formLinks.length && !formFiles.length && !email && <p className="text-sm text-muted-foreground">No forms saved for this manufacturer yet. Add one to reuse it on future RMAs.</p>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2 text-sm">
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => setShowSetup(value => !value)}>{showSetup ? "Hide form setup" : "Add manufacturer form"}</Button>
        <details className="min-w-0 flex-1"><summary className="cursor-pointer text-xs text-muted-foreground">Open a one-time form URL</summary>
          <div className="mt-2 flex gap-2">
            <Input aria-label="Manufacturer form URL" value={formUrl} onChange={event => change("manufacturer_form_url", event.target.value)} placeholder="https://manufacturer.example/claim" />
            <Button type="button" variant="outline" disabled={opening || !formUrl.trim()} onClick={() => openForm(formUrl.trim())}>Open manufacturer form in EnQuote</Button>
          </div>
        </details>
      </div>
      {showSetup && <ManufacturerFormSetup key={data.panel_manufacturer} manufacturer={data.panel_manufacturer}
        initialUrl={formUrl} onBusyChange={onBusyChange} onSaved={items => {setUpdates(items);setShowSetup(false);}} />}
      {formError && <p role="alert" className="text-destructive">{formError}</p>}
    </div>

    <details open className="group rounded-lg border border-border" data-rma-section="claim">
      <summary className="cursor-pointer select-none p-4 font-semibold">Claim details</summary>
      <div className="space-y-3 px-4 pb-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[["installation_date", "Installation date"], ["installation_address", "Installation address"], ["installer_details", "Installer details"]].map(([key, label]) =>
            <div key={key} className="space-y-1"><Label htmlFor={`rma-${key}`}>{label}</Label><Input id={`rma-${key}`} value={preparation[key] || ""} onChange={event => change(key, event.target.value)} /></div>)}
        </div>
        <div className="space-y-1">
          <Label htmlFor="rma-diagnosis">Problem, diagnosis and test results</Label>
          <Textarea id="rma-diagnosis" rows={3} value={preparation.diagnosis || ""} onChange={event => change("diagnosis", event.target.value)} placeholder="Describe the issue and record the tests requested by the manufacturer SOP." />
        </div>
      </div>
    </details>

    <details open={checklistEntries.length > 0 || undefined} className="rounded-lg border border-border" data-rma-section="checklist">
      <summary className="cursor-pointer select-none p-4 font-semibold">
        Checklist {checklistEntries.length > 0 && <span className="text-sm font-normal text-muted-foreground">({checkedCount} of {checklistEntries.length} done)</span>}
      </summary>
      <div className="space-y-2 px-4 pb-4">
        {!checklistEntries.length && <p className="text-xs text-muted-foreground">Add the suggested checklist from an SOP below, or add your own items.</p>}
        {checklistEntries.map(([text, checked]) => <div key={text} className="flex items-start gap-2 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={checked === true} onChange={event => change("checklist", {...checklist, [text]: event.target.checked})} />
            <span>{text}</span>
          </label>
          <button type="button" className="ml-auto shrink-0 text-xs text-muted-foreground underline" onClick={() => change("checklist", Object.fromEntries(Object.entries(checklist).filter(([key]) => key !== text)))}>Remove</button>
        </div>)}
        <div className="flex gap-2">
          <Input aria-label="Additional RMA checklist item" value={customItem} onChange={event => setCustomItem(event.target.value)}
            placeholder="Add a requirement from an attached form or SOP..." />
          <Button type="button" variant="outline" disabled={!customItem.trim()} onClick={() => {
            const text = customItem.trim();
            change("checklist", {...checklist, [text]: checklist[text] === true});
            setCustomItem("");
          }}>Add item</Button>
        </div>
      </div>
    </details>

    <details className="rounded-lg border border-border" data-rma-section="sop">
      <summary className="cursor-pointer select-none p-4 font-semibold">
        SOP reference {(preparation.sources || []).length > 0 && <span className="text-sm font-normal text-muted-foreground">({preparation.sources.length} referenced)</span>}
      </summary>
      <div className="space-y-2 px-4 pb-4">
        <p className="text-xs text-muted-foreground">Suggested checklist items are not a warranty eligibility decision. Attachments are not automatically interpreted.</p>
        {query.isLoading && !updates ? <p role="status">Loading SOP guidance...</p> : query.isError && !updates ?
          <div role="alert">{query.error.message}<Button type="button" variant="outline" onClick={() => query.refetch()}>Retry SOPs</Button></div> : <>
          <div className="flex gap-2">
            <Input aria-label="Search Panel RMA SOPs" placeholder="Search all panel/module SOPs..." value={search} onChange={event => {setSearch(event.target.value); setSelectedId("");}} />
            <Button type="button" variant="outline" className="shrink-0" disabled={refreshing} onClick={refresh}>{refreshing ? "Refreshing SOPs..." : "Refresh SOP guidance"}</Button>
          </div>
          <select aria-label="Panel RMA SOP page" className="w-full rounded border border-border bg-background p-2 text-sm"
            value={selected?.id || ""} onChange={event => setSelectedId(event.target.value)}>
            {!results.length && <option value="">No matching SOP pages</option>}
            {results.map(doc => <option key={doc.id} value={doc.id}>{doc.title}</option>)}
          </select>
          {selected && <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Updated {selected.updated_date ? String(selected.updated_date).slice(0, 10) : "unknown"} ? <Link className="text-primary underline" to={`/SOPLibrary?doc=${encodeURIComponent(selected.id)}`} target="_blank" rel="noopener noreferrer">Open original SOP</Link></p>
            <details><summary className="cursor-pointer text-sm">Read instructions and attached forms</summary>
              <div className="max-h-80 overflow-auto py-2"><SopRichContent html={selected.content_html || ""} />
                {(selected.files || []).map(file => <ManufacturerFile key={file.fileId || file.name} file={file} />)}
              </div>
            </details>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={useSource}>Use this SOP as a reference</Button>
              <Button type="button" variant="outline" size="sm" disabled={!suggestions.length} onClick={addChecklist}>Add suggested checklist</Button>
            </div>
          </div>}
          {!ranked.length && <p className="text-sm">No panel/module SOPs are available in the cached library. Open SOP Library to sync or add the relevant instructions.</p>}
        </>}
      </div>
    </details>
    {refreshError && <p role="alert" className="text-destructive">{refreshError}</p>}
    {(preparation.sources || []).length > 0 && <div className="space-y-1">
      {preparation.sources.map(source => <p key={source.id} className="flex items-center gap-1 text-xs">
        <span className="truncate">Referenced: {source.title}</span>
        {staleSources.includes(source) && <span className="text-destructive"> ? Source changed or unavailable; review it again.</span>}
        <Button type="button" variant="ghost" size="sm" className="ml-auto h-6 px-2 text-xs" onClick={() => change("sources", preparation.sources.filter(item => item.id !== source.id))}>Remove reference</Button>
      </p>)}
    </div>}

    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
      <Button type="button" variant="outline" onClick={copy}>Copy submission draft</Button>
      <details className="min-w-0 flex-1"><summary className="cursor-pointer text-sm">Preview submission draft</summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs">{buildRmaSubmissionText(data, preparation, preparation.sources || [])}</pre>
      </details>
      <p className="w-full text-xs text-muted-foreground">Copying does not save, attach files, send email, or submit a claim. Save the RMA on the last step to share these details.</p>
    </div>
  </section>;
}
