import {useEffect, useMemo, useRef, useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {useAuth} from "@/lib/AuthContext";
import {getUsers} from "@/api/dataClient";
import {KNOWN_ENQUOTE_USERS} from "@/lib/knownEnquoteUsers";
import {Card} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {ChevronDown, KeyRound, Lock, LogIn, ShieldCheck} from "lucide-react";
import appPackage from "../../../package.json";

const appVersion = appPackage?.version || "0.0.0";

function AppVersionBadge() {
 return (
 <div className="fixed bottom-4 left-4 z-10 rounded-md border border-border bg-card/90 px-2.5 py-1 text-[10px] font-medium tracking-wide text-muted-foreground shadow-sm backdrop-blur-sm">
 v{appVersion}
 </div>
 );
}

// Merges the live, synced Base44 user list with the static fallback roster so the account
// picker always has something to show (even on a brand-new install that hasn't synced yet),
// while always preferring the live record (correct id/display name) for any email in both.
function useAccountCandidates() {
 const { data: liveUsers = [] } = useQuery({
 queryKey: ["login-known-users"],
 queryFn: getUsers,
 staleTime: 60000
 });

 return useMemo(() => {
 const merged = new Map();
 (liveUsers || []).forEach((candidate) => {
 if (!candidate?.email) return;
 merged.set(candidate.email.toLowerCase(), {
 email: candidate.email,
 full_name: candidate.display_name || candidate.full_name || candidate.email
 });
 });
 KNOWN_ENQUOTE_USERS.forEach((candidate) => {
 const key = candidate.email.toLowerCase();
 if (!merged.has(key)) {
 merged.set(key, { email: candidate.email, full_name: candidate.name });
 }
 });
 return Array.from(merged.values()).sort((a, b) => a.full_name.localeCompare(b.full_name));
 }, [liveUsers]);
}

/**
 * Plain, ordinary <Input> with a custom, simple suggestions list rendered directly below it -
 * no Popover, no cmdk, no nested focus-trap components at all (fixes a confirmed real bug
 * where the previous Popover+Command combo did not reliably accept typed keystrokes). Typing
 * filters the list live; clicking any suggestion fills the field and selects that account.
 *
 * FIX (per explicit follow-up request - "names don't fit in the box, so it doesn't
 * overhang"): once a suggestion is picked, the input now shows ONLY the person's name (not
 * "Name (email@address.com)" as before) - the email is still shown underneath each option in
 * the suggestions list itself, just not appended to the box after selection, since that's what
 * was causing long name+email combinations to overflow the input's width. A `truncate` class
 * is also applied as a safety net for any name still long enough to need it, so text is
 * cleanly cut off with an ellipsis rather than visually overflowing the box.
 */
function NameField({ candidates, selectedEmail, onSelect }) {
 const selected = candidates.find((c) => c.email === selectedEmail);
 const [query, setQuery] = useState(selected ? selected.full_name : "");
 const [open, setOpen] = useState(false);
 const containerRef = useRef(null);

 const filtered = useMemo(() => {
 const term = query.trim().toLowerCase();
 if (!term) return candidates;
 return candidates.filter(
 (c) => c.full_name.toLowerCase().includes(term) || c.email.toLowerCase().includes(term)
 );
 }, [candidates, query]);

 // Close the suggestions list on any click outside this field - standard dropdown dismissal.
 useEffect(() => {
 function handleClickOutside(e) {
 if (containerRef.current && !containerRef.current.contains(e.target)) {
 setOpen(false);
 }
 }
 document.addEventListener("mousedown", handleClickOutside);
 return () => document.removeEventListener("mousedown", handleClickOutside);
 }, []);

 function handleInputChange(e) {
 const value = e.target.value;
 setQuery(value);
 setOpen(true);
 // If the typed text exactly matches a known account's email, treat that as a valid
 // selection even without clicking the suggestion - lets someone who knows their own
 // email just type the whole thing and hit Sign In directly.
 const exactMatch = candidates.find((c) => c.email.toLowerCase() === value.trim().toLowerCase());
 onSelect(exactMatch ? exactMatch.email : "");
 }

 function handleSelectSuggestion(account) {
 setQuery(account.full_name);
 onSelect(account.email);
 setOpen(false);
 }

 return (
 <div className="space-y-1.5" ref={containerRef}>
 <Label htmlFor="login-name">Your name</Label>
 <div className="relative">
 <Input
 id="login-name"
 type="text"
 autoComplete="off"
 placeholder="Type your name or email..."
 value={query}
 onChange={handleInputChange}
 onFocus={() => setOpen(true)}
 title={query}
 className="truncate pr-8"
 />
 <button
 type="button"
 tabIndex={-1}
 onClick={() => setOpen((prev) => !prev)}
 className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
 aria-label="Toggle suggestions"
 >
 <ChevronDown className="h-4 w-4" />
 </button>
 {open && (
 <div className="absolute left-0 right-0 z-20 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
 {filtered.length > 0 ? (
 filtered.map((account) => (
 <button
 key={account.email}
 type="button"
 onClick={() => handleSelectSuggestion(account)}
 className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-accent"
 >
 <span className="font-medium text-foreground">{account.full_name}</span>
 <span className="text-xs text-muted-foreground">{account.email}</span>
 </button>
 ))
 ) : (
 <p className="px-3 py-2 text-xs text-muted-foreground">No matching account found.</p>
 )}
 </div>
 )}
 </div>
 </div>
 );
}

function CredentialsStep({ onError }) {
 const { login } = useAuth();
 const candidates = useAccountCandidates();
 const [selectedEmail, setSelectedEmail] = useState("");
 const [password, setPassword] = useState("");
 const [isSubmitting, setIsSubmitting] = useState(false);

 async function handleSubmit(event) {
 event.preventDefault();
 onError("");
 if (!selectedEmail) {
 onError("Pick your name from the list, or type your exact email address.");
 return;
 }

 setIsSubmitting(true);
 try {
 await login(selectedEmail, password);
 } catch (error) {
 onError(error?.message || "Sign in failed.");
 } finally {
 setIsSubmitting(false);
 setPassword("");
 }
 }

 return (
 <Card className="max-w-md w-full p-8">
 <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-indigo-100 flex items-center justify-center">
 <Lock className="w-8 h-8 text-indigo-600" />
 </div>
 <h2 className="text-2xl font-bold text-foreground mb-2 text-center">Sign in to EnQuote</h2>
 {/* FIX (per explicit request): removed the em dash after "Enquote1" - now two plain,
     complete sentences instead of one run-on sentence joined by a dash. */}
 <p className="text-muted-foreground mb-6 text-center text-sm">
 New here? Sign in with the temporary password your admin gave you. You'll be asked to set your own password right after.
 </p>
 <form onSubmit={handleSubmit} className="space-y-4">
 <NameField candidates={candidates} selectedEmail={selectedEmail} onSelect={setSelectedEmail} />
 <div className="space-y-1.5">
 <Label htmlFor="login-password">Password</Label>
 <Input
 id="login-password"
 type="password"
 value={password}
 onChange={(event) => setPassword(event.target.value)}
 required
 />
 </div>
 <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700" disabled={isSubmitting}>
 {isSubmitting ? "Signing in..." : (
 <>
 <LogIn className="w-4 h-4 mr-2" />
 Sign In
 </>
 )}
 </Button>
 </form>
 <p className="text-xs text-muted-foreground mt-6 text-center flex items-center justify-center gap-1">
 <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
 Your password is stored securely on this PC.
 </p>
 </Card>
 );
}

// First-time-only setup screen: shown ONLY when a Cloudflare-verified email has NO
// existing EnQuote account yet (needsAccountCreation). Once this succeeds, the account
// exists permanently - any LATER "forgot password" situation goes through the existing,
// unchanged admin-driven resetUserPassword flow (NewPasswordStep below), never this one
// again for that email.
function CreateAccountStep({ onError }) {
  const { verifiedEmail, createAccount } = useAuth();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    onError("");
    if (newPassword.length < 4) {
      onError("Choose a password with at least 4 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      onError("Passwords don't match.");
      return;
    }

    setIsSubmitting(true);
    try {
      await createAccount(newPassword);
    } catch (error) {
      onError(error?.message || "Could not create your account.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card className="max-w-md w-full p-8">
      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-100 flex items-center justify-center">
        <ShieldCheck className="w-8 h-8 text-emerald-600" />
      </div>
      <h2 className="text-2xl font-bold text-foreground mb-2 text-center">Welcome to EnQuote</h2>
      <p className="text-muted-foreground mb-6 text-center text-sm">
        Signed in as <strong>{verifiedEmail}</strong>. Choose a password to finish setting up your account.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="create-password">Password</Label>
          <Input
            id="create-password"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoFocus
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="create-confirm-password">Confirm password</Label>
          <Input
            id="create-confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
        </div>
        <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700" disabled={isSubmitting}>
          {isSubmitting ? "Creating account..." : "Create Account"}
        </Button>
      </form>
    </Card>
  );
}

function NewPasswordStep({ onError }) {
 const { pendingPasswordChange, completePasswordChange } = useAuth();
 const [newPassword, setNewPassword] = useState("");
 const [confirmPassword, setConfirmPassword] = useState("");
 const [isSubmitting, setIsSubmitting] = useState(false);

 async function handleSubmit(event) {
 event.preventDefault();
 onError("");
 if (newPassword.length < 4) {
 onError("Choose a password with at least 4 characters.");
 return;
 }
 if (newPassword !== confirmPassword) {
 onError("Passwords don't match.");
 return;
 }

 setIsSubmitting(true);
 try {
 await completePasswordChange(newPassword);
 } catch (error) {
 onError(error?.message || "Could not set your new password.");
 } finally {
 setIsSubmitting(false);
 }
 }

 return (
 <Card className="max-w-md w-full p-8">
 <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-100 flex items-center justify-center">
 <KeyRound className="w-8 h-8 text-amber-600" />
 </div>
 <h2 className="text-2xl font-bold text-foreground mb-2 text-center">Set your password</h2>
 <p className="text-muted-foreground mb-6 text-center text-sm">
 Signed in as <strong>{pendingPasswordChange.email}</strong>. Choose a new password to replace the
 temporary one.
 </p>
 <form onSubmit={handleSubmit} className="space-y-4">
 <div className="space-y-1.5">
 <Label htmlFor="new-password">New password</Label>
 <Input
 id="new-password"
 type="password"
 value={newPassword}
 onChange={(event) => setNewPassword(event.target.value)}
 autoFocus
 required
 />
 </div>
 <div className="space-y-1.5">
 <Label htmlFor="confirm-password">Confirm new password</Label>
 <Input
 id="confirm-password"
 type="password"
 value={confirmPassword}
 onChange={(event) => setConfirmPassword(event.target.value)}
 required
 />
 </div>
 <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700" disabled={isSubmitting}>
 {isSubmitting ? "Saving..." : "Save Password"}
 </Button>
 </form>
 </Card>
 );
}

/**
 * FIX (per explicit request - "make the incorrect password error look nicer, not so 'code
 * looking'"): errors are now cleaned up at the SOURCE (AuthContext.jsx's login()/
 * completePasswordChange() strip Electron's raw IPC wrapper text before ever throwing), so
 * this display component needs no special-case parsing - it already receives a plain, human
 * message like "Incorrect password." and just needs to present it more gently than a stark
 * top-of-page red line. Restyled as a small inline banner with an icon, matching the visual
 * language already used elsewhere in this app (e.g. RowDetailsDialog's rejection-reason
 * banners) instead of looking like a raw thrown exception.
 */
function ErrorBanner({ message }) {
 if (!message) return null;
 return (
 <div className="mb-4 flex w-full max-w-md items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
 <svg className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
 <path fillRule="evenodd" d="M18 10A8 8 0 1 1 2 10a8 8 0 0 1 16 0Zm-7-4a1 1 0 1 0-2 0v4a1 1 0 1 0 2 0V6Zm-1 8a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z" clipRule="evenodd" />
 </svg>
 <span>{message}</span>
 </div>
 );
}

export default function LoginScreen() {
 const { pendingPasswordChange, needsAccountCreation } = useAuth();
 const [error, setError] = useState("");

 return (
 <div className="min-h-screen bg-background flex items-center justify-center p-4 relative">
 <AppVersionBadge />
 <div className="w-full flex flex-col items-center">
 <ErrorBanner message={error} />
 {needsAccountCreation ? (
 <CreateAccountStep onError={setError} />
 ) : pendingPasswordChange ? (
 <NewPasswordStep onError={setError} />
 ) : (
 <CredentialsStep onError={setError} />
 )}
 </div>
 </div>
 );
}
