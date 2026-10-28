import {useEffect, useRef} from "react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {customerQuoteFilename, cleanFilenamePart} from "../../../shared/customerQuoteFilename.js";

export default function PrepareSalesforceQuote({open, onClose, quoteState}) {
  const nameInput = useRef(null);
  useEffect(() => {
    if (open) nameInput.current?.focus();
  }, [open]);
  if (!open) return null;
  const {candidate, selectedName, setNameOverride, busy, message} = quoteState;
  const reference = candidate?.quote.quote_number || candidate?.quote.site_id || "";
  const filename = cleanFilenamePart(selectedName) ? customerQuoteFilename(selectedName, reference) : "";
  return (
    <div role="region" aria-label="Prepare Homeowner Quote" className="max-h-[35vh] shrink-0 space-y-2 overflow-y-auto border-b border-border px-3 py-2">
      <p role="status" className="text-xs text-muted-foreground">
        {candidate ? `Case ${candidate.context.caseNumber} - ${candidate.quote.quote_number || "Quote"} - Site ${candidate.context.siteId || candidate.quote.site_id || "not visible"}` : message}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-48 space-y-1">
          <Label htmlFor="attachment-homeowner" className="text-xs">Homeowner name</Label>
          <Input ref={nameInput} id="attachment-homeowner" aria-label="Homeowner name" className="h-8 text-xs md:text-xs"
            value={selectedName} onChange={event => setNameOverride(event.target.value)}
            placeholder="Enter homeowner name" disabled={busy || !candidate} />
        </div>
        <Button size="sm" variant="outline" onClick={() => setNameOverride(null)} disabled={busy || !candidate}>Use detected name</Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Done</Button>
      </div>
      <p title={filename} className="truncate text-xs text-muted-foreground">{filename || "Enter a name, then use Generate Quote in the toolbar."}</p>
    </div>
  );
}
