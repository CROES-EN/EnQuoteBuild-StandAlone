import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Link, useLocation, useNavigate} from "react-router-dom";
import {format, isToday} from "date-fns";
import {
  AlertCircle,
  FileText,
  Image,
  Loader2,
  MessageSquare,
  MousePointer2,
  Smile,
  Paperclip,
  Plus,
  RotateCcw,
  Send,
  Settings,
  X
} from "lucide-react";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {Textarea} from "@/components/ui/textarea";
import {Card, CardContent} from "@/components/ui/card";
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Popover, PopoverContent, PopoverTrigger} from "@/components/ui/popover";
import {cn} from "@/lib/utils";
import {createPageUrl} from "@/utils";
import {chatApi, hasCollabBridge, registerActiveChatView, subscribe} from "@/features/collab/collabApi";
import QuotePicker, {quoteAttachment} from "@/components/collab/QuotePicker";
import ChatAppearancePopover from "@/components/messages/ChatAppearancePopover";
import ScreenshotAttachment from "@/components/messages/ScreenshotAttachment";
import ConversationListItem, {conversationTitle} from "@/components/messages/ConversationListItem";
import MessageReactions from "@/components/messages/MessageReactions";
import MessageSenderAvatar, {startsMessageSenderGroup} from "@/components/messages/MessageSenderAvatar";
import EmojiGifPicker from "@/components/messages/EmojiGifPicker";
import EmojiAttachment from "@/components/messages/EmojiAttachment";
import AppLinkAttachment from "@/components/messages/AppLinkAttachment";
import {startAppLinkSelection} from "@/features/collab/appLinkSelection";
import {mergeReactions, onChatReactionsChanged} from "@/features/collab/chatReactions";
import {getCurrentUserNamespace} from "@/lib/userScopedStorage";
import {clipboardImageFiles, screenshotAttachments} from "@/features/collab/clipboardImages";
import {openChatDock} from "@/features/collab/chatDockState";
import {mergeMessages, onChatMessageSent} from "@/features/collab/chatMessages";
import {displayName, GroupSettingsDialog, NewConversationDialog} from "@/components/messages/ConversationDialogs";
import {UserAvatar} from "@/components/profile/UserAvatar";
import MessageBubble, {GifAttachment, isGifOnlyMessage} from "@/components/messages/MessageBubble";
import {removeChatMessage as removeChatMessageApi} from "@/features/admin/adminApi";
import {
  onChatAppearanceChanged,
  chatAppearanceStyles,
  readChatAppearance
} from "@/features/profiles/chatAppearanceStore";
import {useUserRole} from "@/components/auth/RoleGuard";
import {CaseNumberLink, SiteIdLink} from "@/components/links/ExternalIdLinks";

const PAGE_SIZE = 50;
const MAX_BODY = 4000;
const MAX_ATTACHMENTS = 10;

function formatMessageTime(value) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return "";
  return isToday(time) ? format(time, "h:mm a") : format(time, "MMM d, h:mm a");
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

export default function MessagesPage({conversationId, compact = false, visible = true}) {
  const location = useLocation();
  const navigate = useNavigate();
  const {isAdmin, user} = useUserRole();
  const activeId = conversationId || new URLSearchParams(location.search).get("c");
  const [meEmail, setMeEmail] = useState("");
  const [directory, setDirectory] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [listState, setListState] = useState({loading: true, error: null});
  const [thread, setThread] = useState({id: null, messages: [], hasOlder: false, loading: false, loadingOlder: false});
  const [pending, setPending] = useState([]);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [pasting, setPasting] = useState(false);
  const pasteInFlight = useRef(false);
  const activeConversationRef = useRef(activeId);
  activeConversationRef.current = activeId;
  const cancelElementSelection = useRef(null);
  useEffect(() => () => {
    cancelElementSelection.current?.();
    cancelElementSelection.current = null;
  }, [activeId]);
  const sharePageItem = () => {
    const owner = getCurrentUserNamespace();
    const conversation = activeId;
    cancelElementSelection.current?.();
    cancelElementSelection.current = startAppLinkSelection(attachment => {
      if (owner !== getCurrentUserNamespace() || activeConversationRef.current !== conversation) return;
      setAttachments(list => {
        if (list.length >= MAX_ATTACHMENTS) {
          toast.error("Messages can contain up to 10 attachments. Remove one before sharing an item.");
          return list;
        }
        return [...list, attachment];
      });
    });
  };
  useEffect(() => {
    setAttachments(list => list.filter(item => item.type !== "image"));
  }, [activeId]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    if (!visible) {
      setPickerOpen(false);
      setGifOpen(false);
      setSettingsOpen(false);
    }
  }, [visible]);
  const [appearance, setAppearance] = useState(() => readChatAppearance());
  const appearanceStyles = useMemo(() => chatAppearanceStyles(appearance), [appearance]);
  const scrollRef = useRef(null);
  const composerRef = useRef(null);
  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.style.height = "auto";
    composer.style.height = `${Math.min(120, composer.scrollHeight)}px`;
  }, [draft, visible, activeId]);
  useEffect(() => {
    if (compact && visible) composerRef.current?.focus({preventScroll: true});
  }, [compact, visible]);
  const stickToBottom = useRef(true);
  const threadRef = useRef(thread);
  threadRef.current = thread;
  const reactionRevision = useRef(0);
  const refreshReactions = useCallback(async () => {
    const current = threadRef.current;
    if (!current.id || current.loading || !current.messages.length) return;
    const revision = ++reactionRevision.current;
    const owner = getCurrentUserNamespace();
    try {
      const ids = current.messages.map(message => message.id);
      const reactions = {};
      for (let offset = 0; offset < ids.length; offset += 99) {
        const result = await chatApi.reactions({conversationId: current.id, messageIds: ids.slice(offset, offset + 99)});
        if (owner !== getCurrentUserNamespace()) return;
        Object.assign(reactions, result.reactions);
      }
      if (revision !== reactionRevision.current || threadRef.current.id !== current.id) return;
      setThread(state => state.id === current.id ? {...state, messages: mergeReactions(state.messages, reactions)} : state);
    } catch (error) {
      if (owner !== getCurrentUserNamespace()) return;
      console.error("Could not refresh message reactions", error);
      toast.error(error.message);
    }
  }, []);
  useEffect(() => onChatReactionsChanged(update => {
    reactionRevision.current++;
    setThread(state => state.id === update.conversationId
      ? {...state, messages: mergeReactions(state.messages, update.reactions)} : state);
  }), []);
  useEffect(() => {
    const off = subscribe("chat", "onReactionsChanged", update => {
      if (update.conversationId === threadRef.current.id) void refreshReactions();
    });
    return off;
  }, [refreshReactions]);
  useEffect(() => {
    if (!visible) return undefined;
    void refreshReactions();
    const timer = setInterval(() => { void refreshReactions(); }, 60000);
    return () => clearInterval(timer);
  }, [visible, refreshReactions]);
  const reactToMessage = async (message, emoji, active) => {
    const owner = getCurrentUserNamespace();
    try {
      reactionRevision.current++;
      await chatApi.react({conversationId: message.conversationId, messageId: message.id, emoji, active});
      if (owner !== getCurrentUserNamespace()) return;
    } catch (error) {
      if (owner !== getCurrentUserNamespace()) return;
      console.error("Could not update message reaction", error);
      toast.error(error.message);
    }
  };

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
    } catch (error) {
      console.error("Could not refresh conversation messages", error);
      toast.error("Could not refresh this conversation. Close and reopen it to try again.");
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

  useEffect(() => onChatMessageSent(message => {
    setThread(state => state.id === message.conversationId
      ? {...state, messages: mergeMessages(state.messages, [message])} : state);
    void refreshConversations();
  }), [refreshConversations]);

  useEffect(() => {
    if (visible) void loadNewer();
  }, [visible, loadNewer]);

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
        if (!cancelled) setThread(state => ({
          id: activeId,
          messages: mergeMessages(state.id === activeId ? state.messages : [], messages),
          hasOlder: messages.length === PAGE_SIZE, loading: false, loadingOlder: false
        }));
      })
      .catch((error) => {
        if (cancelled) return;
        toast.error(error.message);
        setThread((state) => ({...state, loading: false}));
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  useEffect(() => {
    if (!visible || !activeId) return undefined;
    return registerActiveChatView(activeId, compact ? 1 : 0);
  }, [activeId, visible, compact]);
  useEffect(() => {
    if (!compact && activeId) openChatDock(activeId, {minimized: true});
  }, [activeId, compact]);
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
  }, [shown.length, activeId, thread.loading, visible]);

  // Mark the conversation read while it is on screen and the window has focus.
  useEffect(() => {
    if (!visible || !activeId || !lastMessage?.createdAt) return undefined;
    const markRead = () => {
      if (!document.hasFocus()) return;
      void chatApi.markRead({conversationId: activeId, at: lastMessage.createdAt});
      setConversations((list) => list.map((conversation) => (conversation.id === activeId ? {...conversation, unread: 0} : conversation)));
    };
    markRead();
    window.addEventListener("focus", markRead);
    return () => window.removeEventListener("focus", markRead);
  }, [activeId, lastMessage?.createdAt, visible]);

  const open = (id) => {
    if (compact) {
      if (id) openChatDock(id);
    } else {
      navigate(id ? `/Messages?c=${encodeURIComponent(id)}` : "/Messages", {replace: Boolean(activeId)});
    }
  };

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
    if (pasteInFlight.current) return;
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
    if (pasteInFlight.current) return;
    const attachment = quoteAttachment(quote);
    setAttachments((list) => (list.some((item) => item.quoteId === attachment.quoteId) || list.length >= MAX_ATTACHMENTS ? list : [...list, attachment]));
    setPickerOpen(false);
  };

  const addGif = (gif) => {
    if (pasteInFlight.current) return;
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

  const addEmoji = (emoji, type) => {
    if (pasteInFlight.current) return;
    const attachment = {type, emojiId: emoji.id, name: emoji.name || emoji.label,
      ...(emoji.sourceGifId ? {sourceGifId: emoji.sourceGifId} : {})};
    setAttachments(list => list.length >= MAX_ATTACHMENTS ? list : [...list, attachment]);
    setGifOpen(false);
  };

  const pasteScreenshots = async (event) => {
    const files = clipboardImageFiles(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    if (pasteInFlight.current) {
      toast.error("Wait for the current screenshot to finish loading.");
      return;
    }
    pasteInFlight.current = true;
    setPasting(true);
    const conversationId = activeId;
    try {
      const images = await screenshotAttachments(files, MAX_ATTACHMENTS - attachments.length);
      if (activeConversationRef.current !== conversationId) {
        toast.error("The conversation changed. Paste the screenshot again in the intended conversation.");
        return;
      }
      setAttachments(list => [...list, ...images]);
    } catch (error) {
      toast.error(error.message);
    } finally {
      pasteInFlight.current = false;
      setPasting(false);
    }
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
    <div className={compact ? "flex h-full min-h-0 flex-col" : "mx-auto flex h-[calc(100vh-4rem)] max-w-7xl flex-col gap-4 p-6"}>
      {!compact && <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground"><MessageSquare className="h-6 w-6 text-orange-600" />Messages</h1>
          <p className="text-sm text-muted-foreground">Message teammates directly or in groups, and share quotes.</p>
        </div>
        <Button onClick={() => setNewOpen(true)} disabled={Boolean(listState.error)}>
          <Plus className="mr-1 h-4 w-4" />New conversation
        </Button>
      </div>}

      <div className={compact ? "flex min-h-0 flex-1 flex-col" : "grid min-h-0 flex-1 gap-4 md:grid-cols-[300px_1fr]"}>
        {!compact && <Card className="min-h-0 overflow-hidden">
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
                    <ConversationListItem conversation={conversation} meEmail={meEmail} names={names}
                      active={conversation.id === activeId} onClick={() => open(conversation.id)} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>}

        <Card className={cn("flex min-h-0 flex-col overflow-hidden", compact && "flex-1 rounded-none border-0 shadow-none")}>
          {!activeId ? (
            <div className="flex flex-1 flex-col items-center justify-center p-10 text-center text-slate-500">
              <MessageSquare className="mb-3 h-10 w-10 text-slate-300" />
              <p className="text-sm">Pick a conversation, or start a new one.</p>
            </div>
          ) : (
            <>
              {!compact && <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
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
              </div>}

              <div
                ref={scrollRef}
                className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-3 pt-12"
                data-testid="chat-background"
                style={appearanceStyles.background}
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
                      const showAvatar = startsMessageSenderGroup(message, previous);
                      const showSender = !mine && showAvatar;
                      const bubbleStyle = mine ? appearanceStyles.mine : appearanceStyles.theirs;
                      const removed = message.body === "[removed by admin]" && (message.attachments || []).length === 0;
                      const gifOnly = isGifOnlyMessage(message);
                      return (
                        <div key={message.id} className={cn("group/message relative flex gap-2", mine ? "justify-end" : "justify-start")}>
                          {!mine && <MessageSenderAvatar email={message.sender} name={displayName(message.sender, names)}
                            show={showAvatar} hasSenderLabel={showSender} />}
                          <div className={cn("flex max-w-[75%] flex-col", mine ? "items-end" : "items-start")}>
                            {showSender && <span className="mb-0.5 px-1 text-xs font-medium text-foreground">{displayName(message.sender, names)}</span>}
                            <MessageBubble message={message} mine={mine} bubbleStyle={bubbleStyle}>
                            {message.body && !gifOnly && <p className={cn("whitespace-pre-wrap break-words", removed && "italic opacity-70")}>{message.body}</p>}
                            {(message.attachments || []).length > 0 && (
                              <div className={cn("flex flex-col", !gifOnly && "gap-1")}>
                                {message.attachments.map((attachment, attachmentIndex) => (
                                  attachment.type === "gif"
                                    ? <GifAttachment key={`${attachment.id}-${attachmentIndex}`} attachment={attachment} edgeToEdge={gifOnly} />
                                    : ["custom_emoji", "builtin_emoji"].includes(attachment.type)
                                      ? <EmojiAttachment key={`emoji-${attachmentIndex}`} attachment={attachment} />
                                    : attachment.type === "image"
                                      ? <ScreenshotAttachment key={`${attachment.fileId || attachment.id}-${attachmentIndex}`} attachment={attachment} conversationId={message.conversationId} />
                                    : attachment.type === "app_link"
                                      ? <AppLinkAttachment key={`app-link-${attachmentIndex}`} attachment={attachment} />
                                    : <AttachmentChip key={attachment.quoteId} attachment={attachment} />
                                ))}
                              </div>
                            )}
                            </MessageBubble>
                          <div className="mt-1 flex max-w-full flex-col">
                            {!message.status && !removed && <MessageReactions message={message} meEmail={meEmail} names={names} mine={mine}
                              isChatAdmin={isChatAdmin} onReact={(emoji, active) => reactToMessage(message, emoji, active)}
                              onRemove={() => removeMessageAsAdmin(message.id)} />}
                          <span className="flex flex-wrap items-center gap-2 px-1 text-[11px] leading-4 text-muted-foreground">
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
                          {mine && <MessageSenderAvatar email={message.sender} name={displayName(message.sender, names)} show={showAvatar} />}
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
                      ) : ["custom_emoji", "builtin_emoji"].includes(attachment.type) ? (
                        <EmojiAttachment key={`emoji-${index}`} attachment={attachment}
                          onRemove={() => setAttachments(list => list.filter((_, position) => position !== index))} />
                      ) : attachment.type === "image" ? (
                        <div key={attachment.id} className="relative w-48 max-w-full rounded-lg border border-border bg-card p-2 text-card-foreground">
                          <img src={attachment.dataUrl} alt="Screenshot preview" className="max-h-28 w-full rounded object-contain" />
                          <button type="button" aria-label="Remove screenshot" onClick={() => setAttachments(list => list.filter(item => item.id !== attachment.id))} className="absolute right-1 top-1 rounded bg-card p-1 text-card-foreground">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : attachment.type === "app_link" ? (
                        <AppLinkAttachment key={`app-link-${index}`} attachment={attachment}
                          onRemove={() => setAttachments(list => list.filter((_, position) => position !== index))} />
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
                <div className="rounded-md border border-input bg-background focus-within:ring-1 focus-within:ring-ring">
                  <Textarea
                    ref={composerRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onPaste={pasteScreenshots}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    rows={1}
                    maxLength={MAX_BODY}
                    aria-label="Message text"
                    title="Enter to send, Shift+Enter for a new line. Paste screenshots with Ctrl+V."
                    placeholder="Type a message"
                    className="min-h-10 w-full resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
                  />
                  <div className="flex items-center justify-end gap-1 px-1 pb-1" aria-label="Message composer actions">
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="Share something in EnQuote"
                    title="Pick something on this page to share" onClick={sharePageItem}
                    disabled={pasting || attachments.length >= MAX_ATTACHMENTS}>
                    <MousePointer2 className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    aria-label="Attach a quote"
                    title="Attach a quote"
                    onClick={() => setPickerOpen(true)}
                    disabled={pasting || attachments.length >= MAX_ATTACHMENTS}
                  >
                    <Paperclip className="h-4 w-4" />
                  </Button>
                  <Popover open={gifOpen} onOpenChange={setGifOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label="Add emoji or GIF"
                        title="Emoji and GIFs"
                        disabled={pasting || attachments.length >= MAX_ATTACHMENTS}
                      >
                        <Smile className="h-4 w-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-96 max-w-[calc(100vw-1rem)]">
                      <EmojiGifPicker onCustom={emoji => addEmoji(emoji, "custom_emoji")}
                        onBuiltin={emoji => addEmoji(emoji, "builtin_emoji")} onGif={addGif} />
                    </PopoverContent>
                  </Popover>
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-primary" title="Send message"
                    onClick={send} disabled={pasting || (!draft.trim() && !attachments.length)} aria-label="Send">
                    <Send className="h-4 w-4" />
                  </Button>
                  </div>
                </div>
                {pasting && <p className="text-xs text-muted-foreground" role="status">Preparing screenshot...</p>}
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
