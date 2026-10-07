import {format, isToday, isYesterday} from "date-fns";
import {Users} from "lucide-react";
import {UserAvatar} from "@/components/profile/UserAvatar";
import {displayName} from "./ConversationDialogs";
import {cn} from "@/lib/utils";

function formatListTime(value) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return "";
  if (isToday(time)) return format(time, "h:mm a");
  if (isYesterday(time)) return "Yesterday";
  return format(time, "MMM d");
}

export function conversationTitle(conversation, meEmail, names) {
  if (!conversation) return "";
  if (conversation.kind === "group") return conversation.name || "Group";
  const other = (conversation.members || []).find(member => member.email !== meEmail);
  return displayName(other?.email || meEmail, names);
}

export default function ConversationListItem({conversation, meEmail, names, active = false, onClick}) {
  const title = conversationTitle(conversation, meEmail, names);
  return (
    <button type="button" onClick={onClick} className={cn(
      "flex w-full items-start gap-2 rounded-md px-3 py-2 text-left transition-colors",
      active ? "bg-primary/10" : "hover:bg-muted"
    )}>
      {conversation.kind === "group" ? (
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Users className="h-4 w-4" /></span>
      ) : (
        <UserAvatar email={(conversation.members || []).find(member => member.email !== meEmail)?.email || meEmail} name={title} size={32} className="mt-0.5" />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className={cn("truncate text-sm text-foreground", conversation.unread > 0 ? "font-semibold" : "font-medium")}>{title}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{formatListTime(conversation.lastMessageAt || conversation.createdAt)}</span>
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-xs text-muted-foreground">
            {conversation.lastMessagePreview
              ? `${conversation.lastSender === meEmail ? "You" : displayName(conversation.lastSender, names)}: ${conversation.lastMessagePreview}`
              : "No messages yet"}
          </span>
          {conversation.unread > 0 && <span aria-label={`${conversation.unread} unread messages`} className="inline-flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-semibold text-white">{conversation.unread > 99 ? "99+" : conversation.unread}</span>}
        </span>
      </span>
    </button>
  );
}
