import {useEffect, useMemo, useRef, useState} from "react";
import {useAuth} from "@/lib/AuthContext";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Textarea} from "@/components/ui/textarea";
import {toast} from "sonner";
import {retroApi} from "./api";
import {FRIEND_MESSAGE, STARTER_HTML, buildRetroBackground, buildRetroPreview} from "./preview";
import {materializeProfile} from "./template";
import {describeTheme, themeSummary} from "./themeImport";
import {useProfilePictures} from "./Picture";
import {ProfilePicturePicker} from "@/components/profile/UserAvatar";
import {scopedKey} from "@/lib/userScopedStorage";
import {useLocation, useNavigate} from "react-router-dom";
import {ArrowLeft} from "lucide-react";
import {TOM_TRIBUTE} from "./tribute";
import {NavigationQuicklinks, ProfileActions} from "./Quicklinks";
import {chatApi} from "@/features/collab/collabApi";
import {openChatDock} from "@/features/collab/chatDockState";
import {useAccessPolicy} from "@/features/admin/adminApi";
import {canAccessPage} from "@/lib/rolePageAccess";

const DRAFT_KEY = "enquote_retro_draft_v1";
const MAX_FRIEND_TILES = 8;
const LOOKS = [["classic", "Classic blue"], ["gothic", "Clean Gothic"], ["theme", "My theme"]];
const TOM_PORTRAIT = "https://pbs.twimg.com/profile_images/1237550450/mstom_400x400.jpg";
const RETRO_THEME = {
  colorScheme: "light",
  "--foreground": "215 60% 23%",
  "--muted-foreground": "215 25% 40%",
  "--input": "213 30% 65%",
  "--secondary": "213 70% 94%",
  "--secondary-foreground": "215 60% 23%",
  "--theme-bg-secondary": "#ffffff",
  "--theme-input-bg": "#ffffff",
  "--theme-text-primary": "#16345d",
  "--theme-border": "#8ca9c3",
};

function initialDraft(user) {
  const fallback = {name: user?.name || user?.full_name || "My space", mood: "Feeling nostalgic", html: "", css: "", layout: "classic", picture: "", appearance: "classic", tagline: "My corner of the web.", location: "", about: "Welcome to my space!", meet: "", interests: "", music: "", movies: "", television: "", books: "", heroes: "", notes: ""};
  try {
    const draft = JSON.parse(localStorage.getItem(scopedKey(DRAFT_KEY)) || "null");
    return draft && ["name", "mood", "html", "css"].every((key) => typeof draft[key] === "string")
      ? {...fallback, ...draft, layout: draft.layout || (draft.html.trim() && draft.html !== STARTER_HTML ? "custom" : "classic"),
        appearance: draft.appearance || (draft.css.trim() ? "imported" : "classic")} : fallback;
  } catch (error) {
    console.warn("[retro] Could not restore local draft:", error.message);
    return fallback;
  }
}

export default function Base44_DTO() {
  const {user, isAuthenticated} = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const {policy} = useAccessPolicy();
  const canMail = canAccessPage(user, "Messages", policy);
  const [profiles, setProfiles] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [draft, setDraft] = useState(() => initialDraft(user));
  const [viewed, setViewed] = useState(null);
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [animate, setAnimate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const directoryRef = useRef(null);
  const searchRef = useRef(null);
  const selectionVersion = useRef(0);
  const ownerEmail = preview?.layout === "classic" ? String((editing ? user?.email : viewed?.email) || "").toLowerCase() : "";
  const friendProfiles = useMemo(() => ownerEmail ? profiles.filter((profile) => profile.email && profile.email.toLowerCase() !== ownerEmail).slice(0, MAX_FRIEND_TILES - 1) : [], [profiles, ownerEmail]);
  const {pictures, ready: picturesReady} = useProfilePictures(ownerEmail ? [ownerEmail, ...friendProfiles.map((profile) => profile.email)] : []);
  const avatar = pictures[ownerEmail] || "";
  const friends = useMemo(() => [{name: "Tom", picture: TOM_PORTRAIT, tom: true},
    ...friendProfiles.map((profile) => ({name: profile.name || profile.email, email: profile.email, picture: pictures[profile.email.toLowerCase()] || ""}))], [friendProfiles, pictures]);
  const pictureKey = [avatar.length, ...friends.map((friend) => friend.picture.length)].join(":");
  const source = useMemo(() => {
    if (!preview) return "";
    try {
      const profile = materializeProfile(preview, avatar, friends);
      return buildRetroPreview(profile.html, profile.css, animate, !editing, {friendLinks: Boolean(ownerEmail)});
    } catch (previewError) {
      console.warn("[retro] Could not render profile:", previewError.message);
      return buildRetroPreview("<p>Could not render this profile. Check the image URLs in Edit my space.</p>", "", false, !editing);
    }
  }, [preview, avatar, friends, animate, editing, ownerEmail]);
  const profileFrameRef = useRef(null);
  const openFriendRef = useRef(null);
  openFriendRef.current = (index) => {
    const friend = Number.isInteger(index) ? friends[index] : null;
    if (!friend) return;
    if (friend.tom) visitTom();
    else if (friend.email) void visit(friend.email);
  };
  useEffect(() => {
    // Friend Space tiles live in the sandboxed profile frame; only trust tile indexes posted by that frame.
    function onMessage(event) {
      if (!profileFrameRef.current || event.source !== profileFrameRef.current.contentWindow || event.data?.type !== FRIEND_MESSAGE) return;
      openFriendRef.current?.(event.data.index);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  const [draftError, setDraftError] = useState("");
  const customLayout = draft.layout === "custom";
  const themeInfo = useMemo(() => customLayout ? {kind: "empty"} : describeTheme(draft.css), [draft.css, customLayout]);
  const hasTheme = themeInfo.kind === "theme";
  const look = draft.appearance === "gothic" ? "gothic" : hasTheme && draft.appearance?.startsWith("imported") ? "theme" : "classic";
  function applyTheme(code) {
    const info = describeTheme(code);
    setDraft((current) => ({...current, layout: "classic", css: code,
      appearance: info.kind !== "theme" ? (current.appearance === "gothic" ? "gothic" : "classic") : current.appearance === "imported-raw" ? "imported-raw" : "imported"}));
  }
  async function pasteTheme() {
    try {
      const code = await navigator.clipboard.readText();
      if (!code.trim()) throw new Error("empty");
      applyTheme(code);
    } catch {
      toast.error("Couldn't read the clipboard. Click the theme box and press Ctrl+V instead.");
    }
  }
  useEffect(() => {
    if (!editing) return undefined;
    const timer = setTimeout(() => {
      try {
        materializeProfile(draft);
        setDraftError("");
        setPreview({...draft});
      } catch (previewError) {
        setDraftError(previewError.message);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [draft, editing]);
  const backgroundSource = useMemo(() => preview ? buildRetroBackground(preview.html, preview.css) : "", [preview]);
  const visibleProfiles = profiles.filter((profile) => `${profile.name} ${profile.email} ${profile.mood}`.toLowerCase().includes(search.trim().toLowerCase()));
  const canMessage = canMail && Boolean(viewed?.email) && viewed.email !== user?.email && !editing;
  const isOwnProfileView = !editing && Boolean(preview) && viewed?.email === user?.email;
  function editOwnProfile() {
    if (viewed.layout === "classic") {
      setDraft({...viewed});
      setEditing(true);
    } else editDraft();
  }
  function browse(focusSearch = false) {
    if (!directoryRef.current) return;
    directoryRef.current.open = true;
    directoryRef.current.scrollIntoView({block: "nearest"});
    if (focusSearch) searchRef.current?.focus();
  }
  function home() {
    selectionVersion.current++;
    setEditing(false);
    setPreview(null);
    setViewed(null);
    setLoadingProfile(false);
    setSearch("");
  }
  async function messageProfile() {
    if (!canMessage || sending) return;
    const version = selectionVersion.current;
    setSending(true);
    try {
      const conversation = await chatApi.openDm(viewed.email);
      if (!conversation?.id) throw new Error("Could not open that conversation.");
      if (version === selectionVersion.current) openChatDock(conversation.id);
    } catch (messageError) {
      toast.error(messageError.message);
    } finally {
      setSending(false);
    }
  }
  function closeSpace() {
    selectionVersion.current++;
    const returnTo = location.state?.returnTo;
    navigate(typeof returnTo === "string" && returnTo.startsWith("/") && !returnTo.startsWith("//") &&
      returnTo.split(/[?#]/)[0] !== "/Base44_DTO" ? returnTo : "/Dashboard", {replace: true});
  }
  function visitTom() {
    selectionVersion.current++;
    setLoadingProfile(false);
    setError("");
    setEditing(false);
    setAnimate(false);
    setViewed(TOM_TRIBUTE);
    setPreview(TOM_TRIBUTE);
  }

  async function loadDirectory(nextCursor = null) {
    setBusy(true);
    setError("");
    try {
      const result = await retroApi.list(nextCursor);
      setProfiles((current) => nextCursor ? [...new Map([...current, ...result.profiles].map((profile) => [profile.email, profile])).values()] : result.profiles);
      setCursor(result.cursor);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (isAuthenticated) void loadDirectory();
    return () => { selectionVersion.current++; };
  }, [isAuthenticated]);
  useEffect(() => {
    const timer = setTimeout(() => {
      try { localStorage.setItem(scopedKey(DRAFT_KEY), JSON.stringify(draft)); }
      catch (saveError) { toast.error(`Could not save your local draft: ${saveError.message}`); }
    }, 750);
    return () => clearTimeout(timer);
  }, [draft]);

  async function visit(email) {
    const version = ++selectionVersion.current;
    setLoadingProfile(true);
    setError("");
    setPreview(null);
    setAnimate(false);
    setEditing(false);
    try {
      const {profile} = await retroApi.get(email);
      if (version !== selectionVersion.current) return;
      setViewed(profile);
      setPreview(profile);
    } catch (loadError) {
      if (version === selectionVersion.current) setError(loadError.message);
    } finally {
      if (version === selectionVersion.current) setLoadingProfile(false);
    }
  }
  function editDraft() {
    let nextPreview;
    try { nextPreview = materializeProfile(draft); }
    catch (previewError) { toast.error(previewError.message); }
    selectionVersion.current++;
    setLoadingProfile(false);
    setEditing(true);
    setPreview(nextPreview ? {...draft} : null);
    setAnimate(false);
  }
  async function publish() {
    setBusy(true);
    try {
      const compiled = materializeProfile(draft);
      const {profile} = await retroApi.save({...draft, html: compiled.html});
      setViewed(profile);
      setPreview(profile);
      setEditing(false);
      toast.success("Your retro profile is shared with the team.");
      await loadDirectory();
    } catch (saveError) {
      toast.error(saveError.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!window.confirm("Remove your shared retro profile? Your local draft will stay on this PC.")) return;
    setBusy(true);
    try {
      await retroApi.remove();
      setProfiles((current) => current.filter((profile) => profile.email !== user.email));
      setViewed(null);
      setPreview(null);
      toast.success("Shared retro profile removed.");
    } catch (removeError) {
      toast.error(removeError.message);
    } finally {
      setBusy(false);
    }
  }
  if (!isAuthenticated) return <p className="p-6">Sign in to visit retro profiles.</p>;
  return (
    <div style={RETRO_THEME} className={`relative isolate min-h-screen px-2 py-3 text-[#16345d] sm:px-4 [&_input]:bg-[#ffffff] [&_textarea]:bg-[#ffffff] ${preview && !editing ? "bg-transparent" : "bg-[#e5efff]"}`}>
      <div className={`relative z-10 mx-auto w-full ${preview && !editing ? "max-w-[1100px]" : "max-w-[1000px]"}`}>
      <header className="w-full border border-[#76a4de] bg-[#022e90] px-3 py-2 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="w-[220px] max-w-full">
            <img src={`${import.meta.env.BASE_URL}Base44_DTO.png`} alt="A place for friends" width="1024" height="379" className="block h-auto w-full" />
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            {isOwnProfileView && <Button size="sm" variant="secondary" onClick={editOwnProfile}>Edit my profile</Button>}
            {!editing && preview && viewed?.email && viewed.email !== user.email && <ProfileActions name={viewed.name} onMessage={messageProfile} canMessage={canMessage} sending={sending} />}
            <Button size="sm" variant="secondary" onClick={closeSpace}><ArrowLeft className="mr-2 h-4 w-4" />Back to EnQuote</Button>
          </div>
        </div>
        <details open={preview && !editing ? undefined : true} key={preview && !editing ? "profile-tools" : "editing-tools"} className="mt-2">
        <summary className="cursor-pointer text-xs">Profile tools</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={editDraft}>Edit my space</Button>
          <Button size="sm" variant="secondary" disabled={loadingProfile} onClick={() => visit(user.email)}>View my page</Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => loadDirectory()}>Refresh friends</Button>
          <Button size="sm" variant="secondary" asChild><a href="https://layouts.spacehey.com/" target="_blank" rel="noopener noreferrer">Browse coded themes</a></Button>
          {profiles.some((profile) => profile.email === user.email) && <Button size="sm" variant="secondary" disabled={busy} onClick={remove}>Remove my shared page</Button>}
        </div>
        {preview && !editing && <div className="mt-2 flex gap-2"><Button size="sm" variant="secondary" onClick={() => setAnimate((value) => !value)}>{animate ? "Pause CSS animations" : "Enable CSS animations"}</Button><Button size="sm" variant="secondary" onClick={() => setPreview(null)}>Stop preview</Button></div>}
        </details>
        <NavigationQuicklinks onHome={home} onBrowse={() => browse()} onSearch={() => browse(true)}
          onMail={() => navigate("/Messages")} canMail={canMail} />
      </header>
      {error && <div role="alert" className="mb-4 rounded border border-red-400 bg-white p-3 text-red-800">{error}</div>}
      <div className={preview && !editing ? "" : "space-y-3"}>
        <details aria-label="Profile directory" ref={directoryRef} key={preview ? "viewing" : "browsing"} open={preview ? undefined : true} className={`border border-[#76a4de] bg-white ${preview && !editing ? "hidden [&[open]]:block" : ""}`}>
          <summary className="cursor-pointer bg-[#ffdbb6] px-3 py-2 text-sm font-bold">Your friends&apos; spaces</summary>
          <div className="p-3">
          <Input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search loaded profiles" aria-label="Search retro profiles" className="mb-2" />
          {busy && <p className="text-sm">Loading...</p>}
          {!busy && !profiles.length && <p className="text-sm">Be the first to publish a profile!</p>}
          <ul className="grid max-h-64 gap-2 overflow-auto sm:grid-cols-2 lg:grid-cols-3">
            {("tom fictional tribute".includes(search.trim().toLowerCase())) && <li><button className="w-full border border-[#b1cbea] bg-[#fff4da] p-2 text-left hover:bg-[#ffe6bc]" onClick={visitTom}>
              <strong className="block">Tom</strong><span className="block text-xs">Your first friend · fictional tribute</span>
            </button></li>}
            {visibleProfiles.map((profile) => <li key={profile.email}><button className="w-full border border-[#b1cbea] p-2 text-left hover:bg-[#e5efff]" onClick={() => visit(profile.email)}>
              <strong className="block truncate">{profile.name}</strong><span className="block truncate text-xs">{profile.mood}</span>
            </button></li>)}
          </ul>
          {!busy && search.trim() && !visibleProfiles.length && !("tom fictional tribute".includes(search.trim().toLowerCase())) &&
            <p className="text-sm">No loaded profiles match your search.</p>}
          {cursor && <Button className="mt-3" disabled={busy} onClick={() => loadDirectory(cursor)}>More friends</Button>}
          </div>
        </details>
        <section className="min-w-0 space-y-3">
          {editing && <div className="space-y-4 border-2 border-[#76a4de] bg-white p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-bold">Customize my space</h2>
              <p className="text-xs text-[#4a6286]">The preview updates as you type. Changes stay on this PC until you publish.</p>
            </div>
            {!customLayout && <section aria-label="Choose a look" className="space-y-3 rounded border border-[#b1cbea] bg-[#f6faff] p-3">
              <h3 className="text-sm font-bold">1. Choose a look</h3>
              <div className="flex flex-wrap gap-2">
                {LOOKS.map(([value, label]) => <Button key={value} type="button" size="sm" aria-pressed={look === value} variant="outline"
                  className={look === value ? "border-[#2f5f9e] bg-[#2f5f9e] text-white hover:bg-[#244b7e] hover:text-white" : ""} disabled={value === "theme" && !hasTheme}
                  onClick={() => setDraft({...draft, appearance: value === "theme" ? (draft.appearance === "imported-raw" ? "imported-raw" : "imported") : value})}>{label}</Button>)}
              </div>
              <div className="space-y-2 rounded border border-dashed border-[#76a4de] bg-white p-3 text-sm">
                <p className="font-bold">Use a theme from SpaceHey</p>
                <ol className="list-decimal space-y-0.5 pl-5 text-xs">
                  <li><a href="https://layouts.spacehey.com/" target="_blank" rel="noopener noreferrer" className="font-bold underline">Browse layouts</a> and open one you like.</li>
                  <li>Copy all of the code in its code box.</li>
                  <li>Click <strong>Paste theme</strong> (or paste into the box below).</li>
                </ol>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={pasteTheme}>Paste theme</Button>
                  {hasTheme && <Button type="button" size="sm" variant="outline" onClick={() => applyTheme("")}>Remove theme</Button>}
                </div>
                <Textarea aria-label="Theme code" placeholder="Or paste the theme code here with Ctrl+V" className="h-20 font-mono text-xs" spellCheck={false}
                  value={draft.css} onChange={(event) => applyTheme(event.target.value)} />
                {themeInfo.kind === "theme" && <p role="status" className="text-xs text-green-800">{"\u2713 "}{themeSummary(themeInfo)}</p>}
                {themeInfo.kind === "link" && <p role="status" className="text-xs text-red-700">That&apos;s a link to the layout. Open it, copy the code inside its code box, and paste that instead.</p>}
                {themeInfo.kind === "notCode" && <p role="status" className="text-xs text-red-700">This doesn&apos;t look like theme code. Copy everything in the layout&apos;s code box and paste it again.</p>}
                {look === "theme" && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.appearance !== "imported-raw"}
                  onChange={(event) => setDraft({...draft, appearance: event.target.checked ? "imported" : "imported-raw"})} />Tidy the theme up so text stays readable (recommended)</label>}
                <p className="text-xs text-[#4a6286]">Respect the layout author&apos;s credit and reuse terms. Theme videos, music, scripts, and web fonts don&apos;t play here.</p>
              </div>
            </section>}
            <section aria-label="About you" className="space-y-3 rounded border border-[#b1cbea] bg-[#f6faff] p-3">
              <h3 className="text-sm font-bold">{customLayout ? "About you" : "2. About you"}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {!customLayout && <div className="text-sm sm:col-span-2 flex items-center gap-3"><ProfilePicturePicker email={user.email} name={draft.name} /><p className="text-xs">Click your picture to change it. It&apos;s your EnQuote profile picture, so it shows everywhere.</p></div>}
                <label className="block text-sm">Display name<Input value={draft.name} maxLength={80} onChange={(event) => setDraft({...draft, name: event.target.value})} /></label>
                <label className="block text-sm">Mood<Input value={draft.mood} maxLength={120} onChange={(event) => setDraft({...draft, mood: event.target.value})} /></label>
                {!customLayout && ["tagline", "location", "about", "meet", "interests", "music", "movies", "television", "books", "heroes", "notes"].map((field) => <label key={field} className="text-sm">{({
                  tagline: "Profile headline", location: "Location / intro", about: "About me",
                  meet: "Who I'd like to meet", interests: "General interests", television: "TV"
                })[field] || field[0].toUpperCase() + field.slice(1)}<Textarea maxLength={8000} value={draft[field] || ""} onChange={(event) => setDraft({...draft, [field]: event.target.value})} /></label>)}
              </div>
            </section>
            <details open={customLayout ? true : undefined} className="rounded border border-[#b1cbea] p-3">
              <summary className="cursor-pointer text-sm font-bold">Advanced</summary>
              <div className="mt-2 space-y-3">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label="Use fully custom HTML" checked={customLayout}
                  onChange={(event) => setDraft({...draft, layout: event.target.checked ? "custom" : "classic"})} />Build the whole page from my own HTML and CSS</label>
                {customLayout && <><p className="text-xs">Up to 64 KB. Scripts, forms, embeds, and navigation are disabled. HTTPS images and GIFs may contact their host.</p>
                <div className="grid gap-3 xl:grid-cols-2">
                  <label className="text-sm">HTML<Textarea className="h-64 font-mono text-xs" value={draft.html} onChange={(event) => setDraft({...draft, html: event.target.value})} spellCheck={false} /></label>
                  <label className="text-sm">CSS<Textarea className="h-64 font-mono text-xs" value={draft.css} onChange={(event) => setDraft({...draft, css: event.target.value})} spellCheck={false} /></label>
                </div></>}
                {viewed?.email === user.email && <Button size="sm" variant="outline" onClick={() => setDraft({...viewed, layout: "custom"})}>Start from my published code</Button>}
              </div>
            </details>
            {draftError && <p role="alert" className="text-sm text-red-700">{draftError}</p>}
            <div className="flex flex-wrap gap-2"><Button disabled={busy || !draft.name.trim() || Boolean(draftError)} onClick={publish}>Publish my page</Button></div>
          </div>}
          {(loadingProfile || (preview && !picturesReady)) && <p>Loading profile...</p>}
          {preview && picturesReady ? <div className="mx-auto w-full">
            {editing && <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-bold">Draft preview</h2>
              <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setAnimate((value) => !value)}>              {animate ? "Pause CSS animations" : "Enable CSS animations"}</Button></div>
            </div>}
            <iframe ref={profileFrameRef} key={pictureKey} title="Isolated retro profile preview" sandbox={ownerEmail ? "allow-scripts" : ""} referrerPolicy="no-referrer" srcDoc={source} className={`block w-full border-0 ${editing ? "bg-white h-[600px]" : "bg-transparent h-[calc(100vh-180px)] min-h-[400px]"}`} />
          </div> : !loadingProfile && !preview && <div className="border-2 border-[#76a4de] bg-white p-10 text-center"><h2 className="text-xl font-bold">You&apos;ve found the secret space.</h2><p>Visit a friend or customize your own profile.</p></div>}
        </section>
      </div>
      </div>
      {preview && !editing && <iframe title="Profile theme background" aria-hidden="true" tabIndex={-1} sandbox="" referrerPolicy="no-referrer" srcDoc={backgroundSource} className="pointer-events-none fixed inset-0 z-0 h-screen w-screen border-0" />}
    </div>
  );
}
