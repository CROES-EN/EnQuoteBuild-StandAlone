// AdminPasswordReset.jsx
//
// STANDALONE component - NOT a patch. I have not seen your actual
// DeveloperConsole.jsx, so instead of guessing at its structure (risky), this
// is a self-contained piece you import and render wherever your user list
// lives. You will need to adjust:
//   - The Dialog/Button/Input import paths below to match your actual UI
//     library location (this assumes the common shadcn/ui-style setup:
//     "@/components/ui/dialog", "@/components/ui/button", etc. - adjust if
//     your project's paths differ).
//   - How `users` and `currentUserEmail` are supplied (props here, but wire
//     them to however DeveloperConsole already knows the local user list
//     and the signed-in user's email).
//
// SECURITY NOTE: this component does its own "is admin" check purely to
// decide whether to RENDER the button (a UX nicety - don't show a button
// that will just fail). The REAL enforcement already happens inside
// repository.cjs's resetUserPassword(), which re-checks app_role === "admin"
// itself and will reject the call even if this component's check were
// somehow bypassed. Never remove that server-side check to "simplify" this.

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

/**
 * Renders a "Reset Password" button for a single user row. Only actually
 * shows anything if `isCurrentUserAdmin` is true - otherwise renders null,
 * so non-admins never see this control exist at all.
 *
 * @param {string} targetEmail - the email of the user whose password to reset
 * @param {string} targetName - display name, for the confirmation dialog text
 * @param {string} currentUserEmail - the signed-in admin's own email (passed
 *   through to repository.resetUserPassword as the acting admin)
 * @param {boolean} isCurrentUserAdmin - whether the signed-in user has
 *   app_role === "admin" in your already-synced local user data
 */
export function AdminResetPasswordButton({
  targetEmail,
  targetName,
  currentUserEmail,
  isCurrentUserAdmin,
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [tempPassword, setTempPassword] = useState(null);
  const [copied, setCopied] = useState(false);

  if (!isCurrentUserAdmin) return null;

  async function handleConfirmReset() {
    setIsResetting(true);
    setErrorMessage("");
    try {
      const bridge = globalThis.window?.enquoteLocal?.auth;
      if (!bridge?.resetUserPassword) {
        throw new Error("Password reset is only available in the desktop app.");
      }
      const result = await bridge.resetUserPassword(currentUserEmail, targetEmail);
      setTempPassword(result.tempPassword);
      setConfirmOpen(false);
      setResultOpen(true);
    } catch (error) {
      setErrorMessage(error?.message || "Could not reset this user's password.");
    } finally {
      setIsResetting(false);
    }
  }

  function handleCopy() {
    if (!tempPassword) return;
    navigator.clipboard?.writeText(tempPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleCloseResult() {
    // Clears the temp password from memory once the dialog closes - it is
    // never persisted anywhere, and this is the only place it was ever held.
    setResultOpen(false);
    setTempPassword(null);
    setCopied(false);
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
        Reset Password
      </Button>

      {/* Step 1: confirmation */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password for {targetName || targetEmail}?</DialogTitle>
            <DialogDescription>
              They will be signed out and required to set a new password the
              next time they log in. Their current password will stop
              working immediately.
            </DialogDescription>
          </DialogHeader>
          {errorMessage && (
            <p className="text-sm text-rose-600">{errorMessage}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={isResetting}>
              Cancel
            </Button>
            <Button onClick={handleConfirmReset} disabled={isResetting}>
              {isResetting ? "Resetting..." : "Reset Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Step 2: show the generated password exactly once */}
      <Dialog open={resultOpen} onOpenChange={(open) => { if (!open) handleCloseResult(); }}>
        <DialogContent onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>New temporary password</DialogTitle>
            <DialogDescription>
              Share this with {targetName || targetEmail} directly (Teams, phone,
              in person) - not email. It will not be shown again after you
              close this window.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-md border border-border bg-secondary px-3 py-2 font-mono text-sm">
            <span className="flex-1 select-all">{tempPassword}</span>
            <Button variant="outline" size="sm" onClick={handleCopy}>
              {copied ? "Copied!" : "Copy"}
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={handleCloseResult}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Example integration inside DeveloperConsole.jsx (adjust to match your real
// user-list rendering code - this is illustrative, not a literal patch):
//
//   import { AdminResetPasswordButton } from "./AdminPasswordReset.jsx";
//
//   {users.map((user) => (
//     <div key={user.email} className="flex items-center justify-between ...">
//       <span>{user.name} ({user.email})</span>
//       <AdminResetPasswordButton
//         targetEmail={user.email}
//         targetName={user.name}
//         currentUserEmail={currentUser.email}
//         isCurrentUserAdmin={currentUser.app_role === "admin"}
//       />
//     </div>
//   ))}
// ---------------------------------------------------------------------------
