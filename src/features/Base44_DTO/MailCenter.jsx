import React, {useCallback, useEffect, useMemo, useState} from "react";
import {Archive, Inbox, Mail, MailOpen, RefreshCw, Send, ShieldAlert, Star, Trash2} from "lucide-react";
import {useAuth} from "@/lib/AuthContext";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Textarea} from "@/components/ui/textarea";
import {scopedKey} from "@/lib/userScopedStorage";
import {retroMailApi} from "./mailApi";
import "./MailCenter.css";

const DRAFTS_KEY = "enquote_retro_mail_drafts_v1";
const FOLDERS = [
  {id: "home", label: "Mail Center", icon: Mail},
  {id: "inbox", label: "Inbox", icon: Inbox},
  {id: "drafts", label: "Drafts", icon: MailOpen},
  {id: "saved", label: "Saved", icon: Star},
  {id: "junk", label: "Junk", icon: ShieldAlert},
  {id: "trash", label: "Trash", icon: Trash2},
  {id: "sent", label: "Sent", icon: Send},
  {id: "contacts", label: "Address Book", icon: Archive}
];
const EMPTY_COUNTS = {inbox: 0, sent: 0, saved: 0, junk: 0, trash: 0, unread: 0};

function readDrafts() {
  try {
    const value = JSON.parse(localStorage.getItem(scopedKey(DRAFTS_KEY)) || "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((draft) => draft && typeof draft.id === "string" &&
      typeof draft.to === "string" && typeof draft.subject === "string" && typeof draft.body === "string").slice(0, 50);
  } catch (error) {
    console.warn("[retro-mail] Could not restore local drafts:", error.message);
    return [];
  }
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(undefined, {dateStyle: "medium", timeStyle: "short"});
}

function draftPreview(draft) {
  return draft.subject || draft.body.trim().replace(/\s+/g, " ").slice(0, 80) || "No subject";
}

function themeColors(css) {
  const declarations = String(css || "").match(/:root\s*\{([^}]*)\}/i)?.[1] || "";
  const readColor = (names) => {
    for (const name of names) {
      const value = declarations.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, "i"))?.[1]?.trim();
      if (value && typeof CSS !== "undefined" && CSS.supports("color", value)) return value;
    }
    return "";
  };
  return {
    accent: readColor(["--lighter-blue", "--borders", "--accent"]),
    border: readColor(["--borders", "--lighter-blue"])
  };
}

export default function MailCenter({initialRecipient = "", appearance = "classic", themeCode = ""}) {
  const {user} = useAuth();
  const me = String(user?.email || "").toLowerCase();
  const [folder, setFolder] = useState("home");
  const [messages, setMessages] = useState([]);
  const [counts, setCounts] = useState(EMPTY_COUNTS);
  const [contacts, setContacts] = useState([]);
  const [drafts, setDrafts] = useState(readDrafts);
  const [selectedId, setSelectedId] = useState("");
  const [compose, setCompose] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  const selected = messages.find((message) => message.id === selectedId) || null;
  const visibleMessages = folder === "home" ? messages.slice(0, 5) : messages;

  const loadFolder = useCallback(async (currentFolder, current = () => true) => {
    setLoading(true);
    setError("");
    try {
      if (currentFolder === "contacts") {
        const result = await retroMailApi.contacts();
        if (current()) setContacts(result.contacts || []);
      } else {
        const result = await retroMailApi.list(currentFolder === "home" ? "inbox" : currentFolder);
        if (!current()) return;
        setMessages(result.messages || []);
        setCounts(result.counts || EMPTY_COUNTS);
      }
    } catch (loadError) {
      if (current()) setError(loadError.message || "Could not load this folder.");
    } finally {
      if (current()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void loadFolder(folder, () => active);
    return () => { active = false; };
  }, [folder, refreshVersion, loadFolder]);

  useEffect(() => {
    const unsubscribe = retroMailApi.onChanged(() => setRefreshVersion((value) => value + 1));
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!initialRecipient) return;
    setFolder("inbox");
    setCompose({id: crypto.randomUUID(), to: initialRecipient, subject: "", body: ""});
  }, [initialRecipient]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try { localStorage.setItem(scopedKey(DRAFTS_KEY), JSON.stringify(drafts.slice(0, 50))); }
      catch (saveError) { setError(`Could not save drafts on this PC: ${saveError.message}`); }
    }, 500);
    return () => clearTimeout(timer);
  }, [drafts]);

  useEffect(() => {
    if (!compose) return undefined;
    const timer = setTimeout(() => {
      setDrafts((current) => {
        const saved = {...compose, updatedAt: new Date().toISOString()};
        const exists = current.some((draft) => draft.id === compose.id);
        return exists ? current.map((draft) => draft.id === compose.id ? saved : draft) : [saved, ...current].slice(0, 50);
      });
    }, 700);
    return () => clearTimeout(timer);
  }, [compose]);

  const saveDraft = (value) => {
    if (!value) return;
    setDrafts((current) => {
      const saved = {...value, updatedAt: new Date().toISOString()};
      const exists = current.some((draft) => draft.id === value.id);
      return exists ? current.map((draft) => draft.id === value.id ? saved : draft) : [saved, ...current].slice(0, 50);
    });
  };

  const openFolder = (nextFolder) => {
    saveDraft(compose);
    setFolder(nextFolder);
    setCompose(null);
    setSelectedId("");
  };

  const updateCompose = (field, value) => setCompose((current) => current ? {...current, [field]: value} : current);

  const startCompose = (to = "") => {
    saveDraft(compose);
    setFolder("inbox");
    setSelectedId("");
    setCompose({id: crypto.randomUUID(), to, subject: "", body: ""});
  };

  const editDraft = (draft) => {
    if (compose?.id !== draft.id) saveDraft(compose);
    setFolder("drafts");
    setSelectedId("");
    setCompose({...draft});
  };

  const removeDraft = (id) => {
    setDrafts((current) => current.filter((draft) => draft.id !== id));
    if (compose?.id === id) setCompose(null);
  };

  const selectMessage = async (message) => {
    setSelectedId(message.id);
    if (message.recipient === me && !message.readAt) {
      try {
        await retroMailApi.setState({id: message.id, action: "read"});
        setRefreshVersion((value) => value + 1);
      } catch (readError) {
        setError(readError.message || "Could not mark this message as read.");
      }
    }
  };

  const moveSelected = async (nextFolder) => {
    if (!selected) return;
    try {
      await retroMailApi.setState({id: selected.id, folder: nextFolder});
      setSelectedId("");
      setRefreshVersion((value) => value + 1);
    } catch (moveError) {
      setError(moveError.message || "Could not move this message.");
    }
  };

  const deleteSelected = async () => {
    if (!selected) return;
    if (!window.confirm("Permanently delete this message from your Trash?")) return;
    try {
      await retroMailApi.delete(selected.id);
      setSelectedId("");
      setRefreshVersion((value) => value + 1);
    } catch (deleteError) {
      setError(deleteError.message || "Could not permanently delete this message.");
    }
  };

  const sendMessage = async (event) => {
    event.preventDefault();
    if (!compose || sending) return;
    setSending(true);
    setError("");
    try {
      const result = await retroMailApi.send(compose);
      setDrafts((current) => current.filter((draft) => draft.id !== compose.id));
      setCompose(null);
      setFolder("sent");
      setSelectedId(result.message?.id || "");
      setRefreshVersion((value) => value + 1);
    } catch (sendError) {
      setError(sendError.message || "Could not send this message.");
    } finally {
      setSending(false);
    }
  };

  const contactsSeen = useMemo(() => contacts.filter((email) => email !== me), [contacts, me]);
  const theme = appearance === "gothic" ? "gothic" : appearance?.startsWith("imported") ? "imported" : "classic";
  const colors = theme === "imported" ? themeColors(themeCode) : {};
  const themeStyle = {
    ...(colors.accent ? {"--mail-accent": colors.accent} : {}),
    ...(colors.border ? {"--mail-border": colors.border} : {})
  };

  return (
    <section aria-label="Mail Center" className="eq-mail mt-3 font-sans" data-appearance={theme} style={themeStyle}>
      <div className="eq-mail__frame overflow-hidden border shadow-md">
        <header className="eq-mail__titlebar flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex items-center gap-2"><Mail className="h-5 w-5" /><h2 className="font-bold">Mail Center</h2></div>
          <span className="eq-mail__masthead">{user?.full_name || me}</span>
        </header>

        <div className="grid min-h-[560px] grid-cols-1 md:grid-cols-[190px_minmax(280px,1fr)_minmax(280px,1.2fr)]">
          <aside className="eq-mail__sidebar border-b border-[#d6dfeb] bg-[#f9fbfd] p-3 md:border-b-0 md:border-r">
            <Button type="button" className="eq-mail__compose mb-3 w-full bg-[#3158a7] hover:bg-[#23458d]" onClick={() => startCompose()}>
              <Send className="mr-2 h-4 w-4" />Compose
            </Button>
            <div className="mb-2 border-b border-[#d5deea] pb-1 text-xs font-bold uppercase tracking-wide text-[#61758f]">Mail Center</div>
            <div className="space-y-0.5">
              {FOLDERS.map(({id, label, icon: Icon}) => (
                <button key={id} type="button" onClick={() => openFolder(id)}
                  className={`eq-mail__folder flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm ${folder === id ? "is-active bg-[#dceafa] font-semibold text-[#173d7c]" : ""}`}>
                  <span className="flex items-center gap-2"><Icon className="h-4 w-4" />{label}</span>
                  {id === "inbox" && counts.unread > 0 && <span className="rounded-full bg-[#3158a7] px-1.5 text-xs text-white">{counts.unread}</span>}
                  {id === "drafts" && drafts.length > 0 && <span className="text-xs text-[#61758f]">{drafts.length}</span>}
                </button>
              ))}
            </div>
          </aside>

          <section className="eq-mail__list min-w-0 border-b border-[#d6dfeb] md:border-b-0 md:border-r">
            <div className="eq-mail__toolbar flex items-center justify-between border-b border-[#d6dfeb] bg-[#edf3f9] px-3 py-2">
              <h2 className="font-semibold">{FOLDERS.find((item) => item.id === folder)?.label || "Inbox"}</h2>
              <Button type="button" variant="ghost" size="icon" aria-label="Refresh mail" onClick={() => setRefreshVersion((value) => value + 1)} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
            {folder === "home" && (
              <div className="eq-mail__notice border-b border-[#d6dfeb] bg-[#d8eafa] p-3 text-sm">
                <strong>You have {counts.unread} unread {counts.unread === 1 ? "message" : "messages"} in your Inbox.</strong>
                <button type="button" className="ml-1 text-[#244f94] underline" onClick={() => openFolder("inbox")}>Open Inbox</button>
              </div>
            )}
            {folder === "drafts" ? (
              <div className="divide-y divide-[#e3e9f0]">
                {drafts.map((draft) => <div key={draft.id} className="flex items-center gap-1 p-2 hover:bg-[#f5f8fc]">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => editDraft(draft)}>
                    <strong className="block truncate text-sm">{draft.to || "No recipient"}</strong>
                    <span className="block truncate text-xs text-[#61758f]">{draftPreview(draft)}</span>
                  </button>
                  <Button type="button" size="icon" variant="ghost" aria-label="Delete draft" onClick={() => removeDraft(draft.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>)}
                {!drafts.length && <p className="p-4 text-sm text-[#61758f]">No saved drafts.</p>}
              </div>
            ) : folder === "contacts" ? (
              <div className="divide-y divide-[#e3e9f0]">
                {contactsSeen.map((email) => <button key={email} type="button" className="block w-full p-3 text-left text-sm hover:bg-[#f5f8fc]" onClick={() => startCompose(email)}>{email}</button>)}
                {!contactsSeen.length && <p className="p-4 text-sm text-[#61758f]">Contacts appear here after you send or receive mail.</p>}
              </div>
            ) : (
              <div className="divide-y divide-[#e3e9f0]">
                {visibleMessages.map((message) => {
                  const other = message.sender === me ? message.recipient : message.sender;
                  const unread = message.recipient === me && !message.readAt;
                  return <button key={message.id} type="button" onClick={() => void selectMessage(message)}
                    className={`block w-full px-3 py-2 text-left hover:bg-[#f5f8fc] ${selectedId === message.id ? "bg-[#edf4fc]" : ""}`}>
                    <span className={`block truncate text-sm ${unread ? "font-bold" : ""}`}>{other}</span>
                    <span className={`block truncate text-sm ${unread ? "font-semibold" : ""}`}>{message.subject || "(No subject)"}</span>
                    <span className="block truncate text-xs text-[#718097]">{message.body}</span>
                    <time className="mt-1 block text-[10px] text-[#8290a3]">{formatDate(message.createdAt)}</time>
                  </button>;
                })}
                {!loading && !visibleMessages.length && folder !== "home" && <p className="p-4 text-sm text-[#61758f]">This folder is empty.</p>}
                {folder === "home" && <button type="button" className="block w-full p-3 text-left text-sm text-[#244f94] hover:bg-[#f5f8fc]" onClick={() => openFolder("sent")}>Sent mail: {counts.sent}</button>}
              </div>
            )}
          </section>

          <section className="eq-mail__reader min-w-0">
            {error && <div role="alert" className="eq-mail__error m-3 border border-red-300 bg-red-50 p-2 text-sm text-red-800">{error}</div>}
            {compose ? (
              <form onSubmit={sendMessage} className="space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">New message</h2>
                  <Button type="button" variant="ghost" size="icon" aria-label="Save and close draft" onClick={() => { saveDraft(compose); setCompose(null); }}><MailOpen className="h-4 w-4" /></Button>
                </div>
                <label className="block space-y-1 text-sm"><span>To</span><Input required type="email" maxLength={254} value={compose.to} onChange={(event) => updateCompose("to", event.target.value)} placeholder="teammate@enphaseenergy.com" /></label>
                <label className="block space-y-1 text-sm"><span>Subject</span><Input required maxLength={160} value={compose.subject} onChange={(event) => updateCompose("subject", event.target.value)} /></label>
                <label className="block space-y-1 text-sm"><span>Message</span><Textarea required maxLength={10000} rows={12} value={compose.body} onChange={(event) => updateCompose("body", event.target.value)} /></label>
                <p className="text-xs text-[#718097]">Drafts stay on this PC until you send them.</p>
                <Button type="submit" disabled={sending || !compose.to.trim() || !compose.subject.trim() || !compose.body.trim()} className="bg-[#3158a7] hover:bg-[#23458d]">
                  <Send className="mr-2 h-4 w-4" />{sending ? "Sending..." : "Send"}
                </Button>
              </form>
            ) : selected ? (
              <article className="p-4">
                <div className="mb-3 flex flex-wrap justify-end gap-1 border-b border-[#d6dfeb] pb-2">
                  {selected.sender !== me && <Button type="button" size="sm" variant="outline" onClick={() => startCompose(selected.sender)}>Reply</Button>}
                  {folder !== "trash" && <Button type="button" size="sm" variant="outline" aria-label="Save message" onClick={() => void moveSelected("saved")}><Star className="mr-1 h-4 w-4" />Save</Button>}
                  {folder !== "junk" && folder !== "sent" && <Button type="button" size="sm" variant="outline" onClick={() => void moveSelected("junk")}><ShieldAlert className="mr-1 h-4 w-4" />Junk</Button>}
                  {folder !== "trash" && <Button type="button" size="sm" variant="outline" onClick={() => void moveSelected("trash")}><Trash2 className="mr-1 h-4 w-4" />Trash</Button>}
                  {folder === "trash" && <Button type="button" size="sm" variant="destructive" onClick={() => void deleteSelected()}>Delete permanently</Button>}
                  {(folder === "saved" || folder === "junk" || folder === "trash") && <Button type="button" size="sm" variant="outline" onClick={() => void moveSelected("inbox")}><Archive className="mr-1 h-4 w-4" />Move to Inbox</Button>}
                </div>
                <h2 className="break-words text-xl font-semibold">{selected.subject || "(No subject)"}</h2>
                <dl className="my-3 space-y-1 border-b border-[#d6dfeb] pb-3 text-xs text-[#61758f]">
                  <div><dt className="inline font-semibold">From: </dt><dd className="inline">{selected.sender}</dd></div>
                  <div><dt className="inline font-semibold">To: </dt><dd className="inline">{selected.recipient}</dd></div>
                  <div><dt className="inline font-semibold">Date: </dt><dd className="inline">{formatDate(selected.createdAt)}</dd></div>
                </dl>
                <p className="whitespace-pre-wrap break-words text-sm leading-6">{selected.body}</p>
              </article>
            ) : (
              <div className="flex min-h-[300px] items-center justify-center p-8 text-center text-sm text-[#718097]">
                {folder === "home" ? <div><h2 className="mb-2 text-xl font-semibold text-[#3158a7]">Mail Center</h2><p>Select a folder, open a message, or compose a new one.</p></div> : <p>Select a message to read it.</p>}
              </div>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
