import {
  AlertTriangle,
  Archive,
  BarChart3,
  Bell,
  BookOpen,
  Briefcase,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  FileOutput,
  FileText,
  Headset,
  LayoutDashboard,
  Mail,
  Menu,
  MessageSquare,
  Package,
  Recycle,
  RefreshCw,
  Route,
  ShoppingCart,
  Siren,
  Sparkles,
  Trash2,
  Users,
  Wallet,
  HeartHandshake,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import {Link, useNavigate} from "react-router-dom";
import {DragDropContext, Draggable, Droppable} from "@hello-pangea/dnd";
import UpdateStatusBadge from "@/components/UpdateStatusBadge";
import UiUpdateBanner from "@/components/UiUpdateBanner";
import {createPageUrl} from "@/utils";
import {cn} from "@/lib/utils";
import {useCallback, useEffect, useRef, useState} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {useUserRole} from "@/components/auth/RoleGuard";
import {useAuth} from "@/lib/AuthContext";
import {canAccessPage} from "@/lib/rolePageAccess";
import {useAccessPolicy} from "@/features/admin/adminApi";
import AutoAssignRole from "@/components/auth/AutoAssignRole";
import RefreshStatusDialog from "@/components/RefreshStatusDialog";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import ErrorBoundary from "@/components/ErrorBoundary";
import {REFRESH_REASON_LABELS, useLocalSyncStatus} from "@/hooks/useLocalSyncStatus";
import {
  startEodbEmailAutoImportWatcher,
  stopEodbEmailAutoImportWatcher
} from "@/features/supervisorDashboard/eodbEmailAutoImportWatcher";
import {getAutoImportSettings} from "@/features/supervisorDashboard/autoImportSettings";
import {ensureActiveCareTable, getReportTable} from "@/features/supervisorDashboard/importedTableStore";
import {
  filterRowsToMe,
  getMyCaseOwnerName,
  getTiles,
  getUnseenImportantCount,
  onSeenChanged
} from "@/features/supervisorDashboard/workloadPreferences";
import appPackage from "../package.json";
import enquoteLogo from "@/assets/enquote-logo.png";
import SidebarLogoAnimation from "@/components/SidebarLogoAnimation";
import DeveloperConsole from "@/components/DeveloperConsole";
import NotificationBell from "@/components/NotificationBell";
import NewTaskButton from "@/components/collab/NewTaskButton";
import {recordError} from "@/features/developerConsole/errorLog";
import {countAttentionTasks, useChatUnread, useTasks} from "@/features/collab/collabApi";
import {openChatDock} from "@/features/collab/chatDockState";
import {ProfilePicturePicker, UserAvatar} from "@/components/profile/UserAvatar";
import {isReadonlyViewing} from "@/features/admin/readonlyViewing";
import {applySidebarOrder, readSidebarOrder, writeSidebarOrder} from "@/lib/sidebarOrder";

const isDemoMode = ["mock", "local", "salesforce-mock"].includes(import.meta.env.VITE_DATA_SOURCE);
const appVersion = appPackage?.version || "0.0.0";
const DATA_LAST_UPDATED_STORAGE_KEY = "enquote_data_last_updated";

// If the most recent successful sync is older than this, gently flag the "Data Last
// Updated" label so users have passive visibility into staleness without needing to
// guess or hit refresh "just in case".
const STALE_DATA_THRESHOLD_MS = 30 * 60 * 1000;

// How long a manually-triggered refresh's inline result message stays on screen before
// fading back to idle.
const REFRESH_SETTLE_DISPLAY_MS = 5000;

// FIX (sturdiness - confirmed root cause of "Workload/Supervisor Dashboard reports
// disappear whenever Base44 sends data"): every call site below that needs to soft-refresh
// data after an external sync (a Base44 webhook import, a manual "Refresh App", etc.)
// previously called queryClient.invalidateQueries() with NO arguments - which invalidates
// EVERY single cached query in the whole app, with no exceptions. That includes
// RoleGuard/useUserRole's own ["currentUser"] query, which has nothing to do with quote data
// syncing - a Base44 quote import is not a reason to re-verify who's signed in or what their
// role is. Since RoleGuard renders a FULL-SCREEN loading spinner in place of its children
// while that query is refetching (its own separate fix, applied directly in RoleGuard.jsx,
// makes this specific symptom impossible even if it WERE invalidated) - the real, root
// fix belongs here: a Base44 sync should never have invalidated the current-user/role query
// in the first place. invalidateDataQueries() below does the exact same broad invalidation
// as before for every OTHER query (so genuinely Base44-dependent data like quotes/products
// still refreshes exactly as it always has), it just deliberately excludes "currentUser".
function invalidateDataQueries(queryClient) {
  queryClient.invalidateQueries({
    predicate: (query) => query.queryKey?.[0] !== "currentUser"
  });
}

function readStoredLastUpdated() {
  try {
    const raw = globalThis.window?.localStorage?.getItem(DATA_LAST_UPDATED_STORAGE_KEY);
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return null;
  }
}

function persistLastUpdated(date) {
  try {
    globalThis.window?.localStorage?.setItem(DATA_LAST_UPDATED_STORAGE_KEY, date.toISOString());
  } catch {
    // Persistence is best-effort only; it should never break the UI.
  }
}

// Formats as "MM/DD/YY h:mm AM/PM" - date part follows the OS/browser locale (i.e. the
// user's Windows date format setting) while the time is always forced to 12-hour + AM/PM
// per product requirements, regardless of the system's 24-hour clock setting.
function formatLastUpdated(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const datePart = date.toLocaleDateString(undefined, { month: "2-digit", day: "2-digit", year: "2-digit" });
  const timePart = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });
  return `${datePart} ${timePart}`;
}

export default function Layout({ children, currentPageName }) {
  const { isAdmin, roles, user } = useUserRole();
  const { isAuthenticated, isLocalAuthActive, logout } = useAuth();

  const navItems = [
    { name: "Dashboard", icon: LayoutDashboard, page: "Dashboard", roles: ["submitter", "approver", "admin", "invoicer"] },
    { name: "Workload", icon: Briefcase, page: "Workload", roles: ["submitter", "approver", "admin", "invoicer"] },
    { name: "Tasks", icon: ClipboardList, page: "Tasks", roles: ["submitter", "approver", "admin", "invoicer"] },
    { name: "Messages", icon: MessageSquare, page: "Messages", roles: ["submitter", "approver", "admin", "invoicer"] },
    { name: "Quotes", icon: FileText, page: "Quotes", roles: ["submitter", "approver", "admin", "invoicer"] },
    { name: "Auto-Drafter", icon: Sparkles, page: "AutoDrafter", roles: ["submitter", "approver", "admin", "invoicer"], badge: "beta" },
    { name: "Products & Services", icon: Package, page: "Products", roles: ["submitter", "approver", "admin", "invoicer"] },
    { name: "Material Orders", icon: ShoppingCart, page: "MaterialOrders", roles: ["submitter", "approver", "admin", "invoicer"] },
    { name: "PV Panel RMA Tracker", icon: Recycle, page: "PVPanelRMAs", roles: ["submitter", "approver", "admin", "invoicer"] },
    { name: "SLA Reporting", icon: BarChart3, page: "SLAReporting", roles: ["submitter", "approver", "admin", "invoicer"] },
    { name: "Users", icon: Users, page: "Users", roles: ["admin"] },
    { name: "Deletion Requests", icon: Trash2, page: "QuoteDeletionRequests", roles: ["admin"] },
    { name: "Email Notifications", icon: Mail, page: "EmailNotifications", roles: ["submitter", "approver", "admin", "invoicer"] },
    { name: "Follow-Up Settings", icon: Bell, page: "FollowUpSettings", roles: ["submitter", "approver", "admin", "invoicer"] },
    { name: "PDF Template", icon: FileOutput, page: "PDFTemplateSettings", roles: ["submitter", "approver", "admin", "invoicer"] },
    { name: "Boneyard", icon: Archive, page: "Boneyard", roles: ["submitter", "approver", "admin", "invoicer"] },
    { name: "SV Cancel Tracker", icon: AlertTriangle, page: "SVCancelTracker", roles: ["submitter", "approver", "admin", "invoicer"] },
    { name: "Resource Planner", icon: Route, page: "ResourcePlanner", roles: ["submitter", "approver", "admin", "invoicer"] },
    { name: "SOP Library", icon: BookOpen, page: "SOPLibrary", roles: ["submitter", "approver", "admin", "invoicer"] },
    { name: "Site Flags", icon: Siren, page: "SiteFlagManager", roles: ["submitter", "approver", "admin", "invoicer"] },
    { name: "Rejection Reviews", icon: AlertTriangle, page: "RejectedQuoteReview", roles: ["submitter", "approver", "admin", "invoicer"] },
    { name: "Supervisor Dashboard", icon: Headset, page: "SupervisorDashboard", roles: ["admin", "approver", "submitter", "invoicer"] },
    { name: "Enphase Care", icon: HeartHandshake, page: "EnphaseCare", roles: ["admin", "approver", "invoicer", "submitter"] },
    { name: "Inactive Revenue", icon: Wallet, page: "InactiveRevenueDashboard", roles: ["admin", "approver", "invoicer", "submitter"] }
  ];

  const {policy: accessPolicy} = useAccessPolicy();
  const announcement = accessPolicy?.announcement || null;
  const [dismissedAnnouncementId, setDismissedAnnouncementId] = useState(() => {
    try { return localStorage.getItem("enquote_dismissed_announcement_id") || ""; } catch { return ""; }
  });
  const [sidebarOrder, setSidebarOrder] = useState(() => readSidebarOrder());
  useEffect(() => {
    setSidebarOrder(readSidebarOrder());
  }, [user?.email]);
  const orderedNavItems = applySidebarOrder(navItems, sidebarOrder);
  const readonlyViewing = isReadonlyViewing();
  const visibleNavItems = orderedNavItems.filter(item => canAccessPage(user, item.page, accessPolicy));
  const currentPageBlocked = Boolean(currentPageName) && isAuthenticated && !canAccessPage(user, currentPageName, accessPolicy);

  // Moves a tab among the visible ones while tabs hidden for this role keep their saved slots,
  // so a later role change doesn't scramble the order.
  function handleNavDragEnd(result) {
    if (!result.destination || result.destination.index === result.source.index) return;
    const visibleIds = visibleNavItems.map((item) => item.page);
    const [moved] = visibleIds.splice(result.source.index, 1);
    visibleIds.splice(result.destination.index, 0, moved);
    const visibleSet = new Set(visibleIds);
    let next = 0;
    const fullOrder = orderedNavItems.map((item) => (visibleSet.has(item.page) ? visibleIds[next++] : item.page));
    setSidebarOrder(fullOrder);
    writeSidebarOrder(fullOrder);
  }

  function resetSidebarOrder() {
    setSidebarOrder(null);
    writeSidebarOrder(null);
  }

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(() => readStoredLastUpdated());

  // Forces a re-render every minute purely so the stale-data check below (computed from
  // Date.now() at render time) stays live without requiring any user interaction.
  const [, forceTick] = useState(0);

  const queryClient = useQueryClient();
  const { phase, lastAttempt, events, progress, trigger, hasBridge, outboundStatus, fetchOutboundStatus } = useLocalSyncStatus();

  // Suppresses the passive "New data synced" toast when the background fs-watch
  // notification is just the natural side-effect of a manual refresh the user JUST
  // triggered - that flow already shows its own inline result message.
  const recentManualSettleRef = useRef(0);

  // Records a known-good data timestamp (never fabricated - only called with a real
  // finishedAt from the webhook receiver, or "now" when a soft refresh just re-fetched
  // everything from the data source) and keeps the newest value across renders/reloads.
  const recordDataRefresh = useCallback((date) => {
    setLastUpdated(prev => (prev && prev >= date) ? prev : date);
    persistLastUpdated(date);
  }, []);

  // REMOVED: this used to ask the retired webhook-receiver.cjs (localhost:3001) for the
  // last known-good import status on mount. That endpoint ("app:refresh-status") was
  // removed from main.cjs as dead code - this was its last remaining caller, which
  // failed safely (optional-chaining + catch) but logged a noisy console error every
  // launch. The real refresh flow (manual refresh, outbound sync, entity-snapshot
  // polling) is completely unaffected by this removal.


  // Passive background sync: whenever the main process notifies us that new data landed
  // on disk (a Base44 webhook import, whether from the automatic 15-min schedule or a
  // manual refresh), soft-refresh in place - no page reload, so nothing the user is doing
  // gets interrupted or blanked.
  //
  // FIX: uses invalidateDataQueries() (see top of file) instead of a raw, unscoped
  // queryClient.invalidateQueries() - a Base44 data sync has no business invalidating the
  // signed-in user's own role/auth query, which is the confirmed root cause of Workload and
  // Supervisor Dashboard pages appearing to "disappear" on every Base44 sync (RoleGuard was
  // blanking its children behind a full-screen spinner while that unrelated query refetched).
  useEffect(() => {
    const bridge = globalThis.window?.enquoteLocal?.app;
    if (!bridge?.onDataUpdated) return;
    const unsubscribe = bridge.onDataUpdated((payload) => {
      invalidateDataQueries(queryClient);
      recordDataRefresh(payload?.at ? new Date(payload.at) : new Date());
      if (Date.now() - recentManualSettleRef.current > REFRESH_SETTLE_DISPLAY_MS) {
        const changedQuoteNumbers = Array.isArray(payload?.changedQuoteNumbers) ? payload.changedQuoteNumbers : [];
        if (changedQuoteNumbers.length === 1) {
          toast.success(`Quote #${changedQuoteNumbers[0]} has been updated`);
        } else if (changedQuoteNumbers.length > 1) {
          toast.success(`${changedQuoteNumbers.length} quotes updated`);
        }
        // If changedQuoteNumbers is empty (a routine sync with nothing genuinely new),
        // deliberately show no toast at all - silence is correct here, not a fallback
        // generic message, since there's nothing worth announcing.
      }
    });
    return unsubscribe;
  }, [queryClient, recordDataRefresh]);

  // O&M Daily Operations Snapshot: zero-click auto-import from the watched "O&M Reports Inbox"
  // local folder (see electron/main.cjs's watchReportsInbox()). Registered here - not inside the
  // Supervisor Dashboard page itself - so a file dropped in while the user is elsewhere in the
  // app still gets processed instead of silently missed because no listener was mounted yet.
  // The old "O&M Reports Inbox" (System A) useEffect has been removed - System A is fully
  // retired. The EODB/Email Auto-Import watcher (System C) below is the only remaining
  // auto-import mechanism.

  // EODB/Email Auto-Import - separate from the O&M Reports Inbox watcher above (see
  // eodbEmailAutoImportWatcher.js for the full design rationale). Starts/stops based on the
  // SIGNED-IN user's own saved settings (autoImportSettings.js is keyed by user.email, reusing
  // the SAME `user` already destructured from useUserRole() above - not a second call to that
  // hook), so this correctly reflects whichever account is currently signed in, and re-syncs
  // live if the user changes their Auto-Import toggle/folder on the new Settings tab without
  // requiring an app restart - AutoImportSettingsPanel.jsx calls the same
  // startEodbEmailAutoImportWatcher/stopEodbEmailAutoImportWatcher functions directly whenever
  // the toggle/folder changes, and this effect only handles the initial state on app launch.
  useEffect(() => {
    if (readonlyViewing) return undefined;
    let unsubscribe = () => {};
    let cancelled = false;
    async function initialize() {
      if (!user?.email) return;
      const settings = await getAutoImportSettings(user.email);
      if (cancelled) return;
      if (settings.enabled && settings.watchFolderPath) {
        unsubscribe = startEodbEmailAutoImportWatcher(settings.watchFolderPath, {
          onImported: () => queryClient.invalidateQueries({ queryKey: ["supervisor-report-tables"] })
        });
      }
    }
    initialize();
    return () => {
      cancelled = true;
      unsubscribe();
      stopEodbEmailAutoImportWatcher();
    };
  }, [queryClient, user?.email, readonlyViewing]);

  // Once a manually-triggered refresh settles (success/error/unreachable), soft-refresh
  // all currently-mounted data and record the timestamp. Deliberately does NOT reset the
  // shared hook's phase/lastAttempt back to idle - if the user has the details dialog
  // open, it should keep showing the real settled result, not revert to a misleading
  // "checking..." spinner. Only the transient inline bar/message (settledVisible, below)
  // fades on its own timer.
  //
  // FIX: uses invalidateDataQueries() here too, for the same reason as the onDataUpdated
  // handler above - a manual refresh settling is still just a data sync, not a reason to
  // re-verify the signed-in user's role and blank every RoleGuard-wrapped page in the app.
  const [settledVisible, setSettledVisible] = useState(false);
  useEffect(() => {
    if (phase !== "success" && phase !== "error" && phase !== "unreachable") return;
    if (phase !== "unreachable") {
      invalidateDataQueries(queryClient);
    }
    recentManualSettleRef.current = Date.now();
    if (phase === "success" && lastAttempt?.finishedAt) {
      recordDataRefresh(new Date(lastAttempt.finishedAt));
    }
    setSettledVisible(true);
    const timeout = setTimeout(() => setSettledVisible(false), REFRESH_SETTLE_DISPLAY_MS);
    return () => clearTimeout(timeout);
  }, [phase, lastAttempt, queryClient, recordDataRefresh]);

  useEffect(() => {
    const id = setInterval(() => forceTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  // Live count of "important" Workload cases (Escalated / Needs Review / Updated by Client) -
  // read independently of whether the Workload page itself is mounted, so this sidebar badge
  // stays accurate from anywhere in the app. Reuses the SAME importedTableStore.js /
  // workloadStatusColors.js already built for the Workload page - no duplicated storage/logic,
  // just re-reads the same "workload" report table. Refreshes on mount and on window focus/
  // visibility change, matching the same pattern already used by ReportDataTablesPanel.jsx and
  // the Workload page itself.
  const [importantWorkloadCount, setImportantWorkloadCount] = useState(0);

  const navigate = useNavigate();
  const { tasks } = useTasks();
  const chatUnread = useChatUnread();
  const [badgeNow, setBadgeNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setBadgeNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);
  const navBadgeCounts = {
    Workload: importantWorkloadCount,
    Tasks: countAttentionTasks(tasks, badgeNow),
    Messages: chatUnread
  };

  // Clicking a Windows reminder/message notification asks the window to open that item.
  useEffect(() => {
    const onNavigate = window.enquoteLocal?.navigation?.onNavigate;
    if (typeof onNavigate !== "function") return undefined;
    const off = onNavigate((route) => {
      if (typeof route !== "string" || !route.startsWith("/")) return;
      const [path, query] = route.split("?");
      const conversationId = path === "/Messages" ? new URLSearchParams(query).get("c") : null;
      if (conversationId && currentPageName !== "Messages" && canAccessPage(user, "Messages", accessPolicy)) openChatDock(conversationId);
      else navigate(route);
    });
    return typeof off === "function" ? off : undefined;
  }, [navigate, user, accessPolicy, currentPageName]);

  // On machines that hold the full Care Subscriptions import, keep the compact shared "active
  // Care" copy (what the Enphase Care page reads) in step with it. A no-op everywhere else.
  useEffect(() => {
    if (readonlyViewing) return;
    ensureActiveCareTable().catch(() => { /* best effort - the full table is untouched */ });
  }, [readonlyViewing]);
  useEffect(() => {
    let cancelled = false;
    async function loadImportantCount() {
      try {
        const workloadTable = await getReportTable("workload");
        if (cancelled) return;
        if (!workloadTable?.rows) { setImportantWorkloadCount(0); return; }
        // The Workload report is shared by everyone, so only count the signed-in person's own cases.
        const myName = getMyCaseOwnerName() || [user?.full_name, user?.name, user?.display_name]
          .find((candidate) => candidate && !String(candidate).includes("@")) || "";
        const myRows = filterRowsToMe(workloadTable.rows, { name: myName, email: user?.email });
        setImportantWorkloadCount(getUnseenImportantCount(myRows, getTiles()));
      } catch {
        if (!cancelled) setImportantWorkloadCount(0);
      }
    }
    loadImportantCount();
    function handleWorkloadVisibility() {
      if (document.visibilityState === "visible") loadImportantCount();
    }
    document.addEventListener("visibilitychange", handleWorkloadVisibility);
    window.addEventListener("focus", handleWorkloadVisibility);
    // Fires the instant a tile is clicked ANYWHERE in the app (see workloadPreferences.js's
    // markRowsSeen), so this sidebar badge clears in real time - not just on next mount/focus.
    const unsubscribeSeen = onSeenChanged(loadImportantCount);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleWorkloadVisibility);
      window.removeEventListener("focus", handleWorkloadVisibility);
      unsubscribeSeen();
    };
  }, [user?.email, user?.full_name]);

  // --- Collapsible sidebar (desktop only) + in-app zoom controls - per explicit request.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem("enquote_sidebar_collapsed") === "1"; } catch { return false; }
  });
  function toggleSidebarCollapsed() {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem("enquote_sidebar_collapsed", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }

  const [zoomFactor, setZoomFactorState] = useState(1);
  useEffect(() => {
    const bridge = globalThis.window?.enquoteLocal?.zoom;
    if (!bridge?.get) return;
    bridge.get().then((res) => { if (res?.ok) setZoomFactorState(res.zoomFactor); }).catch(() => {});
  }, []);
  // Developer Console (Shift+`) - deliberately checks event.code === "Backquote" (the
  // PHYSICAL key, independent of layout/shift state) combined with event.shiftKey, rather
  // than checking the backtick character via event.key - the latter would never fire,
  // since holding Shift while pressing the backtick key produces a tilde character on a
  // keyboard, not the backtick character. Discreet by design (no visible button anywhere).
  const [devConsoleOpen, setDevConsoleOpen] = useState(false);
  useEffect(() => {
    function handleDevConsoleKeydown(event) {
      if (readonlyViewing) return;
      if (event.code === "Backquote" && event.shiftKey) {
        setDevConsoleOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleDevConsoleKeydown);
    return () => window.removeEventListener("keydown", handleDevConsoleKeydown);
  }, [readonlyViewing]);

  // Global error capture - confirmed via a full-codebase search that NOTHING previously
  // caught uncaught JS errors or unhandled promise rejections anywhere in this app (only
  // React render errors were caught, by ErrorBoundary, and only console.error()'d - never
  // persisted anywhere). Wired here rather than inside ErrorBoundary since these two error
  // types happen OUTSIDE React's render cycle entirely, and ErrorBoundary cannot catch them
  // by design (that is a React-render-only mechanism).
  useEffect(() => {
    function handleWindowError(event) {
      recordError({ source: "window.onerror", message: event?.message, stack: event?.error?.stack });
    }
    function handleUnhandledRejection(event) {
      const reason = event?.reason;
      recordError({
        source: "unhandledrejection",
        message: reason?.message || String(reason),
        stack: reason?.stack
      });
    }
    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  async function handleZoomIn() {
    const bridge = globalThis.window?.enquoteLocal?.zoom;
    if (!bridge?.in) return;
    const res = await bridge.in();
    if (res?.ok) setZoomFactorState(res.zoomFactor);
  }
  async function handleZoomOut() {
    const bridge = globalThis.window?.enquoteLocal?.zoom;
    if (!bridge?.out) return;
    const res = await bridge.out();
    if (res?.ok) setZoomFactorState(res.zoomFactor);
  }
  async function handleZoomReset() {
    const bridge = globalThis.window?.enquoteLocal?.zoom;
    if (!bridge?.reset) return;
    const res = await bridge.reset();
    if (res?.ok) setZoomFactorState(res.zoomFactor);
  }

  const lastUpdatedLabel = formatLastUpdated(lastUpdated);
  const isStale = !!lastUpdated && (Date.now() - lastUpdated.getTime() > STALE_DATA_THRESHOLD_MS);

  // Whether the inline slim bar/message should currently be visible: always while a
  // check is actively running, and for a few seconds after it settles.
  const showInlineStatus = phase === "running" || (settledVisible && phase !== "idle");

  const refreshMessage = {
    running: "Checking for new data...",
    success: REFRESH_REASON_LABELS[lastAttempt?.reason] || "Refresh complete",
    error: REFRESH_REASON_LABELS[lastAttempt?.reason] || "Refresh failed - see details",
    unreachable: "Shared data source unavailable"
  }[phase] || null;

  // Starts the refresh in the background - no blocking confirmation, no page reload.
  // The inline slim progress bar (and, if opened, the details dialog) reflect progress;
  // an inline message reports the outcome when it settles.
  //
  // FIX: uses invalidateDataQueries() here too (the "no Electron bridge" fallback path),
  // for the same reason as both effects above.
  function handleRefreshApp() {
    if (readonlyViewing) {
      invalidateDataQueries(queryClient);
      return;
    }
    if (phase === "running") return;
    if (!hasBridge) {
      // No Electron bridge available (e.g. a plain browser preview) - there's nothing to
      // poll, so just soft-refresh whatever data source is active right now.
      invalidateDataQueries(queryClient);
      recordDataRefresh(new Date());
      toast.success("Data refreshed.");
      return;
    }
    setDetailsOpen(true);
    trigger();
  }

  function handleSwitchAccount() {
    if (readonlyViewing) return;
    const confirmed = window.confirm("Sign out and let someone else sign in on this PC?");
    if (!confirmed) return;
    logout();
  }

  function dismissAnnouncement(id) {
    setDismissedAnnouncementId(id);
    try { localStorage.setItem("enquote_dismissed_announcement_id", id); } catch { /* ignore */ }
  }

  return (
    <div className="min-h-screen bg-background" style={readonlyViewing ? {paddingTop: "6rem"} : undefined}>
      {/* Desktop Sidebar */}
      {isAuthenticated && (
      <aside style={readonlyViewing ? {top: "6rem"} : undefined} className={cn("hidden lg:fixed lg:inset-y-0 lg:flex lg:flex-col transition-[width] duration-300 ease-in-out", sidebarCollapsed ? "lg:w-20" : "lg:w-64")}>
        <div className="flex flex-col h-full bg-sidebar border-r border-sidebar-border overflow-hidden">
          {/* Logo + Theme Switcher */}
          <div className={cn("h-16 flex items-center border-b border-sidebar-border transition-all duration-300", sidebarCollapsed ? "justify-center gap-0 px-2" :"justify-between gap-2 px-6")}>
            {/* Real animated brand-mark treatment - built from the user's own actual Enphase
                GIF frames (150 frames, extracted and confirmed directly, not guessed). On
                expand: the mark draws itself in, then "EnQuote" types in beside it, mirroring
                the source GIF's own "mark draws in, ENPHASE types in" opening beat. On
                collapse: reversed - text erases first, then the mark shrinks away, exactly
                like the source GIF's own real ending sequence. Replaces the previous static
                <img>+text pair; SidebarLogoAnimation.jsx owns its own icon-to-text gap logic
                internally (same off-center-when-collapsed fix already applied elsewhere in
                this file), so no wrapping gap/width classes are needed here. */}
            <SidebarLogoAnimation collapsed={sidebarCollapsed} />
            <div className={cn("overflow-hidden transition-all duration-200", sidebarCollapsed ? "max-w-0 opacity-0" : "max-w-[3rem] opacity-100")}>
              <ThemeSwitcher iconOnly className="text-sidebar-foreground hover:bg-sidebar-accent shrink-0" />
            </div>
          </div>
          <button
            type="button"
            onClick={toggleSidebarCollapsed}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex items-center justify-center gap-2 border-b border-sidebar-border py-2 text-xs text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            {sidebarCollapsed ? (
              <ChevronsRight className="w-4 h-4" />
            ) : (
              <>
                <ChevronsLeft className="w-4 h-4 shrink-0" />
                <span className="overflow-hidden whitespace-nowrap transition-all duration-200 max-w-[6rem] opacity-100">
                  Collapse
                </span>
              </>
            )}
          </button>

          {/* Navigation - drag a tab to reorder it (a plain click still navigates). */}
          <nav className="flex-1 px-4 py-6 overflow-y-auto min-h-0">
          <DragDropContext onDragEnd={handleNavDragEnd}>
          <Droppable droppableId="sidebar-nav">
          {(dropProvided) => (
          <div ref={dropProvided.innerRef} {...dropProvided.droppableProps}>
            {visibleNavItems.map((item, index) => {
              const isActive = currentPageName === item.page;
              return (
                <Draggable key={item.page} draggableId={item.page} index={index}>
                {(dragProvided, dragSnapshot) => (
                <div
                  ref={dragProvided.innerRef}
                  {...dragProvided.draggableProps}
                  className="pb-1"
                >
                <Link
                  {...dragProvided.dragHandleProps}
                  to={createPageUrl(item.page)}
                  title={sidebarCollapsed ? `${item.name} (drag to reorder)` : "Drag to reorder"}
                  className={cn(
                    "relative flex items-center px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200",
                    sidebarCollapsed ? "justify-center gap-0 px-2" : "gap-3",
                    isActive
                      ? "bg-orange-50 text-orange-700"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                    dragSnapshot.isDragging && "bg-sidebar-accent text-sidebar-foreground shadow-lg ring-2 ring-orange-400/60"
                  )}
                >
                  <item.icon className={cn("w-5 h-5 shrink-0", isActive ? "text-orange-600" : "text-sidebar-foreground/40")} />
                  {/* Kept mounted, animated via max-width + opacity (see logo text above) so the
                      label slides/fades out instead of vanishing instantly when collapsing. The
                      gap is now ALSO conditional (see className above) - same off-center-icon
                      fix as the logo header: CSS gap reserves space between flex children even
                      when the label shrinks to max-w-0, which was pushing every nav icon left
                      of true-center while collapsed. */}
                  <span
                    className={cn(
                      "overflow-hidden whitespace-nowrap transition-all duration-200",
                      sidebarCollapsed ? "max-w-0 opacity-0" : "max-w-[10rem] opacity-100"
                    )}
                  >
                    {item.name}
                  </span>
                  {navBadgeCounts[item.page] > 0 && (
                    <span
                      className={cn(
                        "inline-flex items-center justify-center rounded-full bg-red-500 font-semibold text-white transition-all duration-200",
                        sidebarCollapsed ? "absolute -right-1 -top-1 h-4 min-w-[1rem] px-1 text-[10px]" : "ml-auto h-5 min-w-[1.25rem] px-1.5 text-xs"
                      )}
                    >
                      {navBadgeCounts[item.page] > 99 ? "99+" : navBadgeCounts[item.page]}
                    </span>
                  )}
                </Link>
                </div>
                )}
                </Draggable>
              );
            })}
            {dropProvided.placeholder}
          </div>
          )}
          </Droppable>
          </DragDropContext>
            {sidebarOrder && !sidebarCollapsed && (
              <button
                type="button"
                onClick={resetSidebarOrder}
                className="mt-2 w-full rounded-lg px-4 py-1.5 text-left text-xs text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              >
                Reset tab order
              </button>
            )}
          </nav>
          {/* Footer */}
          <div className="p-4 border-t border-sidebar-border space-y-3">
            {isLocalAuthActive && user?.email && (
              <div
                title={sidebarCollapsed ? `${user.full_name || user.email} - Switch account` : undefined}
                className={cn(
                  "rounded-xl bg-sidebar-accent transition",
                  sidebarCollapsed ? "flex w-full items-center justify-center p-0" : "w-full px-4 py-2.5"
                )}
              >
                {sidebarCollapsed ? (
                  readonlyViewing ? <UserAvatar email={user.email} name={user.full_name || user.email} /> : <ProfilePicturePicker email={user.email} name={user.full_name || user.email} compact />
                ) : (
                  <div className="flex items-center gap-3">
                    {readonlyViewing ? <UserAvatar email={user.email} name={user.full_name || user.email} size={42} /> : <ProfilePicturePicker email={user.email} name={user.full_name || user.email} />}
                    <button type="button" disabled={readonlyViewing} onClick={handleSwitchAccount} className="min-w-0 text-left">
                      <p className="text-xs text-muted-foreground">{readonlyViewing ? "Viewing as" : "Signed in as"}</p>
                      <p className="text-sm font-medium text-sidebar-foreground truncate">{user.full_name || user.email}</p>
                      <p className="text-xs text-primary mt-0.5">{readonlyViewing ? "Read-only viewing mode" : "Switch account"}</p>
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={handleRefreshApp}
                disabled={phase === "running"}
                title="Refresh App"
                className={cn(
                  "inline-flex items-center justify-center rounded-xl border border-sidebar-border bg-sidebar text-sm font-medium text-sidebar-foreground transition hover:bg-sidebar-accent disabled:cursor-not-allowed disabled:opacity-70",
                  sidebarCollapsed ? "mx-auto h-10 w-10 gap-0 p-0" : "w-full gap-2 px-3 py-2"
                )}
              >
                {/* Same off-center fix as the logo/nav items above - gap is now conditional,
                    zeroed while collapsed, so the icon sits genuinely centered in its 40px box
                    instead of shifted left by half the (invisible but still reserved) gap. */}
                <RefreshCw className={cn("w-4 h-4", phase === "running" && "animate-spin")} />
                <span
                  className={cn(
                    "overflow-hidden whitespace-nowrap transition-all duration-200",
                    sidebarCollapsed ? "max-w-0 opacity-0" : "max-w-[8rem] opacity-100"
                  )}
                >
                  Refresh App
                </span>
              </button>
              {/* Kept mounted, animated via max-height + opacity (rather than the earlier
                  {!sidebarCollapsed && (...)} pattern that unmounted this instantly) so this
                  whole block slides/fades away smoothly instead of popping in and out. */}
              <div className={cn("overflow-hidden transition-all duration-300 space-y-1.5", sidebarCollapsed ? "max-h-0 opacity-0" : "max-h-40 opacity-100")}>
                {/* Slim progress bar - indeterminate while checking, solid color once settled */}
                {showInlineStatus && (
                  <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        phase === "running" && "w-1/3 bg-orange-400 animate-refresh-slide",
                        phase === "success" && "w-full bg-emerald-500 transition-all",
                        (phase === "error" || phase === "unreachable") && "w-full bg-red-500 transition-all"
                      )}
                    />
                  </div>
                )}
                {showInlineStatus && refreshMessage && (
                  <p
                    className={cn(
                      "text-center text-[11px] font-medium leading-snug",
                      phase === "running" && "text-orange-500",
                      phase === "success" && "text-emerald-600",
                      (phase === "error" || phase === "unreachable") && "text-red-600"
                    )}
                  >
                    {refreshMessage}
                    {(phase === "error" || phase === "unreachable" || phase === "success") && (
                      <button
                        type="button"
                        onClick={() => setDetailsOpen(true)}
                        className="ml-1.5 underline decoration-dotted underline-offset-2 hover:text-sidebar-foreground"
                      >
                        Details
                      </button>
                    )}
                  </p>
                )}
                {!showInlineStatus && lastUpdatedLabel && (
                  <p className={cn("text-center text-[11px] leading-snug", isStale ? "text-amber-600" : "text-muted-foreground")}>
                    Data Last Updated: <span className="font-medium">{lastUpdatedLabel}</span>
                    {isStale && " (stale)"}
                  </p>
                )}
              </div>
            </div>
            <div className={cn("overflow-hidden transition-all duration-300", sidebarCollapsed ? "max-h-0 opacity-0" : "max-h-16 opacity-100")}>
              <div className="flex items-center justify-between gap-1 rounded-xl bg-sidebar-accent px-2 py-1.5">
                <button type="button" onClick={handleZoomOut} title="Zoom out (Ctrl -)" className="rounded-lg p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-border hover:text-sidebar-foreground">
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button type="button" onClick={handleZoomReset} title="Reset zoom (Ctrl 0)" className="flex-1 text-center text-xs font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground">
                  {Math.round(zoomFactor * 100)}%
                </button>
                <button type="button" onClick={handleZoomIn} title="Zoom in (Ctrl +)" className="rounded-lg p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-border hover:text-sidebar-foreground">
                  <ZoomIn className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className={cn("overflow-hidden transition-all duration-300", sidebarCollapsed ? "max-h-0 opacity-0" : "max-h-20 opacity-100")}>
              <div className="px-4 py-3 rounded-xl bg-sidebar-accent">
                <p className="text-xs text-muted-foreground">EnQuote Version</p>
                <p className="text-sm font-medium text-sidebar-foreground mt-0.5">v{appVersion}</p>
              </div>
            </div>
          </div>
        </div>
      </aside>
      )}
      {/* Mobile Header */}
      {isAuthenticated && (
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 h-16 bg-sidebar border-b border-sidebar-border flex items-center justify-between px-4">
        <div className="flex items-center gap-3 min-w-0">
          <img src={enquoteLogo} alt="EnQuote" className="w-9 h-9 rounded-xl object-contain shrink-0" />
          <span className="text-xl font-bold text-sidebar-foreground truncate">EnQuote</span>
          <ThemeSwitcher iconOnly className="text-sidebar-foreground hover:bg-sidebar-accent shrink-0" />
        </div>
      <div className="flex items-center gap-2">
        <div className="relative">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefreshApp}
            disabled={phase === "running"}
            aria-label="Refresh app"
            title={showInlineStatus ? refreshMessage : (lastUpdatedLabel ? `Data Last Updated: ${lastUpdatedLabel}` : "Refresh app")}
          >
            <RefreshCw className={cn("w-5 h-5", phase === "running" && "animate-spin")} />
          </Button>
          {showInlineStatus && (phase === "success" || phase === "error" || phase === "unreachable") && (
            <span
              className={cn(
                "absolute top-1 right-1 w-2 h-2 rounded-full ring-2 ring-sidebar",
                phase === "success" ? "bg-emerald-500" : "bg-red-500"
              )}
            />
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </Button>
      </div>
      </div>
      )}
      {/* Mobile Menu */}
      {isAuthenticated && mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-background pt-16">
          <nav className="p-4 space-y-1">
            {visibleNavItems.map((item) => {
              const isActive = currentPageName === item.page;
              return (
                <Link
                  key={item.page}
                  to={createPageUrl(item.page)}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-4 py-4 rounded-xl text-base font-medium transition-all",
                    isActive
                      ? "bg-orange-50 text-orange-700"
                      : "text-foreground/80 hover:bg-accent"
                  )}
                >
                  <item.icon className={cn("w-5 h-5", isActive ? "text-orange-600" : "text-muted-foreground")} />
                  {item.name}
                  {navBadgeCounts[item.page] > 0 && (
                    <span className="ml-auto inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-semibold text-white">
                      {navBadgeCounts[item.page] > 99 ? "99+" : navBadgeCounts[item.page]}
                    </span>
                  )}                </Link>
              );
            })}
          </nav>
        </div>
      )}
      {/* Main Content */}
      <main className={cn("transition-[padding] duration-300 ease-in-out", currentPageName === "SOPLibrary" && "flex h-dvh min-h-0 flex-col overflow-hidden", isAuthenticated && (sidebarCollapsed ? "lg:pl-20" : "lg:pl-64"), isAuthenticated && "pt-16 lg:pt-0")}>
        {announcement?.text && (announcement.level === "urgent" || dismissedAnnouncementId !== announcement.id) && (
          <div className={cn(
            "mx-4 mt-4 shrink-0 rounded-lg border px-4 py-3 text-sm shadow-sm",
            announcement.level === "urgent" ? "border-red-300 bg-red-50 text-red-900" :
              announcement.level === "warning" ? "border-amber-300 bg-amber-50 text-amber-900" :
                "border-blue-300 bg-blue-50 text-blue-900"
          )}>
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
              <div className="flex-1 whitespace-pre-wrap">{announcement.text}</div>
              {announcement.level !== "urgent" && (
                <button type="button" className="text-current opacity-70 hover:opacity-100" onClick={() => dismissAnnouncement(announcement.id)}>
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        )}
        <ErrorBoundary>
          {currentPageBlocked ? (
            <div className="flex min-h-[60vh] items-center justify-center p-6 text-center">
              <div>
                <h2 className="mb-2 text-2xl font-bold text-foreground">Access Not Granted</h2>
                <p className="text-muted-foreground">An administrator has not given you access to this tab.</p>
              </div>
            </div>
          ) : (
            <AutoAssignRole>
              {children}
            </AutoAssignRole>
          )}
        </ErrorBoundary>
      </main>
      <RefreshStatusDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        phase={phase}
        lastAttempt={lastAttempt}
        progress={progress}
        events={events}
        outboundStatus={outboundStatus}
        fetchOutboundStatus={fetchOutboundStatus}
      />
      {!readonlyViewing && <DeveloperConsole
        open={devConsoleOpen}
        onOpenChange={setDevConsoleOpen}
        syncEvents={events}
        currentUserEmail={user?.email}
        isCurrentUserAdmin={isAdmin}
      />}
      {!readonlyViewing && <NotificationBell />}
      {!readonlyViewing && <NewTaskButton />}
      {!readonlyViewing && <UpdateStatusBadge />}
      {!readonlyViewing && <UiUpdateBanner />}
    </div>
  );
}
