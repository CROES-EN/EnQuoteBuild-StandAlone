import {useEffect, useReducer, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {AnimatePresence, motion, useReducedMotion} from "framer-motion";
import {useLocation, useNavigate} from "react-router-dom";
import {ArrowLeft, ExternalLink, Loader2, MessageSquare, Minus, Plus, X} from "lucide-react";
import {NewConversationDialog} from "./ConversationDialogs";
import ResizableChatWindow from "./ResizableChatWindow";
import ConversationListItem from "./ConversationListItem";
import {currentAppLinkRequest, onAppLinkPickingChanged} from "@/features/collab/appLinkSelection";
import {toast} from "sonner";
import MessagesPage from "@/pages/Messages";
import {chatApi, hasCollabBridge, subscribe} from "@/features/collab/collabApi";
import {incomingConversationIds, isMessagesPage, onChatDockOpen, updateDock} from "@/features/collab/chatDockState";
import {getCurrentUserNamespace, onUserSessionChanged} from "@/lib/userScopedStorage";
import {useUserRole} from "@/components/auth/RoleGuard";
import {useAccessPolicy} from "@/features/admin/adminApi";
import {canAccessPage} from "@/lib/rolePageAccess";
import {cn} from "@/lib/utils";
import ErrorBoundary from "@/components/ErrorBoundary";

export default function ChatDock() {
  const reducedMotion = useReducedMotion();
  const {user} = useUserRole();
  const {policy} = useAccessPolicy();
  const [owner, setOwner] = useState(getCurrentUserNamespace);
  const allowed = Boolean(owner === String(user?.email || "").trim().toLowerCase() &&
    canAccessPage(user, "Messages", policy) && hasCollabBridge());
  const [state, dispatch] = useReducer(updateDock, {tabs: [], expandedIds: []});
  const [conversations, setConversations] = useState([]);
  const [names, setNames] = useState(new Map());
  const [directory, setDirectory] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [loadingPeople, setLoadingPeople] = useState(false);
  const pickerRequest = useRef(0);
  useEffect(() => () => { pickerRequest.current++; }, []);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [selectingItem, setSelectingItem] = useState(() => Boolean(currentAppLinkRequest()));
  const [sharedSize, setSharedSize] = useState(null);
  const dockRef = useRef(null);
  const [dockHeight, setDockHeight] = useState(0);
  useEffect(() => onAppLinkPickingChanged(request => setSelectingItem(Boolean(request))), []);
  const location = useLocation();
  const navigate = useNavigate();
  const refreshRef = useRef(() => {});
  const onMessagesPage = isMessagesPage(location.pathname);
  const pageConversation = onMessagesPage ? new URLSearchParams(location.search).get("c") : null;
  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return undefined;
    const measure = () => setDockHeight(dock.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    return () => observer.disconnect();
  }, [allowed, owner, onMessagesPage, recentOpen]);
  useEffect(() => {
    if (allowed && pageConversation) dispatch({type: "open", id: pageConversation, minimized: true});
  }, [allowed, pageConversation]);

  useEffect(() => onUserSessionChanged(() => {
    setOwner(getCurrentUserNamespace());
    dispatch({type: "reset"});
    setConversations([]);
    setNames(new Map());
    setDirectory([]);
    setPickerOpen(false);
    setRecentOpen(false);
    setLoadingPeople(false);
    pickerRequest.current++;
    setError("");
    setSharedSize(null);
  }), []);

  useEffect(() => {
    if (!allowed || owner === "__anonymous__") {
      dispatch({type: "reset"});
      setRecentOpen(false);
      setPickerOpen(false);
      pickerRequest.current++;
      return undefined;
    }
    return onChatDockOpen(({conversationId, minimized}) => {
      if (!minimized) setRecentOpen(false);
      dispatch({type: "open", id: conversationId, minimized});
      refreshRef.current();
    });
  }, [allowed, owner]);

  useEffect(() => {
    if (!allowed || owner === "__anonymous__") return undefined;
    let cancelled = false;
    let previous = null;
    let running = false;
    let queued = false;
    const refresh = async () => {
      if (running) { queued = true; return; }
      running = true;
      do {
        queued = false;
        try {
          const list = await chatApi.conversations();
          if (cancelled || owner !== getCurrentUserNamespace()) break;
          for (const id of incomingConversationIds(previous, list, owner)) {
            dispatch({type: "open", id, minimized: true});
          }
          previous = list;
          setConversations(list);
          setError("");
        } catch (error) {
          if (cancelled) break;
          console.error("Could not refresh chat dock", error);
          setError(error.message);
        }
      } while (queued && !cancelled);
      running = false;
    };
    refreshRef.current = () => { void refresh(); };
    void refresh();
    chatApi.directory().then(directory => {
      if (!cancelled) setNames(new Map(directory.map(person => [person.email, person.name])));
    }).catch(error => {
      if (!cancelled) {
        console.error("Could not load chat names", error);
        toast.error("Could not load chat names. Email addresses will be shown.");
      }
    });
    const offChanged = subscribe("chat", "onChanged", refreshRef.current);
    const offUpdated = subscribe("chat", "onUpdated", refreshRef.current);
    return () => {
      cancelled = true;
      refreshRef.current = () => {};
      offChanged();
      offUpdated();
    };
  }, [allowed, owner, reload]);

  const openPeoplePicker = async () => {
    const request = ++pickerRequest.current;
    setLoadingPeople(true);
    try {
      const people = await chatApi.directory({refresh: true});
      if (request !== pickerRequest.current || owner !== getCurrentUserNamespace()) return;
      setDirectory(people);
      setNames(new Map(people.map(person => [person.email, person.name])));
      setPickerOpen(true);
    } catch (error) {
      if (request !== pickerRequest.current || owner !== getCurrentUserNamespace()) return;
      console.error("Could not open message people picker", error);
      toast.error("Could not load people to message. Please try again.");
    } finally {
      if (request === pickerRequest.current) setLoadingPeople(false);
    }
  };

  if (!allowed || owner === "__anonymous__") return null;
  const titleFor = id => {
    const conversation = conversations.find(item => item.id === id);
    if (conversation?.kind === "group") return conversation.name || "Group";
    const email = conversation?.members?.find(member => member.email !== owner)?.email;
    return names.get(email) || email || "Conversation";
  };
  const expanded = state.expandedIds.length > 0;
  const minimizedTabs = state.tabs.filter(tab => !state.expandedIds.includes(tab.id));
  const selectConversation = id => {
    setRecentOpen(false);
    setPickerOpen(false);
    if (onMessagesPage) navigate(`/Messages?c=${encodeURIComponent(id)}`);
    else dispatch({type: "open", id});
  };
  return createPortal(
    <div className={cn("pointer-events-none fixed inset-0 z-[45]", selectingItem && "hidden")} data-chat-overlay>
    <AnimatePresence>
    {recentOpen && <motion.section aria-label="Recent conversations"
      initial={{opacity: 0, y: reducedMotion ? 0 : 16}} animate={{opacity: 1, y: 0}}
      exit={{opacity: 0, y: reducedMotion ? 0 : 16, pointerEvents: "none"}}
      transition={{duration: reducedMotion ? 0 : 0.16}}
      className="pointer-events-auto fixed bottom-0 right-0 z-40 flex max-h-dvh w-[380px] max-w-full flex-col overflow-hidden border border-border bg-card text-card-foreground shadow-lg">
      <header className="flex shrink-0 items-center gap-2 border-b border-border bg-secondary p-2 pl-5 text-secondary-foreground">
        {pickerOpen && <button type="button" aria-label="Back to recent conversations" onClick={() => setPickerOpen(false)} className="rounded p-1 hover:bg-muted"><ArrowLeft className="h-4 w-4" /></button>}
        <h2 className="flex-1 text-sm font-semibold">{pickerOpen ? "New conversation" : "Recent conversations"}</h2>
        {!pickerOpen && <button type="button" aria-label="New conversation" title="New conversation" disabled={loadingPeople} onClick={openPeoplePicker} className="rounded p-1 hover:bg-muted">
          {loadingPeople ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        </button>}
        <button type="button" aria-label="Close recent conversations" onClick={() => {
          pickerRequest.current++;
          setLoadingPeople(false);
          setRecentOpen(false);
        }} className="rounded p-1 hover:bg-muted"><X className="h-4 w-4" /></button>
      </header>
      <div className="min-h-0 overflow-y-auto">
      <NewConversationDialog key={owner} embedded open={pickerOpen} onOpenChange={setPickerOpen}
      directory={directory} names={names} meEmail={owner} onCreated={conversation => {
        if (owner !== getCurrentUserNamespace()) return;
        setConversations(list => [conversation, ...list.filter(item => item.id !== conversation.id)]);
        selectConversation(conversation.id);
      }} />
      {!pickerOpen && <>
        {error && <div role="alert" className="p-3 text-sm">{error} <button type="button" className="underline" onClick={() => setReload(value => value + 1)}>Retry</button></div>}
        {!error && !conversations.length && <p className="p-4 text-sm text-muted-foreground">No recent conversations. Use + to start one.</p>}
        {[...conversations].sort((a, b) => String(b.lastMessageAt || "").localeCompare(String(a.lastMessageAt || ""))).map(conversation => (
          <ConversationListItem key={conversation.id} conversation={conversation} names={names} meEmail={owner} onClick={() => selectConversation(conversation.id)} />
        ))}
      </>}
      </div>
    </motion.section>}
    </AnimatePresence>
    <aside ref={dockRef} aria-label="Chat dock" className={cn("pointer-events-none fixed bottom-0 right-0 z-40 max-w-full flex-row-reverse items-end",
      onMessagesPage || recentOpen ? "hidden" : "flex")}>
      <div className="pointer-events-none relative flex min-w-0 max-w-[100vw] flex-row-reverse items-end overflow-x-auto" aria-label="Expanded chats">
      <AnimatePresence>
      {state.tabs.filter(tab => tab.opened).map(tab => (
        <ResizableChatWindow key={`${owner}:${tab.id}`} title={titleFor(tab.id)} visible={state.expandedIds.includes(tab.id)}
          sharedSize={sharedSize} onResizeAll={setSharedSize}>
          <header className="flex shrink-0 items-center gap-2 border-b border-border bg-secondary p-2 pl-5 text-secondary-foreground">
            <MessageSquare className="h-4 w-4 shrink-0" />
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{titleFor(tab.id)}</h2>
            <button type="button" title="Open in Messages" aria-label={`Open ${titleFor(tab.id)} in Messages`} className="rounded p-1 hover:bg-muted"
              onClick={() => {
                dispatch({type: "minimize", id: tab.id});
                navigate(`/Messages?c=${encodeURIComponent(tab.id)}`);
              }}><ExternalLink className="h-4 w-4" /></button>
            <button type="button" aria-label={`Minimize ${titleFor(tab.id)}`} className="rounded p-1 hover:bg-muted"
              onClick={() => dispatch({type: "minimize", id: tab.id})}><Minus className="h-4 w-4" /></button>
            <button type="button" aria-label={`Close ${titleFor(tab.id)}`} className="rounded p-1 hover:bg-muted"
              onClick={() => dispatch({type: "close", id: tab.id})}><X className="h-4 w-4" /></button>
          </header>
          <div className="min-h-0 flex-1">
            <ErrorBoundary><MessagesPage compact conversationId={tab.id} visible={!onMessagesPage && !recentOpen && state.expandedIds.includes(tab.id)} /></ErrorBoundary>
          </div>
        </ResizableChatWindow>
      ))}
      </AnimatePresence>
      </div>
      {error && <div role="alert" className="pointer-events-auto max-w-sm rounded border border-border bg-card p-2 text-sm text-card-foreground">
        {error} <button type="button" className="underline" onClick={() => setReload(value => value + 1)}>Retry</button>
      </div>}
      {minimizedTabs.length > 0 && <div className={cn("pointer-events-auto relative z-10 flex max-w-full shrink-0 gap-1 overflow-x-auto bg-background",
        expanded ? "h-10" : "h-14 pr-[72px]")} aria-label="Open chats">
        {minimizedTabs.map(tab => {
          const unread = conversations.find(item => item.id === tab.id)?.unread || 0;
          const title = titleFor(tab.id);
          return (
            <div key={tab.id} className="flex w-44 shrink-0 items-center rounded-md border border-border bg-card text-card-foreground">
              <button type="button" aria-expanded={false} aria-label={`Open chat with ${title}`}
                onClick={() => dispatch({type: "open", id: tab.id})} className="flex min-w-0 flex-1 items-center gap-2 p-2 text-sm">
                <MessageSquare className="h-4 w-4 shrink-0" /><span className="truncate">{title}</span>
                {unread > 0 && <span aria-label={`${unread} unread messages`} className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{unread > 99 ? "99+" : unread}</span>}
              </button>
              <button type="button" aria-label={`Close chat with ${title}`} onClick={() => dispatch({type: "close", id: tab.id})} className="shrink-0 rounded p-1 hover:bg-muted"><X className="h-3.5 w-3.5" /></button>
            </div>
          );
        })}
      </div>}
    </aside>
    {!recentOpen && <button type="button" aria-label="Message someone" title="Message someone"
      style={!onMessagesPage && expanded ? {bottom: dockHeight + 8, right: 0} : undefined}
      aria-expanded={recentOpen} onClick={() => {
        pickerRequest.current++;
        setLoadingPeople(false);
        setRecentOpen(value => !value);
        setPickerOpen(false);
        refreshRef.current();
      }}
      className={cn("pointer-events-auto fixed z-40 flex h-10 w-10 items-center justify-center rounded-full border border-primary bg-primary text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        !onMessagesPage && expanded ? "right-0" : "bottom-4 right-4")}>
      <MessageSquare className="h-5 w-5" />
    </button>}
    </div>,
    document.body
  );
}
