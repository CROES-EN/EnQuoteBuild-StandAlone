import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { FolderOpen, FolderCog } from "lucide-react";
import { toast } from "sonner";
import { useUserRole } from "@/components/auth/RoleGuard";
import { getAutoImportSettings, saveAutoImportSettings } from "@/features/supervisorDashboard/autoImportSettings";

/**
 * Settings panel replacing the old "Daily Metrics Import" tab (see ConsolidatedReportsPanel.jsx) -
 * lets a supervisor turn zero-click auto-import on/off and choose which local folder to watch,
 * per their own signed-in account (see autoImportSettings.js - settings are keyed by
 * user.email, so each person using this EnQuote installation gets their own independent
 * folder/toggle).
 *
 * Per explicit request, the watched folder starts BLANK for every user (no default/inherited
 * path) - a user must explicitly choose a folder before auto-import can be turned on.
 *
 * The first time a folder is chosen, this offers to create "Calls" and "Emails" subfolders
 * inside it (see handleCreateSubfolders) - EODB Dashboard files auto-sort into Calls\, Pronto
 * Metrics Dashboard files auto-sort into Emails\, replacing the old, less specific
 * "Processed"/"Needs Review" folders. Declining just uses the chosen folder as-is, without
 * creating anything - this prompt only ever asks once per folder choice, tracked via
 * `subfoldersCreated` on the saved settings record.
 */
export default function AutoImportSettingsPanel() {
  const { user } = useUserRole();
  const userEmail = user?.email || null;

  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSubfolderPrompt, setShowSubfolderPrompt] = useState(false);
  const [pendingFolderPath, setPendingFolderPath] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!userEmail) {
        setLoading(false);
        return;
      }
      const loaded = await getAutoImportSettings(userEmail);
      if (!cancelled) {
        setSettings(loaded);
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [userEmail]);

  async function persist(partialSettings) {
    if (!userEmail) return;
    setSaving(true);
    try {
      const updated = await saveAutoImportSettings(userEmail, partialSettings);
      setSettings(updated);
    } catch (err) {
      toast.error(err?.message || "Could not save auto-import settings.");
    }
    setSaving(false);
  }

  async function handleToggle(nextEnabled) {
    if (nextEnabled && !settings?.watchFolderPath) {
      toast.warning("Choose a folder to watch before turning auto-import on.");
      return;
    }
    await persist({ enabled: nextEnabled });
    toast.success(nextEnabled ? "Auto-import turned on." : "Auto-import turned off.");
  }

  async function handleChooseFolder() {
    const bridge = globalThis.window?.enquoteLocal?.dialogs;
    if (!bridge?.selectFolder) {
      toast.error("Folder selection is only available in the EnQuote desktop app.");
      return;
    }
    const picked = await bridge.selectFolder();
    if (!picked?.ok) {
      toast.error(picked?.error || "Could not open the folder picker.");
      return;
    }
    if (picked.canceled || !picked.path) return;

    await persist({ watchFolderPath: picked.path });

    // Only prompt to create Calls/Emails subfolders once per folder choice - if this exact
    // folder previously had them created (or the prompt was already answered either way),
    // don't ask again every time the user revisits this page. ALSO skip the prompt if the
    // chosen folder already has BOTH subfolders present (e.g. re-selecting a folder that
    // was already set up before, or after a settings reset lost the subfoldersCreated
    // flag) - detected via a real filesystem check rather than assumed, so the prompt only
    // ever appears when at least one of the two subfolders is genuinely missing.
    if (!settings?.subfoldersCreated) {
      const bridge = globalThis.window?.enquoteLocal?.dialogs;
      const [callsCheck, emailsCheck] = await Promise.all([
        bridge?.checkFolderExists?.(`${picked.path}\\Calls`),
        bridge?.checkFolderExists?.(`${picked.path}\\Emails`)
      ]);
      const bothAlreadyExist = Boolean(callsCheck?.exists && emailsCheck?.exists);

      if (bothAlreadyExist) {
        await persist({ subfoldersCreated: true });
      } else {
        setPendingFolderPath(picked.path);
        setShowSubfolderPrompt(true);
      }
    }
  }

  async function handleCreateSubfolders() {
    const bridge = globalThis.window?.enquoteLocal?.dialogs;
    if (!bridge?.createFolder || !pendingFolderPath) {
      setShowSubfolderPrompt(false);
      return;
    }
    try {
      await bridge.createFolder(`${pendingFolderPath}\\Calls`);
      await bridge.createFolder(`${pendingFolderPath}\\Emails`);
      await persist({ subfoldersCreated: true });
      toast.success("Created Calls and Emails folders.");
    } catch (err) {
      toast.error(err?.message || "Could not create the Calls/Emails folders.");
    }
    setShowSubfolderPrompt(false);
    setPendingFolderPath(null);
  }

  async function handleSkipSubfolders() {
    // Recorded as "answered" either way, so this prompt does not reappear every time the
    // user revisits Settings without changing their chosen folder again.
    await persist({ subfoldersCreated: true });
    setShowSubfolderPrompt(false);
    setPendingFolderPath(null);
  }

  if (loading) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Loading settings...</p>;
  }

  if (!userEmail) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Sign in to configure auto-import.</p>;
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Auto-Import</CardTitle>
          <p className="text-xs text-muted-foreground">
            Automatically detect and import known report files (EODB Dashboard, Pronto Metrics Dashboard)
            dropped into a folder you choose - no manual "Import" click needed. Off by default; this
            setting is specific to your own signed-in account.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-border bg-secondary p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Enable Auto-Import</p>
              <p className="text-xs text-muted-foreground">
                {settings?.enabled ? "Currently on" : "Currently off"}
              </p>
            </div>
            <Switch checked={Boolean(settings?.enabled)} disabled={saving} onCheckedChange={handleToggle} />
          </div>

          <div className="rounded-lg border border-border bg-secondary p-3">
            <p className="text-sm font-medium text-foreground">Watched Folder</p>
            <p className="mt-1 break-all text-xs text-muted-foreground">
              {settings?.watchFolderPath || "No folder chosen yet"}
            </p>
            <Button size="sm" variant="outline" className="mt-2" disabled={saving} onClick={handleChooseFolder}>
              <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
              {settings?.watchFolderPath ? "Change Folder" : "Choose Folder"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={showSubfolderPrompt} onOpenChange={setShowSubfolderPrompt}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <FolderCog className="h-4 w-4" />
              Create Calls &amp; Emails folders?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Would you like to create "Calls" and "Emails" subfolders here to store these files after
              they're auto-imported? EODB Dashboard files go into Calls, and Pronto Metrics Dashboard
              files go into Emails.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleSkipSubfolders}>Not Now</AlertDialogCancel>
            <AlertDialogAction onClick={handleCreateSubfolders}>Create Folders</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}