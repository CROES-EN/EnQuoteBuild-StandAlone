import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Shown exactly ONCE per machine, the first time a non-host teammate signs in and no
// local remote-sync secret has ever been saved (see AuthContext.jsx's
// checkRemoteSyncStatus() and main.cjs's "remoteSync:checkStatus" handler). Once saved,
// this never appears again on that machine -- only the sync URL silently auto-refreshes
// from then on.
export default function RemoteSyncSecretDialog({ open, syncUrl, onSaved }) {
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSave = async () => {
    if (!secret.trim()) {
      setError("Please enter the shared secret.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const bridge = globalThis.window?.enquoteLocal?.remoteSync;
      if (!bridge) {
        throw new Error("Remote sync is only available in the desktop app.");
      }
      const result = await bridge.saveSecret(syncUrl, secret.trim());
      if (!result?.ok) {
        throw new Error(result?.error || "Could not save the sync configuration.");
      }
      onSaved?.();
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent className="max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Connect to shared data</DialogTitle>
          <DialogDescription>
            Enter the shared sync secret to see live team data. You'll only need to do
            this once on this computer.
          </DialogDescription>
        </DialogHeader>

        <Input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="Shared secret"
          autoFocus
        />

        <p className="text-xs text-muted-foreground">
          Don't have this code? Reach out to Carsten Roeschberger.
        </p>

        {error && <p className="text-xs text-rose-600">{error}</p>}

        <DialogFooter>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
