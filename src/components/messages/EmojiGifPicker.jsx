import {useState} from "react";
import {ChevronRight, Search} from "lucide-react";
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs";
import EmojiPicker from "./EmojiPicker";
import GiphyPicker from "./GiphyPicker";

export default function EmojiGifPicker({onCustom, onBuiltin, onGif}) {
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const seeAll = (label, value) => <button type="button" onClick={() => setTab(value)}
    aria-label={`See all ${label}`} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
    See all<ChevronRight className="h-4 w-4" />
  </button>;
  const emojiProps = {query: search, onCustom, onBuiltin};
  return <Tabs value={tab} onValueChange={setTab}>
    <TabsList aria-label="Emoji and GIFs" className="w-full justify-start">
      <TabsTrigger value="all">All</TabsTrigger>
      <TabsTrigger value="emoji">Emoji</TabsTrigger>
      <TabsTrigger value="gif">GIFs</TabsTrigger>
    </TabsList>
    <div className="relative my-3">
      <input aria-label="Search emojis and GIFs" placeholder="Find something fun" value={search}
        onChange={event => setSearch(event.target.value)}
        className="w-full rounded-md border border-input bg-background py-2 pl-3 pr-9 text-sm outline-none focus:ring-2 focus:ring-ring" />
      <Search aria-hidden="true" className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
    </div>
    <div className="max-h-[min(60vh,32rem)] overflow-y-auto pr-1">
      <TabsContent value="all" className="space-y-4">
        <section aria-label="Emoji results">
          <div className="mb-1 flex items-center justify-between"><h3 className="text-sm font-semibold">Emoji</h3>{seeAll("emojis", "emoji")}</div>
          <EmojiPicker {...emojiProps} preview />
        </section>
        <section aria-label="GIF results">
          <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">GIFs</h3>{seeAll("GIFs", "gif")}</div>
          <GiphyPicker query={search} onPick={onGif} preview />
        </section>
      </TabsContent>
      <TabsContent value="emoji"><EmojiPicker {...emojiProps} /></TabsContent>
      <TabsContent value="gif"><GiphyPicker query={search} onPick={onGif} /></TabsContent>
    </div>
  </Tabs>;
}
