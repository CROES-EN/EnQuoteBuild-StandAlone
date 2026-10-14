import {useEffect, useMemo, useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {Link} from "react-router-dom";
import DOMPurify from "dompurify";
import {sopsApi, subscribe} from "@/features/collab/collabApi";
import {selectRmaSops, suggestedRmaChecklist, buildRmaSubmissionText, manufacturerFormResources, manufacturerMatches} from "@/features/rma/rmaSopGuidance";
import {openManufacturerForm} from "@/features/rma/manufacturerForms";
import ManufacturerFormSetup from "./ManufacturerFormSetup";
import SopRichContent from "@/components/sop/SopRichContent";
import SopFilePreview from "@/components/sop/SopFilePreview";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Textarea} from "@/components/ui/textarea";
import {Label} from "@/components/ui/label";
import {toast} from "sonner";

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
  return <section className="space-y-3 rounded-lg border border-border p-4" aria-label="SOP-guided Panel RMA preparation">
    <h3 className="font-semibold">SOP-guided submission preparation</h3>
    <div className="space-y-2 rounded border border-border p-3">
      <h4 className="font-semibold">{data.panel_manufacturer || "Manufacturer"} forms and portals</h4>
      <p className="text-xs text-muted-foreground">Open your form, fill it out, then return here. Saved manufacturer forms and SOP links are listed below. No case data is sent automatically.</p>
      {resources.map(resource => <div key={resource.url} className="text-sm">
        <Button type="button" variant="outline" disabled={opening} onClick={() => openForm(resource.url)}>Open {resource.label}</Button>
        <p className="break-all text-xs text-muted-foreground">{resource.url} · Source: {resource.sourceTitle}</p>
      </div>)}
      {formFiles.map(({file, doc}) => <ManufacturerFile key={`${doc.id}:${file.fileId || file.name}`}
        file={file} source={doc.title} label={`Open saved form: ${file.name}`} />)}
      {!resources.length && !formFiles.length && <p className="text-sm">No forms configured for this manufacturer yet. Add one below to reuse it on future RMAs.</p>}
      <Button type="button" variant="outline" onClick={() => setShowSetup(value => !value)}>{showSetup ? "Hide form setup" : "Add manufacturer form"}</Button>
      {showSetup && <ManufacturerFormSetup key={data.panel_manufacturer} manufacturer={data.panel_manufacturer}
        initialUrl={formUrl} onBusyChange={onBusyChange} onSaved={items => {setUpdates(items);setShowSetup(false);}} />}
      <details><summary className="cursor-pointer text-sm">Open a one-time form URL</summary>
      <Input aria-label="Manufacturer form URL" value={formUrl} onChange={event => change("manufacturer_form_url", event.target.value)} placeholder="https://manufacturer.example/claim" />
      <Button type="button" variant="outline" disabled={opening || !formUrl.trim()} onClick={() => openForm(formUrl.trim())}>Open manufacturer form in EnQuote</Button>
      </details>
      {formError && <p role="alert" className="text-destructive">{formError}</p>}
    </div>
    <Button type="button" variant="outline" disabled={refreshing} onClick={refresh}>{refreshing ? "Refreshing SOPs..." : "Refresh SOP guidance"}</Button>
    {refreshError && <p role="alert" className="text-destructive">{refreshError}</p>}
    <p className="text-xs text-muted-foreground">Review the original instructions for your manufacturer. Suggested checklist items are not a warranty eligibility decision. PDFs, images and other attachments are available below; their contents are not automatically interpreted.</p>
    {query.isLoading && !updates ? <p role="status">Loading SOP guidance...</p> : query.isError && !updates ?
      <div role="alert">{query.error.message}<Button type="button" variant="outline" onClick={() => query.refetch()}>Retry SOPs</Button></div> : <>
      <Input aria-label="Search Panel RMA SOPs" placeholder="Search all panel/module SOPs..." value={search} onChange={event => {setSearch(event.target.value); setSelectedId("");}} />
      <select aria-label="Panel RMA SOP page" className="w-full rounded border border-border bg-background p-2 text-sm"
        value={selected?.id || ""} onChange={event => setSelectedId(event.target.value)}>
        {!results.length && <option value="">No matching SOP pages</option>}
        {results.map(doc => <option key={doc.id} value={doc.id}>{doc.title}</option>)}
      </select>
      {selected && <div className="space-y-2">
        <p className="text-xs text-muted-foreground">Source: {selected.title} · Updated {selected.updated_date || "unknown"}</p>
        <Link className="text-sm text-primary underline" to={`/SOPLibrary?doc=${encodeURIComponent(selected.id)}`} target="_blank" rel="noopener noreferrer">Open original SOP</Link>
        <details><summary className="cursor-pointer text-sm">Read instructions and attached forms</summary>
          <div className="max-h-80 overflow-auto py-2"><SopRichContent html={selected.content_html || ""} />
            {(selected.files || []).map(file => <ManufacturerFile key={file.fileId || file.name} file={file} />)}
          </div>
        </details>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={useSource}>Use this SOP as a reference</Button>
          <Button type="button" variant="outline" disabled={!suggestions.length} onClick={addChecklist}>Add suggested checklist</Button>
        </div>
      </div>}
      {!ranked.length && <p>No panel/module SOPs are available in the cached library. Open SOP Library to sync or add the relevant instructions.</p>}
    </>}
    {(preparation.sources || []).map(source => {
      const current = docs.find(doc => doc.id === source.id && !doc.deleted);
      return <p key={source.id} className="text-xs">Referenced: {source.title}
        {(!current || (current.updated_date || "") !== source.updated_date) && <span className="text-destructive"> — Source changed or unavailable; review it again.</span>}
        <Button type="button" variant="ghost" size="sm" onClick={() => change("sources", preparation.sources.filter(item => item.id !== source.id))}>Remove reference</Button>
      </p>;
    })}
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {[["installation_date", "Installation date"], ["installation_address", "Installation address"], ["installer_details", "Installer details"]].map(([key, label]) =>
        <div key={key}><Label htmlFor={`rma-${key}`}>{label}</Label><Input id={`rma-${key}`} value={preparation[key] || ""} onChange={event => change(key, event.target.value)} /></div>)}
    </div>
    <Label htmlFor="rma-diagnosis">Problem, diagnosis and test results</Label>
    <Textarea id="rma-diagnosis" value={preparation.diagnosis || ""} onChange={event => change("diagnosis", event.target.value)} placeholder="Describe the issue and record the tests requested by the manufacturer SOP." />
    {Object.entries(checklist).map(([text, checked]) => <div key={text} className="flex items-start gap-2 text-sm">
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={checked === true} onChange={event => change("checklist", {...checklist, [text]: event.target.checked})} />
        <span>{text}</span>
      </label>
      <button type="button" className="ml-auto text-xs underline" onClick={() => change("checklist", Object.fromEntries(Object.entries(checklist).filter(([key]) => key !== text)))}>Remove</button>
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
    <details><summary className="cursor-pointer text-sm">Preview submission draft</summary>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{buildRmaSubmissionText(data, preparation, preparation.sources || [])}</pre>
    </details>
    <Button type="button" variant="outline" onClick={copy}>Copy submission draft</Button>
    <p className="text-xs text-muted-foreground">Save the RMA to keep these preparation details shared. Copying does not save, attach files, send email, or submit a manufacturer claim.</p>
  </section>;
}
