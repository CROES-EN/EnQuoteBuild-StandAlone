import {useEffect, useMemo, useRef, useState} from "react";
import {Camera, Loader2, Trash2} from "lucide-react";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {Popover, PopoverContent, PopoverTrigger} from "@/components/ui/popover";
import {Slider} from "@/components/ui/slider";
import {cn} from "@/lib/utils";
import {profilesApi, useAvatar} from "@/features/profiles/profileApi";

const MAX_BYTES = 512 * 1024;

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
  const [preview, setPreview] = useState("");
  const [zoom, setZoom] = useState([1]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!file) {
      setPreview("");
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    try {
      await profilesApi.setAvatar(await cropAvatar(file, zoom[0] || 1));
      toast.success("Profile picture updated.");
      setFile(null);
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
      <PopoverContent align="start" className="w-80 space-y-3">
        <div>
          <p className="text-sm font-semibold">Profile picture</p>
          <p className="text-xs text-muted-foreground">Choose an image. EnQuote crops it square and uploads a 256px avatar.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative h-24 w-24 overflow-hidden rounded-full bg-muted">
            {preview ? <img src={preview} alt="" className="h-full w-full object-cover" style={{transform: `scale(${zoom[0] || 1})`}} /> : <UserAvatar email={email} name={name} size={96} />}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
            <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>Choose image</Button>
            {file && (
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
          <Button type="button" size="sm" onClick={upload} disabled={!file || busy} className="bg-orange-600 hover:bg-orange-700">
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Upload
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
