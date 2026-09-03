import { useEffect, useState } from "react";
import { FolderOpen, Inbox } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { isElectronBacked } from "@/features/supervisorDashboard/opsMetricsStore";
import { getReportsInboxPath, openReportsInboxFolder } from "@/features/supervisorDashboard/autoImportWatcher";

/**
 * Points a supervisor at the watched "O&M Reports Inbox" folder - drop a CXONE/NICE, Salesforce,
 * Incorta, Care, or escalations tracker export in there and it's automatically parsed and
 * imported within a few seconds, no "Import Report" button click needed (see
 * electron/main.cjs's watchReportsInbox() and autoImportWatcher.js for the actual mechanism).
 *
 * Desktop-only: folder-watching is impossible from a plain browser tab, so this renders nothing
 * outside the Electron app, matching this feature's existing isElectronBacked() convention.
 */
export default function ReportsInboxCard() {
  const [folderPath, setFolderPath] = useState("");

  useEffect(() => {
    if (!isElectronBacked()) return;
    let cancelled = false;
    Promise.resolve(getReportsInboxPath()).then((path) => {
      if (!cancelled && path) setFolderPath(path);
    });
    return () => { cancelled = true; };
  }, []);

  if (!isElectronBacked()) return null;

  return (
    <Card className="border-indigo-100 bg-indigo-50/50">
      <CardContent className="flex items-start gap-3 p-4">
        <Inbox className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600" />
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-800">Auto-Import Inbox</p>
          <p className="mt-0.5 text-sm text-slate-600">
            Drop a CXONE/NICE, Salesforce, Incorta, Enphase Care, or escalations tracker report export into this
            folder and it's automatically parsed and imported within seconds - no button click needed. Files that
            can't be confidently auto-mapped land in a <span className="font-medium">Needs Review</span> subfolder
            instead, for manual import via "Import Report" above.
          </p>
          {folderPath && <p className="mt-1.5 break-all font-mono text-xs text-slate-500">{folderPath}</p>}
        </div>
        <Button variant="outline" size="sm" onClick={() => openReportsInboxFolder()} className="shrink-0">
          <FolderOpen className="mr-2 h-4 w-4" />
          Open Folder
        </Button>
      </CardContent>
    </Card>
  );
}
