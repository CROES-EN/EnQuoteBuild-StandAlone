import {useEffect, useMemo, useRef, useState} from "react";
import {ArrowLeft, Camera, Loader2, Search, Trash2} from "lucide-react";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {Popover, PopoverContent, PopoverTrigger} from "@/components/ui/popover";
import {Slider} from "@/components/ui/slider";
import {cn} from "@/lib/utils";
import {profilesApi, useAvatar} from "@/features/profiles/profileApi";
import {downloadGiphyAvatar} from "@/features/profiles/giphyAvatar";
import GiphyPicker from "@/components/messages/GiphyPicker";
import {MAX_AVATAR_BYTES as MAX_BYTES, MAX_GIF_DIMENSION, gifAvatarError} from "../../../shared/avatarRules.js";

const isGif = (file) => file?.type === "image/gif" || /\.gif$/i.test(file?.name || "");

function initialsFor(email, name) {
  const source = String(name || email || "?").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0][0]}${parts.at(-1)[0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

async function loadImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function cropAvatar(file, zoom) {
  if (isGif(file)) {
    if (file.size > MAX_BYTES) throw new Error("GIF profile pictures must be 512 KB or smaller.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const error = gifAvatarError(bytes);
    if (error === "gif_dimensions_too_large") throw new Error(`GIF profile pictures must be ${MAX_GIF_DIMENSION}px or smaller on each side.`);
    if (error) throw new Error("That file is not a supported GIF image.");
    return {bytes, type: "image/gif"};
  }
  const image = await loadImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const sourceSize = Math.min(image.naturalWidth, image.naturalHeight) / zoom;
  const sx = (image.naturalWidth - sourceSize) / 2;
  const sy = (image.naturalHeight - sourceSize) / 2;
  ctx.drawImage(image, sx, sy, sourceSize, sourceSize, 0, 0, 256, 256);
  let blob = await canvasToBlob(canvas, "image/webp", 0.86);
  if (!blob || blob.size > MAX_BYTES) blob = await canvasToBlob(canvas, "image/jpeg", 0.82);
  if (!blob || blob.size > MAX_BYTES) throw new Error("Choose a smaller image.");
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type || "image/webp" };
}

export function UserAvatar({email, name, size = 36, className}) {
  const {url} = useAvatar(email);
  const initials = useMemo(() => initialsFor(email, name), [email, name]);
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-orange-100 text-sm font-semibold text-orange-700", className)}
      style={{width: size, height: size}}
      title={name || email}
    >
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : initials}
    </span>
  );
}


export function ProfilePicturePicker({email, name, compact = false}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [gif, setGif] = useState(null);
  const [browsingGifs, setBrowsingGifs] = useState(false);
  const [gifQuery, setGifQuery] = useState("");
  const [filePreview, setFilePreview] = useState("");
  const [zoom, setZoom] = useState([1]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!file) {
      setFilePreview("");
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (open) return;
    setBrowsingGifs(false);
    setGifQuery("");
    setGif(null);
    setFile(null);
  }, [open]);

  const preview = gif?.url || filePreview;
  const zoomable = Boolean(file && !isGif(file) && !gif);

  const upload = async () => {
    if (!file && !gif) return;
    setBusy(true);
    try {
      await profilesApi.setAvatar(gif ? await downloadGiphyAvatar(gif) : await cropAvatar(file, zoom[0] || 1));
      toast.success("Profile picture updated.");
      setFile(null);
      setGif(null);
      setOpen(false);
    } catch (error) {
      toast.error(error.message || "Could not update profile picture.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await profilesApi.removeAvatar();
      toast.success("Profile picture removed.");
      setFile(null);
      setGif(null);
    } catch (error) {
      toast.error(error.message || "Could not remove profile picture.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn("relative rounded-full", compact && "block")} title="Change profile picture">
          <UserAvatar email={email} name={name} size={compact ? 36 : 42} />
          {!compact && <span className="absolute -bottom-1 -right-1 rounded-full bg-orange-600 p-1 text-white"><Camera className="h-3 w-3" /></span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn("space-y-3", browsingGifs ? "w-96" : "w-80")}>
        {browsingGifs ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Back to profile picture" onClick={() => setBrowsingGifs(false)}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  autoFocus
                  aria-label="Search GIPHY"
                  value={gifQuery}
                  onChange={(event) => setGifQuery(event.target.value)}
                  placeholder="Search GIPHY"
                  className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-2 text-sm"
                />
              </div>
            </div>
            <div className="max-h-72 overflow-y-auto pr-1">
              <GiphyPicker
                query={gifQuery}
                allowSaveEmoji={false}
                pickLabel="Use as profile picture"
                onPick={(picked) => { setGif(picked); setFile(null); setBrowsingGifs(false); }}
              />
            </div>
          </div>
        ) : (
          <>
            <div>
              <p className="text-sm font-semibold">Profile picture</p>
              <p className="text-xs text-muted-foreground">Choose an image or animated GIF, or pick a GIF from GIPHY. Photos are cropped to 256px. GIFs keep their animation (512 KB max, 1024px per side).</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative h-24 w-24 overflow-hidden rounded-full bg-muted">
                {preview ? <img src={preview} alt="" className="h-full w-full object-cover" style={zoomable ? {transform: `scale(${zoom[0] || 1})`} : undefined} /> : <UserAvatar email={email} name={name} size={96} />}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <input
                  ref={inputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,.gif"
                  className="hidden"
                  onChange={(event) => { setFile(event.target.files?.[0] || null); setGif(null); event.target.value = ""; }}
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>Choose image</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setBrowsingGifs(true)}>GIPHY</Button>
                </div>
                {zoomable && (
                  <div className="space-y-1">
                    <p className="text-[11px] text-muted-foreground">Zoom</p>
                    <Slider value={zoom} min={1} max={3} step={0.05} onValueChange={setZoom} />
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-between gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={remove} disabled={busy}>
                <Trash2 className="mr-1 h-4 w-4" />Remove
              </Button>
              <Button type="button" size="sm" onClick={upload} disabled={(!file && !gif) || busy} className="bg-orange-600 hover:bg-orange-700">
                {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{gif ? "Use GIF" : "Upload"}
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}