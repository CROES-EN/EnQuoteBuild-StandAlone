import {useState} from "react";
import {MoreVertical, SmilePlus} from "lucide-react";
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger} from "@/components/ui/dropdown-menu";
import {CHAT_REACTIONS} from "../../../shared/chatReactionRules.js";
import {displayName} from "./ConversationDialogs";
import {cn} from "@/lib/utils";
import ReactionIcon from "./ReactionIcon";
import {Popover, PopoverContent, PopoverTrigger} from "@/components/ui/popover";
import EmojiPicker from "./EmojiPicker";
import CustomEmojiImage from "./CustomEmojiImage";
import {useCustomEmojis} from "@/features/collab/customEmojis";
import {customReactionId, customEmojiIdFromReaction} from "../../../shared/customEmojiRules.js";

export default function MessageReactions({message, meEmail, names, mine, isChatAdmin, onReact, onRemove}) {
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const reactions = message.reactions || [];
  const catalog = useCustomEmojis(reactions.some(item => customEmojiIdFromReaction(item.emoji)));
  const selected = id => reactions.some(item => item.emoji === id && item.users.includes(meEmail));
  const react = async id => {
    if (busy) return;
    setBusy(true);
    try { await onReact(id, !selected(id)); }
    finally { setBusy(false); }
  };
  return (
    <>
      <div aria-label="Message actions" className={cn("absolute bottom-full right-0 z-10 pb-1",
        menuOpen || emojiOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none group-hover/message:opacity-100 group-hover/message:pointer-events-auto group-focus-within/message:opacity-100 group-focus-within/message:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto")}>
        <div className="flex items-center rounded-lg border border-border bg-card p-0.5 text-card-foreground shadow-md">
        {CHAT_REACTIONS.slice(0, 4).map(item => (
          <button key={item.id} type="button" aria-label={`React: ${item.label}`} aria-pressed={selected(item.id)} disabled={busy}
            title={item.label} onClick={() => void react(item.id)}
            className="flex h-9 w-9 items-center justify-center rounded-md text-xl hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ReactionIcon reaction={item.id} /></button>
        ))}
        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <PopoverTrigger asChild>
            <button type="button" disabled={busy} aria-label="More emoji reactions" title="Custom emoji reactions"
              className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <SmilePlus className="h-5 w-5" />
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align={mine ? "end" : "start"} className="w-80 max-w-[calc(100vw-1rem)]">
            <EmojiPicker reactions onCustom={emoji => {setEmojiOpen(false); void react(customReactionId(emoji.id));}}
              onBuiltin={emoji => {setEmojiOpen(false); void react(emoji.id);}} />
          </PopoverContent>
        </Popover>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Message options" title="More reactions and message options"
              className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><MoreVertical className="h-5 w-5" /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align={mine ? "end" : "start"}>
            {CHAT_REACTIONS.map(item => (
              <DropdownMenuItem key={item.id} disabled={busy} onSelect={() => void react(item.id)}><ReactionIcon reaction={item.id} size={20} /> {selected(item.id) ? "Remove" : "React:"} {item.label}</DropdownMenuItem>
            ))}
            {isChatAdmin && <><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive" onSelect={onRemove}>Remove message (admin)</DropdownMenuItem></>}
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>
      {reactions.length > 0 && <div className="mt-1 flex flex-wrap gap-1" aria-label="Message reactions">
        {reactions.map(reaction => {
          const customId = customEmojiIdFromReaction(reaction.emoji);
          const item = CHAT_REACTIONS.find(choice => choice.id === reaction.emoji) ||
            (customId ? {id: reaction.emoji, label: catalog.data?.find(emoji => emoji.id === customId)?.name || "Custom emoji"} : null);
          if (!item) return null;
          return <button key={reaction.emoji} type="button" disabled={busy} aria-pressed={selected(item.id)}
            aria-label={`${item.label}: ${reaction.users.length} reactions`}
            title={reaction.users.map(email => displayName(email, names)).join(", ")}
            onClick={() => void react(item.id)}
            className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs", selected(item.id)
              ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card text-card-foreground")}>
            {customId ? <CustomEmojiImage id={customId} name={item.label} size={16} /> : <ReactionIcon reaction={item.id} size={16} />}
            {reaction.users.length}</button>;
        })}
      </div>}
    </>
  );
}
