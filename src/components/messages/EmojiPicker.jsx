import {useRef, useState} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {Plus, Loader2, ArrowLeft} from "lucide-react";
import {toast} from "sonner";
import {chatApi} from "@/features/collab/collabApi";
import {customEmojiFile, customEmojiQueryKey, useCustomEmojis} from "@/features/collab/customEmojis";
import {getCurrentUserNamespace} from "@/lib/userScopedStorage";
import {clipboardImageFiles} from "@/features/collab/clipboardImages";
import {validCustomEmojiName, CUSTOM_EMOJI_TYPES} from "../../../shared/customEmojiRules.js";
import {CHAT_REACTIONS} from "../../../shared/chatReactionRules.js";
import CustomEmojiImage from "./CustomEmojiImage";
import ReactionIcon from "./ReactionIcon";
import {Button} from "@/components/ui/button";

export default function EmojiPicker({onCustom, onBuiltin, reactions = false, query, preview = false}) {
  const emojis = useCustomEmojis();
  const queryClient = useQueryClient();
  const input = useRef(null);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [image, setImage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const revision = useRef(0);
  const owner = getCurrentUserNamespace();
  async function chooseFile(file) {
    const request = ++revision.current;
    setError("");
    setImage("");
    setBusy(true);
    try {
      const value = await customEmojiFile(file);
      if (request === revision.current && owner === getCurrentUserNamespace()) {
        setImage(value);
        setName(file.name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 32));
      }
    } catch (failure) {if (request === revision.current) setError(failure.message);}
    finally {if (request === revision.current) setBusy(false);}
  }
  async function upload() {
    setBusy(true);
    setError("");
    try {
      await chatApi.uploadEmoji({name, dataUrl: image});
      if (owner !== getCurrentUserNamespace()) return;
      await queryClient.invalidateQueries({queryKey: customEmojiQueryKey()});
      setAdding(false);
      setImage("");
      setName("");
      toast.success("Custom emoji added for everyone in EnQuote.");
    } catch (failure) {if (owner === getCurrentUserNamespace()) setError(failure.message);}
    finally {if (owner === getCurrentUserNamespace()) setBusy(false);}
  }
  if (adding) return <div className="space-y-3" onPaste={event => {
    const files = clipboardImageFiles(event.clipboardData);
    if (!files.length || busy) return;
    event.preventDefault();
    event.stopPropagation();
    void chooseFile(files[0]);
  }}>
    <Button variant="ghost" size="sm" disabled={busy} onClick={() => setAdding(false)}><ArrowLeft className="mr-1 h-4 w-4" />Back to emojis</Button>
    <p className="text-sm">Add a shared emoji</p>
    <p className="text-xs text-muted-foreground">Upload or paste PNG, JPEG, WebP, or GIF. Up to 512 KB. Everyone can use it.</p>
    <input ref={input} type="file" accept={CUSTOM_EMOJI_TYPES.join(",")} className="hidden"
      onChange={event => {const file = event.target.files?.[0]; if (file) void chooseFile(file); event.target.value = "";}} />
    <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>Choose image</Button>
    {image && <img src={image} alt="Custom emoji preview" className="h-16 w-16 object-contain" />}
    <input aria-label="Custom emoji name" value={name} maxLength={32} disabled={busy}
      onChange={event => setName(event.target.value)} placeholder="emoji_name"
      className="w-full rounded-md border border-input bg-background p-2 text-sm" />
    <p className="text-xs text-muted-foreground">Name: lowercase letters, numbers, underscores, or hyphens.</p>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <Button disabled={busy || !image || !validCustomEmojiName(name)} onClick={() => void upload()}>
      {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Add emoji
    </Button>
  </div>;
  const term = (query ?? search).trim().toLowerCase();
  const custom = (emojis.data || []).filter(emoji => emoji.name.includes(term));
  const builtin = CHAT_REACTIONS.filter(item => `${item.label} ${item.id}`.toLowerCase().includes(term));
  const customButtons = (preview ? custom.slice(0, 6) : custom).map(emoji =>
    <button type="button" key={emoji.id} title={`:${emoji.name}:`} aria-label={`Use ${emoji.name}`}
      className="flex h-10 items-center justify-center rounded hover:bg-muted" onClick={() => onCustom(emoji)}>
      <CustomEmojiImage id={emoji.id} name={emoji.name} size={32} />
    </button>);
  const builtinButtons = builtin.map(item =>
    <button type="button" key={item.id} title={item.label} aria-label={`Use ${item.label}`}
      className="flex h-10 items-center justify-center rounded hover:bg-muted" onClick={() => onBuiltin(item)}>
      <ReactionIcon reaction={item.id} size={28} />
    </button>);
  return <div className="space-y-3">
    {query === undefined && <input aria-label="Search emojis" placeholder="Find an emoji" value={search} onChange={event => setSearch(event.target.value)}
      className="w-full rounded-md border border-input bg-background p-2 text-sm" />}
    <div className="flex items-center justify-between">{!preview && <span className="text-sm font-medium">Custom</span>}
      <Button size="sm" variant="ghost" onClick={() => {setAdding(true); setError("");}}><Plus className="mr-1 h-4 w-4" />Add emoji</Button></div>
    {emojis.isLoading && <p role="status" className="text-xs">Loading custom emojis...</p>}
    {emojis.isError && <div role="alert" className="text-xs text-destructive">{emojis.error.message}
      <button className="ml-2 underline" onClick={() => void emojis.refetch()}>Retry</button></div>}
    <div className="grid max-h-48 grid-cols-6 gap-1 overflow-y-auto">
      {preview && builtinButtons}
      {customButtons}
    </div>
    {!emojis.isLoading && !emojis.isError && !emojis.data?.length && <p className="text-xs text-muted-foreground">No custom emojis yet. Add the first one.</p>}
    {!preview && <><p className="text-sm font-medium">{reactions ? "Reactions" : "Emoji"}</p>
      <div className="grid grid-cols-6 gap-1">{builtinButtons}</div></>}
    {!emojis.isLoading && !emojis.isError && !custom.length && !builtin.length && <p className="text-xs text-muted-foreground">No matching emojis.</p>}
    {custom.some(emoji => emoji.sourceGifId) && <p className="text-[10px] text-muted-foreground">Powered by GIPHY</p>}
  </div>;
}
