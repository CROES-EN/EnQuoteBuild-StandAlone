import {Link} from "react-router-dom";
import {MousePointer2, X} from "lucide-react";
import {appLinkUrl, validAppLink} from "../../../shared/appLinkRules.js";

export default function AppLinkAttachment({attachment, onRemove}) {
  if (!validAppLink(attachment)) return <span role="alert" className="text-destructive">Invalid EnQuote link.</span>;
  return <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-xs text-foreground">
    <MousePointer2 className="h-3.5 w-3.5 shrink-0" />
    {onRemove ? <span className="truncate">{attachment.label}</span> : (
      <Link to={appLinkUrl(attachment)} className="truncate font-medium underline" title="Open in EnQuote and highlight for 5 seconds">{attachment.label}</Link>
    )}
    {onRemove && <button type="button" aria-label={`Remove shared link ${attachment.label}`} className="shrink-0 rounded p-0.5 hover:bg-muted" onClick={onRemove}><X className="h-3.5 w-3.5" /></button>}
  </span>;
}
