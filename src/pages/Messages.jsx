import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Link, useLocation, useNavigate} from "react-router-dom";
import {format, isToday, isYesterday} from "date-fns";
import {
  AlertCircle,
  FileText,
  Image,
  Loader2,
  MessageSquare,
  MoreVertical,
  Paperclip,
  Plus,
  RotateCcw,
  Send,
  Settings,
  Users,
  X
} from "lucide-react";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {Textarea} from "@/components/ui/textarea";
import {Card, CardContent} from "@/components/ui/card";
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Popover, PopoverContent, PopoverTrigger} from "@/components/ui/popover";
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from "@/components/ui/dropdown-menu";
import {cn} from "@/lib/utils";
import {createPageUrl} from "@/utils";
import {chatApi, hasCollabBridge, subscribe} from "@/features/collab/collabApi";
import QuotePicker, {quoteAttachment} from "@/components/collab/QuotePicker";
import ChatAppearancePopover from "@/components/messages/ChatAppearancePopover";
import {displayName, GroupSettingsDialog, NewConversationDialog} from "@/components/messages/ConversationDialogs";
import {UserAvatar} from "@/components/profile/UserAvatar";
import {gifsApi} from "@/features/profiles/profileApi";
import {removeChatMessage as removeChatMessageApi} from "@/features/admin/adminApi";
import {
  onChatAppearanceChanged,
  readableTextColor,
  readChatAppearance
} from "@/features/profiles/chatAppearanceStore";
import {useUserRole} from "@/components/auth/RoleGuard";
import {CaseNumberLink, SiteIdLink} from "@/components/links/ExternalIdLinks";

const PAGE_SIZE = 50;
const MAX_BODY = 4000;
const MAX_ATTACHMENTS = 10;

function formatListTime(value) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return "";
  if (isToday(time)) return format(time, "h:mm a");
  if (isYesterday(time)) return "Yesterday";
  return format(time, "MMM d");
}

function formatMessageTime(value) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return "";
  return isToday(time) ? format(time, "h:mm a") : format(time, "MMM d, h:mm a");
}

function mergeMessages(current, incoming) {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) if (message?.id) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

function conversationTitle(conversation, meEmail, names) {
  if (!conversation) return "";
  if (conversation.kind === "group") return conversation.name || "Group";
  const other = (conversation.members || []).find((member) => member.email !== meEmail);
  return displayName(other?.email || meEmail, names);
}

function AttachmentChip({attachment, onRemove}) {
  const parsedSiteId = attachment.siteId || attachment.sublabel?.match(/\bSite\s+([^·]+?)(?:\s*·|$)/)?.[1]?.trim() || "";
  const parsedCaseNumber = attachment.caseNumber || attachment.sublabel?.match(/\bCase\s+([^·]+?)(?:\s*·|$)/)?.[1]?.trim() || "";
  const linkedSublabel = !onRemove && (parsedSiteId || parsedCaseNumber) ? (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1 opacity-70">
      {parsedSiteId && <>Site <SiteIdLink siteId={parsedSiteId} /></>}
      {parsedSiteId && parsedCaseNumber && <span>·</span>}
      {parsedCaseNumber && <>Case <CaseNumberLink caseNumber={parsedCaseNumber} /></>}
    </span>
  ) : attachment.sublabel ? (
    <span className="truncate opacity-70">{attachment.sublabel}</span>
  ) : null;
  const content = (
    <>
      <FileText className="h-3.5 w-3.5 flex-shrink-0" />
      <span className="truncate font-medium">{attachment.label}</span>
      {linkedSublabel}
    </>
  );
  const className = "inline-flex max-w-full items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs text-indigo-700";
  if (onRemove) {
    return (
      <span className={className}>
        {content}
        <button type="button" onClick={onRemove} aria-label={`Remove ${attachment.label}`} className="ml-1 rounded hover:bg-indigo-100">
          <X className="h-3.5 w-3.5" />
        </button>
      </span>
    );
  }

  return (
    <span className={className}>
      <Link to={createPageUrl(`QuoteDetails?id=${encodeURIComponent(attachment.quoteId)}`)} className="truncate font-medium hover:underline">
        <FileText className="mr-1.5 inline h-3.5 w-3.5" />
        {attachment.label}
      </Link>
      {linkedSublabel}
    </span>
  );
}

function GifAttachment({attachment}) {
  const ratio = attachment.width && attachment.height ? attachment.height / attachment.width : 0.75;
  return (
    <a href={attachment.url} target="_blank" rel="noreferrer" className="block max-w-[260px] overflow-hidden rounded-xl border border-white/20 bg-black/5">
      <img
        src={attachment.url}
        alt={attachment.title || "GIF"}
        loading="lazy"
        className="block w-full object-cover"
        style={{aspectRatio: ratio ? `${attachment.width || 1} / ${attachment.height || Math.round((attachment.width || 1) * ratio)}` : undefined}}
      />
    </a>
  );
}

function GiphyPicker({onPick}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState([]);
  const [nextOffset, setNextOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async ({q = query, offset = 0, append = false} = {}) => {
    setLoading(true);
    setError("");
    try {
      const result = q.trim() ? await gifsApi.search({q: q.trim(), offset}) : await gifsApi.trending({offset});
      setItems((current) => (append ? [...current, ...result.gifs] : result.gifs));
      setNextOffset(result.nextOffset);
    } catch (loadError) {
      setError(loadError.message || "Could not load GIFs.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const timer = setTimeout(() => { void load({q: query, offset: 0, append: false}); }, query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [query, load]);

  return (
    <div className="space-y-3">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search GIPHY"
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-500"
      />
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <div className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto">
        {items.map((gif) => (
          <button key={`${gif.id}-${gif.url}`} type="button" className="overflow-hidden rounded-md bg-muted" onClick={() => onPick(gif)} title={gif.title}>
            <img src={gif.previewUrl || gif.url} alt={gif.title || "GIF"} loading="lazy" className="h-24 w-full object-cover" />
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Powered by GIPHY</span>
        {nextOffset != null && (
          <Button type="button" variant="outline" size="sm" onClick={() => load({offset: nextOffset, append: true})} disabled={loading}>
            {loading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Load more
          </Button>
        )}
      </div>
    </div>
  );
}

export default function MessagesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const {isAdmin, user} = useUserRole();
  const activeId = new URLSearchParams(location.search).get("c");
  const [meEmail, setMeEmail] = useState("");
  const [directory, setDirectory] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [listState, setListState] = useState({loading: true, error: null});
  const [thread, setThread] = useState({id: null, messages: [], hasOlder: false, loading: false, loadingOlder: false});
  const [pending, setPending] = useState([]);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appearance, setAppearance] = useState(() => readChatAppearance());
  const scrollRef = useRef(null);
  const stickToBottom = useRef(true);
  const threadRef = useRef(thread);
  threadRef.current = thread;

  const names = useMemo(() => new Map(directory.map((person) => [person.email, person.name || ""]).filter(([, name]) => name)), [directory]);
  const active = conversations.find((conversation) => conversation.id === activeId) || null;
  const isChatAdmin = isAdmin || ["admin", "super_admin"].includes(String(user?.app_role || user?.role || "").toLowerCase());

  const refreshConversations = useCallback(async () => {
    try {
      const list = await chatApi.conversations();
      setConversations(list);
      setListState({loading: false, error: null});
    } catch (error) {
      setListState({loading: false, error: error.message});
    }
  }, []);

  const loadNewer = useCallback(async () => {
    const current = threadRef.current;
    if (!current.id || current.loading) return;
    const last = current.messages[current.messages.length - 1];
    try {
      let after = last?.createdAt;
      for (let page = 0; page < 5; page += 1) {
        const batch = await chatApi.messages({conversationId: current.id, after, limit: 100});
        if (threadRef.current.id !== current.id) return;
        if (!batch.length) break;
        setThread((state) => (state.id === current.id ? {...state, messages: mergeMessages(state.messages, batch)} : state));
        if (batch.length < 100) break;
        after = batch[batch.length - 1].createdAt;
      }
    } catch {
      // The next change event or poll retries.
    }
  }, []);

  useEffect(() => {
    if (!hasCollabBridge()) return undefined;
    chatApi.me().then((me) => setMeEmail(String(me?.email || "").toLowerCase())).catch(() => {});
    chatApi.directory().then(setDirectory).catch(() => {});
    void refreshConversations();
    let timer = null;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void refreshConversations();
        void loadNewer();
      }, 300);
    };
    const offChanged = subscribe("chat", "onChanged", schedule);
    const offUpdated = subscribe("chat", "onUpdated", schedule);
    return () => {
      clearTimeout(timer);
      offChanged();
      offUpdated();
    };
  }, [refreshConversations, loadNewer]);

  // Opening a conversation loads its newest page; older pages load on demand.
  useEffect(() => {
    if (!activeId) {
      setThread({id: null, messages: [], hasOlder: false, loading: false, loadingOlder: false});
      return undefined;
    }
    let cancelled = false;
    stickToBottom.current = true;
    setThread({id: activeId, messages: [], hasOlder: false, loading: true, loadingOlder: false});
    chatApi.messages({conversationId: activeId, limit: PAGE_SIZE})
      .then((messages) => {
        if (!cancelled) setThread({id: activeId, messages, hasOlder: messages.length === PAGE_SIZE, loading: false, loadingOlder: false});
      })
      .catch((error) => {
        if (cancelled) return;
        toast.error(error.message);
        setThread((state) => ({...state, loading: false}));
      });
    void chatApi.setActiveConversation(activeId);
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  useEffect(() => () => { void chatApi.setActiveConversation(null); }, []);
  useEffect(() => onChatAppearanceChanged(setAppearance), []);

  const loadOlder = async () => {
    const first = thread.messages[0];
    if (!first || thread.loadingOlder) return;
    const conversationId = thread.id;
    const box = scrollRef.current;
    const previousHeight = box?.scrollHeight || 0;
    stickToBottom.current = false;
    setThread((state) => ({...state, loadingOlder: true}));
    try {
      const older = await chatApi.messages({conversationId, before: first.createdAt, limit: PAGE_SIZE});
      if (threadRef.current.id !== conversationId) return;
      setThread((state) => (state.id === conversationId
        ? {...state, messages: mergeMessages(state.messages, older), hasOlder: older.length === PAGE_SIZE, loadingOlder: false}
        : state));
      requestAnimationFrame(() => {
        if (box) box.scrollTop = box.scrollHeight - previousHeight;
      });
    } catch (error) {
      if (threadRef.current.id !== conversationId) return;
      toast.error(error.message);
      setThread((state) => (state.id === conversationId ? {...state, loadingOlder: false} : state));
    }
  };

  const threadPending = useMemo(() => pending.filter((message) => message.conversationId === activeId), [pending, activeId]);
  const shown = useMemo(() => [...thread.messages, ...threadPending], [thread.messages, threadPending]);
  const lastMessage = thread.messages[thread.messages.length - 1];

  useEffect(() => {
    const box = scrollRef.current;
    if (box && stickToBottom.current) box.scrollTop = box.scrollHeight;
  }, [shown.length, activeId, thread.loading]);

  // Mark the conversation read while it is on screen and the window has focus.
  useEffect(() => {
    if (!activeId || !lastMessage?.createdAt) return undefined;
    const markRead = () => {
      if (!document.hasFocus()) return;
      void chatApi.markRead({conversationId: activeId, at: lastMessage.createdAt});
      setConversations((list) => list.map((conversation) => (conversation.id === activeId ? {...conversation, unread: 0} : conversation)));
    };
    markRead();
    window.addEventListener("focus", markRead);
    return () => window.removeEventListener("focus", markRead);
  }, [activeId, lastMessage?.createdAt]);

  const open = (id) => navigate(id ? `/Messages?c=${encodeURIComponent(id)}` : "/Messages", {replace: Boolean(activeId)});

  const deliver = async (message) => {
    setPending((list) => list.map((item) => (item.id === message.id ? {...item, status: "sending"} : item)));
    try {
      const saved = await chatApi.send({
        conversationId: message.conversationId,
        clientId: message.id,
        body: message.body,
        attachments: message.attachments
      });
      setPending((list) => list.filter((item) => item.id !== message.id));
      if (saved) {
        setThread((state) => (state.id === message.conversationId ? {...state, messages: mergeMessages(state.messages, [saved])} : state));
      }
      void refreshConversations();
    } catch (error) {
      setPending((list) => list.map((item) => (item.id === message.id ? {...item, status: "failed", error: error.message} : item)));
    }
  };

  const send = () => {
    const body = draft.trim();
    if (!activeId || (!body && !attachments.length)) return;
    if (body.length > MAX_BODY) {
      toast.error(`Messages can be up to ${MAX_BODY} characters.`);
      return;
    }
    const message = {
      id: crypto.randomUUID(),
      conversationId: activeId,
      sender: meEmail,
      body,
      attachments,
      createdAt: new Date().toISOString(),
      status: "sending"
    };
    stickToBottom.current = true;
    setPending((list) => [...list, message]);
    setDraft("");
    setAttachments([]);
    void deliver(message);
  };

  const addAttachment = (quote) => {
    const attachment = quoteAttachment(quote);
    setAttachments((list) => (list.some((item) => item.quoteId === attachment.quoteId) || list.length >= MAX_ATTACHMENTS ? list : [...list, attachment]));
    setPickerOpen(false);
  };

  const addGif = (gif) => {
    const attachment = {
      type: "gif",
      id: gif.id,
      url: gif.url,
      previewUrl: gif.previewUrl,
      title: gif.title,
      width: gif.width,
      height: gif.height
    };
    setAttachments((list) => (list.length >= MAX_ATTACHMENTS ? list : [...list, attachment]));
    setGifOpen(false);
  };

  const removeMessageAsAdmin = async (messageId) => {
    try {
      let result;
      try {
        result = await removeChatMessageApi(messageId);
      } catch (apiError) {
        const adminBridge = globalThis.window?.enquoteLocal?.admin;
        if (typeof adminBridge?.removeChatMessage !== "function") throw apiError;
        result = await adminBridge.removeChatMessage(messageId);
      }
      if (result?.ok === false) throw new Error(result.error || "Could not remove message.");
      setThread((state) => ({
        ...state,
        messages: state.messages.map((message) => (message.id === messageId ? {...message, body: "[removed by admin]", attachments: []} : message))
      }));
      toast.success("Message removed.");
    } catch (error) {
      toast.error(error.message || "Could not remove message.");
    }
  };

  if (!hasCollabBridge()) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Card><CardContent className="p-10 text-center text-sm text-slate-500">Messages are available in the EnQuote desktop app.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-7xl flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground"><MessageSquare className="h-6 w-6 text-orange-600" />Messages</h1>
          <p className="text-sm text-muted-foreground">Message teammates directly or in groups, and share quotes.</p>
        </div>
        <Button onClick={() => setNewOpen(true)} disabled={Boolean(listState.error)} className="bg-orange-600 text-white hover:bg-orange-700">
          <Plus className="mr-1 h-4 w-4" />New conversation
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[300px_1fr]">
        <Card className="min-h-0 overflow-hidden">
          <CardContent className="h-full overflow-y-auto p-2">
            {listState.loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>
            ) : listState.error ? (
              <div className="space-y-3 p-4 text-center text-sm text-slate-600">
                <AlertCircle className="mx-auto h-6 w-6 text-amber-500" />
                <p>{listState.error}</p>
                <Button size="sm" variant="outline" onClick={() => { setListState({loading: true, error: null}); void refreshConversations(); }}>Try again</Button>
              </div>
            ) : conversations.length === 0 ? (
              <p className="p-6 text-center text-sm text-slate-500">No conversations yet. Start one with "New conversation".</p>
            ) : (
              <ul className="space-y-1">
                {conversations.map((conversation) => (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      onClick={() => open(conversation.id)}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-md px-3 py-2 text-left transition-colors",
                        conversation.id === activeId ? "bg-orange-50" : "hover:bg-slate-50"
                      )}
                    >
                      {conversation.kind === "group" ? (
                        <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500"><Users className="h-4 w-4" /></span>
                      ) : (
                        <UserAvatar
                          email={(conversation.members || []).find((member) => member.email !== meEmail)?.email || meEmail}
                          name={conversationTitle(conversation, meEmail, names)}
                          size={32}
                          className="mt-0.5"
                        />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className={cn("truncate text-sm", conversation.unread > 0 ? "font-semibold text-slate-900" : "font-medium text-slate-700")}>
                            {conversationTitle(conversation, meEmail, names)}
                          </span>
                          <span className="flex-shrink-0 text-[11px] text-slate-400">{formatListTime(conversation.lastMessageAt || conversation.createdAt)}</span>
                        </span>
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-slate-500">
                            {conversation.lastMessagePreview
                              ? `${conversation.lastSender === meEmail ? "You" : displayName(conversation.lastSender, names)}: ${conversation.lastMessagePreview}`
                              : "No messages yet"}
                          </span>
                          {conversation.unread > 0 && (
                            <span className="inline-flex h-5 min-w-[1.25rem] flex-shrink-0 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-semibold text-white">
                              {conversation.unread > 99 ? "99+" : conversation.unread}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="flex min-h-0 flex-col overflow-hidden">
          {!activeId ? (
            <div className="flex flex-1 flex-col items-center justify-center p-10 text-center text-slate-500">
              <MessageSquare className="mb-3 h-10 w-10 text-slate-300" />
              <p className="text-sm">Pick a conversation, or start a new one.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {active?.kind !== "group" && <UserAvatar email={(active?.members || []).find((member) => member.email !== meEmail)?.email || meEmail} name={conversationTitle(active, meEmail, names)} size={32} />}
                    <h2 className="truncate font-semibold text-slate-800">{conversationTitle(active, meEmail, names) || "Conversation"}</h2>
                  </div>
                  {active?.kind === "group" && (
                    <div className="mt-1 flex items-center gap-1 truncate text-xs text-slate-500">
                      {(active.members || []).slice(0, 6).map((member) => <UserAvatar key={member.email} email={member.email} name={displayName(member.email, names)} size={20} />)}
                      <span className="truncate">{(active.members || []).map((member) => displayName(member.email, names)).join(", ")}</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <ChatAppearancePopover appearance={appearance} onChange={setAppearance} />
                  {active?.kind === "group" && (
                    <Button size="sm" variant="ghost" onClick={() => setSettingsOpen(true)}><Settings className="mr-1 h-4 w-4" /> Group</Button>
                  )}
                </div>
              </div>

              <div
                ref={scrollRef}
                className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3"
                style={{backgroundColor: appearance.background}}
                onScroll={(event) => {
                  const box = event.currentTarget;
                  stickToBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
                }}
              >
                {thread.loading ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading messages...</div>
                ) : (
                  <>
                    {thread.hasOlder && (
                      <div className="text-center">
                        <Button size="sm" variant="ghost" onClick={loadOlder} disabled={thread.loadingOlder}>
                          {thread.loadingOlder && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Load older messages
                        </Button>
                      </div>
                    )}
                    {shown.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No messages yet. Say hello!</p>}
                    {shown.map((message, index) => {
                      const mine = message.sender === meEmail;
                      const previous = shown[index - 1];
                      const showSender = !mine && active?.kind === "group" && previous?.sender !== message.sender;
                      const bubbleColor = mine ? appearance.mine : appearance.theirs;
                      const bubbleText = readableTextColor(bubbleColor);
                      const removed = message.body === "[removed by admin]" && (message.attachments || []).length === 0;
                      return (
                        <div key={message.id} className={cn("flex gap-2", mine ? "justify-end" : "justify-start")}>
                          {!mine && <UserAvatar email={message.sender} name={displayName(message.sender, names)} size={28} className={showSender ? "mt-5" : "mt-1 opacity-0"} />}
                          <div className={cn("flex max-w-[75%] flex-col", mine ? "items-end" : "items-start")}>
                            {showSender && <span className="mb-0.5 px-1 text-xs font-medium text-slate-500">{displayName(message.sender, names)}</span>}
                            <div
                              className={cn(
                                "space-y-1.5 rounded-2xl px-3 py-2 text-sm",
                                message.status === "sending" && "opacity-70",
                                message.status === "failed" && "bg-rose-100 text-rose-900"
                              )}
                              style={message.status === "failed" ? undefined : {backgroundColor: bubbleColor, color: bubbleText}}
                            >
                            {message.body && <p className={cn("whitespace-pre-wrap break-words", removed && "italic opacity-70")}>{message.body}</p>}
                            {(message.attachments || []).length > 0 && (
                              <div className="flex flex-col gap-1">
                                {message.attachments.map((attachment, attachmentIndex) => (
                                  attachment.type === "gif"
                                    ? <GifAttachment key={`${attachment.id}-${attachmentIndex}`} attachment={attachment} />
                                    : <AttachmentChip key={attachment.quoteId} attachment={attachment} />
                                ))}
                              </div>
                            )}
                            </div>
                            {isChatAdmin && !message.status && !removed && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button type="button" className="mt-0.5 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Message options">
                                    <MoreVertical className="h-3.5 w-3.5" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align={mine ? "end" : "start"}>
                                  <DropdownMenuItem className="text-rose-600" onClick={() => removeMessageAsAdmin(message.id)}>Remove message (admin)</DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          <span className="mt-0.5 flex items-center gap-2 px-1 text-[11px] text-slate-400">
                            {message.status === "sending" && "Sending..."}
                            {message.status === "failed" && (
                              <>
                                <span className="text-rose-600">Not sent</span>
                                <button type="button" className="inline-flex items-center gap-0.5 font-medium text-indigo-600 hover:underline" onClick={() => deliver(message)}>
                                  <RotateCcw className="h-3 w-3" /> Retry
                                </button>
                                <button type="button" className="font-medium text-slate-500 hover:underline" onClick={() => setPending((list) => list.filter((item) => item.id !== message.id))}>
                                  Discard
                                </button>
                              </>
                            )}
                            {!message.status && formatMessageTime(message.createdAt)}
                          </span>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>

              <div className="space-y-2 border-t border-slate-200 p-3">
                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {attachments.map((attachment, index) => (
                      attachment.type === "gif" ? (
                        <span key={`${attachment.id}-${index}`} className="inline-flex items-center gap-1.5 rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-xs text-orange-700">
                          <Image className="h-3.5 w-3.5" /> GIF
                          <button type="button" onClick={() => setAttachments((list) => list.filter((_, i) => i !== index))} aria-label="Remove GIF" className="rounded hover:bg-orange-100">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ) : (
                        <AttachmentChip
                          key={attachment.quoteId}
                          attachment={attachment}
                          onRemove={() => setAttachments((list) => list.filter((item) => item.quoteId !== attachment.quoteId))}
                        />
                      )
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    aria-label="Attach a quote"
                    title="Attach a quote"
                    onClick={() => setPickerOpen(true)}
                    disabled={attachments.length >= MAX_ATTACHMENTS}
                  >
                    <Paperclip className="h-4 w-4" />
                  </Button>
                  <Popover open={gifOpen} onOpenChange={setGifOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        aria-label="Add a GIF"
                        title="Add a GIF"
                        disabled={attachments.length >= MAX_ATTACHMENTS}
                      >
                        <Image className="h-4 w-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-96">
                      <GiphyPicker onPick={addGif} />
                    </PopoverContent>
                  </Popover>
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    rows={2}
                    maxLength={MAX_BODY}
                    placeholder="Write a message (Enter to send, Shift+Enter for a new line)"
                    className="min-h-[2.5rem] flex-1 resize-none"
                  />
                  <Button onClick={send} disabled={!draft.trim() && !attachments.length} className="bg-orange-600 hover:bg-orange-700" aria-label="Send">
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Attach a quote</DialogTitle>
            <DialogDescription>Recipients can open the quote straight from the message.</DialogDescription>
          </DialogHeader>
          <QuotePicker onPick={addAttachment} excludeIds={attachments.map((item) => item.quoteId)} />
        </DialogContent>
      </Dialog>

      <NewConversationDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        directory={directory}
        names={names}
        meEmail={meEmail}
        onCreated={(conversation) => {
          setConversations((list) => [conversation, ...list.filter((item) => item.id !== conversation.id)]);
          open(conversation.id);
        }}
      />

      <GroupSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        conversation={active}
        directory={directory}
        names={names}
        onUpdated={(conversation) => {
          if (conversation?.id) setConversations((list) => list.map((item) => (item.id === conversation.id ? {...item, ...conversation} : item)));
        }}
        onLeft={(id) => {
          setConversations((list) => list.filter((item) => item.id !== id));
          open(null);
        }}
      />
    </div>
  );
}
