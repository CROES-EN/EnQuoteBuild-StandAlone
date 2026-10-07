import {useCallback, useEffect, useRef, useState} from "react";
import {Loader2, BookmarkPlus} from "lucide-react";
import {useQueryClient} from "@tanstack/react-query";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {gifsApi} from "@/features/profiles/profileApi";
import {getCurrentUserNamespace} from "@/lib/userScopedStorage";
import {chatApi} from "@/features/collab/collabApi";
import {customEmojiQueryKey} from "@/features/collab/customEmojis";
import {validCustomEmojiName} from "../../../shared/customEmojiRules.js";

export default function GiphyPicker({onPick, query = "", preview = false}) {
  const [items, setItems] = useState([]);
  const [nextOffset, setNextOffset] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [savingGif, setSavingGif] = useState(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const queryClient = useQueryClient();
  const requestId = useRef(0);
  const currentQuery = useRef(query);
  currentQuery.current = query;
  const load = useCallback(async ({offset = 0, append = false} = {}) => {
    const id = ++requestId.current;
    const owner = getCurrentUserNamespace();
    const current = () => id === requestId.current && query === currentQuery.current && owner === getCurrentUserNamespace();
    setLoading(true);
    setError("");
    try {
      const result = query.trim() ? await gifsApi.search({q: query.trim(), offset}) : await gifsApi.trending({offset});
      if (!current()) return;
      setItems(list => append ? [...list, ...result.gifs].filter((gif, index, all) =>
        all.findIndex(item => item.id === gif.id && item.url === gif.url) === index) : result.gifs);
      setNextOffset(result.nextOffset);
    } catch (failure) {
      if (current()) setError(failure.message || "Could not load GIFs.");
    } finally {
      if (current()) setLoading(false);
    }
  }, [query]);
  useEffect(() => {
    setItems([]);
    setNextOffset(null);
    setLoading(true);
    setError("");
    const timer = setTimeout(() => void load(), query ? 300 : 0);
    return () => {clearTimeout(timer); requestId.current++;};
  }, [query, load]);
  async function saveEmoji() {
    const owner = getCurrentUserNamespace();
    setSaving(true);
    setSaveError("");
    try {
      await chatApi.saveGifEmoji({gifId: savingGif.id, name});
      if (owner !== getCurrentUserNamespace()) return;
      await queryClient.invalidateQueries({queryKey: customEmojiQueryKey()});
      setSavingGif(null);
      toast.success("Animated GIF emoji added for everyone in EnQuote.");
    } catch (failure) {
      if (owner === getCurrentUserNamespace()) setSaveError(failure.message);
    } finally {
      if (owner === getCurrentUserNamespace()) setSaving(false);
    }
  }
  return <div className="space-y-2">
    {savingGif && <div className="space-y-2 rounded-md border border-border p-3">
      <p className="text-sm font-medium">Save GIF as a shared animated emoji</p>
      <img src={savingGif.url} alt={savingGif.title || "GIF preview"} className="h-16 w-16 object-contain" />
      <input aria-label="GIF emoji name" value={name} maxLength={32} disabled={saving}
        placeholder="emoji_name" onChange={event => setName(event.target.value)}
        className="w-full rounded-md border border-input bg-background p-2 text-sm" />
      <p className="text-xs text-muted-foreground">Use lowercase letters, numbers, underscores, or hyphens. Up to 512 KB; animation is preserved.</p>
      {saveError && <p role="alert" className="text-xs text-destructive">{saveError}</p>}
      <div className="flex gap-2"><Button size="sm" disabled={saving || !validCustomEmojiName(name)} onClick={() => void saveEmoji()}>
        {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Save emoji</Button>
        <Button size="sm" variant="ghost" disabled={saving} onClick={() => setSavingGif(null)}>Cancel</Button></div>
    </div>}
    {error && <div role="alert" className="text-xs text-destructive">{error}
      <button type="button" className="ml-2 underline" onClick={() => void load()}>Retry</button></div>}
    {loading && <p role="status" className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading GIFs...</p>}
    {!loading && !error && !items.length && <p className="text-xs text-muted-foreground">No matching GIFs.</p>}
    <div className="grid grid-cols-3 gap-2">
      {(preview ? items.slice(0, 6) : items).map(gif => <div key={`${gif.id}-${gif.url}`} className="min-w-0">
        <button type="button" aria-label={`Send GIF: ${gif.title || "GIF"}`}
          className="w-full overflow-hidden rounded-md bg-muted" onClick={() => onPick(gif)} title={gif.title}>
          <img src={gif.previewUrl || gif.url} alt={gif.title || "GIF"} loading="lazy" className="h-24 w-full object-cover" />
        </button>
        <button type="button" disabled={saving} aria-label={`Save GIF as emoji: ${gif.title || "GIF"}`}
          onClick={() => {setSavingGif(gif); setName(""); setSaveError("");}}
          className="flex w-full items-center justify-center gap-1 rounded py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground">
          <BookmarkPlus className="h-3 w-3" />Save as emoji
        </button>
      </div>)}
    </div>
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Powered by GIPHY</span>
      {!preview && nextOffset != null && <Button type="button" variant="outline" size="sm"
        onClick={() => void load({offset: nextOffset, append: true})} disabled={loading}>Load more</Button>}
    </div>
  </div>;
}
