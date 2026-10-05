import {useCallback, useEffect, useState} from "react";
import {Link} from "react-router-dom";
import {Popover, PopoverContent, PopoverTrigger} from "@/components/ui/popover";
import {ArrowUpRight, Bell, X} from "lucide-react";
import {createPageUrl} from "@/utils";
import {clearAllNotifications, clearNotification, listNotifications, markAllRead} from "@/features/notifications/appNotifications";

// Formats a notification's timestamp using the VIEWING user's own browser locale -
// matches Layout.jsx's existing formatLastUpdated pattern exactly (date part follows
// OS/browser locale, time is always forced to 12-hour + AM/PM regardless of the
// system's 24-hour clock setting). Deliberately done HERE at render time, not baked
// into the message when the notification was originally generated (possibly on a
// different machine, possibly hours ago via the background sync) - this way the time
// shown always reflects whoever is currently looking at it, correctly.
function formatNotificationDateTime(isoString) {
  const date = new Date(isoString);
  const datePart = date.toLocaleDateString(undefined, { month: "2-digit", day: "2-digit" });
  const timePart = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });
  return `${datePart} ${timePart}`;
}

// Builds the display message for each notification type from its RAW stored data
// (quoteId, quoteNumber, changedBy/productName, occurredAt). Each branch requires its
// OWN key field to actually be present (n.quoteNumber, n.productName), not just the
// type matching - closes a confirmed real bug where an OLD notification record (created
// by an earlier version of this feature, storing a pre-baked `message` string instead
// of these raw fields) rendered as "undefined updated". Falls back to the legacy
// `message` field, or a generic label, for any such old/malformed record.
function formatNotificationMessage(n) {
  const time = formatNotificationDateTime(n.occurredAt);
  if (n.type === "task_due" && n.taskTitle) {
    return `Reminder: ${n.taskTitle}${n.quoteNumber ? ` (${n.quoteNumber})` : ""} - ${time}`;
  }
  if (n.type === "quote_updated" && n.quoteNumber) {
    return n.changedBy
      ? `${n.quoteNumber} updated by ${n.changedBy} - ${time}`
      : `${n.quoteNumber} updated - ${time}`;
  }
  if (n.type === "product_updated" && n.productName) {
    return `${n.productName} updated - ${time}`;
  }
  if (n.type === "quote_synced" && n.quoteNumber) {
    return `${n.quoteNumber} sent to Base44 - ${time}`;
  }
  return n.message || `Updated - ${time}`;
}

/**
 * Fixed top-right bell icon showing an unread-count badge for quote updates, product
 * updates, and quote-sent-to-Base44 events. Clicking it opens a popover listing recent
 * notifications newest-first, and marks everything as read (clearing the badge) - per
 * explicit request: "an unread badge that clears once opened", not a per-item dismiss
 * model for READ state. Each notification has its own "Clear" button (deletes just that
 * one, optimistically removed from view immediately) alongside "View Details" (quote
 * notifications only - jumps straight to the real quote via QuoteDetails.jsx's real
 * ?id=<quoteId> URL pattern).
 *
 * Placed in the app's own content area (fixed top-4 right-4), NOT inside the OS window
 * title bar - confirmed main.cjs's BrowserWindow does not set frame:false, so it uses
 * the standard OS-drawn title bar, which a web page cannot render inside. This mirrors
 * the exact same fixed-position overlay technique already used by UpdateStatusBadge.jsx
 * (bottom-4 right-4) - placed at top-4 instead so the two never overlap.
 */
export default function NotificationBell() {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const list = await listNotifications();
    setNotifications(list);
  }, []);

  useEffect(() => {
    load();
    // Light polling so the badge stays current even if the app is just sitting open -
    // scoped locally to this component rather than a new global timer.
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const badgeText = unreadCount === 0 ? null : unreadCount > 99 ? "99+" : String(unreadCount);

  async function handleOpenChange(nextOpen) {
    setOpen(nextOpen);
    if (nextOpen && unreadCount > 0) {
      await markAllRead();
      await load();
    } else if (nextOpen) {
      await load();
    }
  }

  // Optimistic: removes from local state immediately so the item visually disappears
  // without waiting on a round-trip, then fires the actual delete in the background
  // (errors swallowed - a failed delete must never re-show an item the user already
  // dismissed from their own view, and must never block the click itself).
  function handleClear(id) {
    setNotifications((prev) => prev.filter((item) => item.id !== id));
    clearNotification(id).catch(() => {});
  }

  // Same optimistic-then-background-delete pattern as handleClear above, applied to
  // every notification at once - empties the visible list immediately so there's no
  // perceived delay, then fires the actual bulk delete in the background. Errors are
  // swallowed for the same reason handleClear's are: a failed clear must never
  // re-populate a list the user already dismissed from their own view.
  function handleClearAll() {
    setNotifications([]);
    clearAllNotifications().catch(() => {});
  }

  return (
    <div className="fixed top-4 right-4 z-50">
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="relative flex items-center justify-center w-10 h-10 rounded-full bg-card border border-border shadow-lg hover:bg-accent transition"
            title="Notifications"
          >
            <Bell className="w-5 h-5 text-foreground" />
            {badgeText && (
              <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold">
                {badgeText}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 max-h-96 overflow-y-auto p-2">
          {notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground italic p-4 text-center">No notifications yet.</p>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-1 pb-1">
                <span className="text-xs font-medium text-muted-foreground">
                  {notifications.length} notification{notifications.length !== 1 ? "s" : ""}
                </span>
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3 h-3" />
                  Clear All
                </button>
              </div>
              {notifications.map((n) => (
                <div key={n.id} className="rounded-lg border border-border bg-card p-2.5 text-sm">
                  <p className="text-foreground break-words">{formatNotificationMessage(n)}</p>
                  <div className="flex items-center justify-end gap-3 mt-1">
                    <button
                      type="button"
                      onClick={() => handleClear(n.id)}
                      className="inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-3 h-3" />
                      Clear
                    </button>
                    {n.type === "task_due" && n.taskId && (
                      <Link
                        to={`/Tasks?task=${encodeURIComponent(n.taskId)}`}
                        onClick={() => setOpen(false)}
                        className="inline-flex items-center gap-0.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
                      >
                        View Task
                        <ArrowUpRight className="w-3 h-3" />
                      </Link>
                    )}
                    {n.quoteId && (
                      <Link
                        to={createPageUrl(`QuoteDetails?id=${n.quoteId}`)}
                        onClick={() => setOpen(false)}
                        className="inline-flex items-center gap-0.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
                      >
                        View Details
                        <ArrowUpRight className="w-3 h-3" />
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}