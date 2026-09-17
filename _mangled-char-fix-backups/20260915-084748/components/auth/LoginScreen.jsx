import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { getUsers } from "@/api/dataClient";
import { KNOWN_ENQUOTE_USERS } from "@/lib/knownEnquoteUsers";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
 Command,
 CommandInput,
 CommandList,
 CommandEmpty,
 CommandGroup,
 CommandItem
} from "@/components/ui/command";
import { Lock, LogIn, ShieldCheck, ChevronsUpDown, KeyRound } from "lucide-react";
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

function CredentialsStep({ onError }) {
 const { login } = useAuth();
 const candidates = useAccountCandidates();
 const [open, setOpen] = useState(false);
 const [selectedEmail, setSelectedEmail] = useState("");
 const [password, setPassword] = useState("");
 const [isSubmitting, setIsSubmitting] = useState(false);

 const selected = candidates.find((candidate) => candidate.email === selectedEmail);

 async function handleSubmit(event) {
 event.preventDefault();
 onError("");
 if (!selectedEmail) {
 onError("Pick your name first.");
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
 <p className="text-muted-foreground mb-6 text-center text-sm">
 New here? Sign in with the temporary password <strong>Enquote1</strong> â€” you'll be asked to set your
 own password right after.
 </p>
 <form onSubmit={handleSubmit} className="space-y-4">
 <div className="space-y-1.5">
 <Label>Your name</Label>
 <Popover open={open} onOpenChange={setOpen}>
 <PopoverTrigger asChild>
 <Button
 type="button"
 variant="outline"
 role="combobox"
 aria-expanded={open}
 className="w-full justify-between font-normal"
 >
 {selected ? `${selected.full_name} (${selected.email})` : "Select your name..."}
 <ChevronsUpDown className="w-4 h-4 opacity-50 shrink-0" />
 </Button>
 </PopoverTrigger>
 <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
 <Command>
 <CommandInput placeholder="Search your name or email..." />
 <CommandList>
 <CommandEmpty>No matching account found.</CommandEmpty>
 <CommandGroup>
 {candidates.map((account) => (
 <CommandItem
 key={account.email}
 value={`${account.full_name} ${account.email}`}
 onSelect={() => {
 setSelectedEmail(account.email);
 setOpen(false);
 }}
 >
 {account.full_name}
 <span className="text-muted-foreground ml-2 text-xs">{account.email}</span>
 </CommandItem>
 ))}
 </CommandGroup>
 </CommandList>
 </Command>
 </PopoverContent>
 </Popover>
 </div>
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

export default function LoginScreen() {
 const { pendingPasswordChange } = useAuth();
 const [error, setError] = useState("");

 return (
 <div className="min-h-screen bg-background flex items-center justify-center p-4 relative">
 <AppVersionBadge />
 <div className="w-full flex flex-col items-center">
 {error && <p className="text-sm text-rose-600 mb-3 max-w-md text-center">{error}</p>}
 {pendingPasswordChange ? (
 <NewPasswordStep onError={setError} />
 ) : (
 <CredentialsStep onError={setError} />
 )}
 </div>
 </div>
 );
}
