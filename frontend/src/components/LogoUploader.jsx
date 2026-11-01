import { useCallback, useEffect, useRef, useState } from "react";
import Cropper from "react-easy-crop";
import { Icon } from "@/components/Icon";
import { toast } from "sonner";
import { normalizeImageFile } from "@/lib/imageCompress";

// Square-crops an image to a JPEG data URL at `size`px using the pixel area
// react-easy-crop reports. White background so transparent PNGs don't go black.
async function cropToDataURL(src, area, size = 512) {
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = src;
  });
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.85);
}

// Logo picker with square crop + a live preview of the public rounded avatar.
export default function LogoUploader({ value, onChange }) {
  const input = useRef(null);
  const [raw, setRaw] = useState(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [areaPx, setAreaPx] = useState(null);
  const [busy, setBusy] = useState(false);
  const [broken, setBroken] = useState(false);

  // Reset the broken/error flag whenever a new value arrives so selecting a
  // fresh file clears any previous null/invalid state cleanly.
  useEffect(() => { setBroken(false); }, [value]);

  const hasLogo = Boolean(value) && !broken;

  const onFile = async (file) => {
    if (!file) return;
    const isImageLike = file.type.startsWith("image/") || /\.(heic|heif)$/i.test(file.name || "");
    if (!isImageLike) return toast.error("Please choose an image");
    try { file = await normalizeImageFile(file); }
    catch { return toast.error("We couldn't read that photo. Try a JPG or PNG."); }
    const reader = new FileReader();
    reader.onload = () => { setRaw(reader.result); setCrop({ x: 0, y: 0 }); setZoom(1); };
    reader.readAsDataURL(file);
    if (input.current) input.current.value = "";
  };

  const onCropComplete = useCallback((_area, px) => setAreaPx(px), []);

  const confirm = async () => {
    if (!raw || !areaPx) return;
    setBusy(true);
    try {
      const dataUrl = await cropToDataURL(raw, areaPx);
      onChange(dataUrl);
      setRaw(null);
    } catch { toast.error("Couldn't crop that image"); }
    finally { setBusy(false); }
  };

  return (
    <div data-testid="logo-uploader">
      <input ref={input} type="file" accept="image/*" className="hidden" data-testid="logo-input" onChange={(e) => onFile(e.target.files?.[0])} />

      {hasLogo ? (
        <div className="flex items-center gap-4">
          <img src={value} alt="Logo preview" data-testid="logo-current" onError={() => setBroken(true)}
            className="h-20 w-20 rounded-full object-cover ring-2 ring-slate-200 dark:ring-slate-600 bg-white" />
          <div className="flex flex-col gap-2">
            <span className="text-xs text-slate-400">This is how your logo appears publicly.</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => input.current?.click()} data-testid="logo-change" className="rounded-full border border-slate-200 dark:border-slate-600 hover:border-[#55B3AD] px-4 py-1.5 text-sm font-semibold text-[#1F3F5B] dark:text-slate-200">Change</button>
              <button type="button" onClick={() => onChange("")} data-testid="logo-remove" className="rounded-full px-4 py-1.5 text-sm font-semibold text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10">Remove</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => input.current?.click()} data-testid="logo-placeholder" aria-label="Upload a logo"
            className="h-20 w-20 shrink-0 rounded-full border-2 border-dashed border-slate-300 dark:border-slate-600 hover:border-[#55B3AD] bg-slate-50 dark:bg-slate-800 flex items-center justify-center transition-colors">
            <Icon name="org" tone="current" className="h-9 w-9 text-[#55B3AD]" />
          </button>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-slate-400">{broken ? "That image couldn't load — upload a new logo." : "No logo yet — we'll show your org icon publicly."}</span>
            <button type="button" onClick={() => input.current?.click()} data-testid="logo-pick" className="self-start rounded-full bg-[#55B3AD] hover:bg-[#489a94] text-white px-4 py-1.5 text-sm font-semibold inline-flex items-center gap-1.5">
              <Icon name="image-plus" tone="current" className="h-4 w-4" /> Upload a logo
            </button>
          </div>
        </div>
      )}

      {raw && (
        <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4" data-testid="logo-crop-modal">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md overflow-hidden shadow-xl">
            <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700">
              <h3 className="font-display font-bold text-lg smn-heading">Crop your logo</h3>
            </div>
            <div className="relative h-72 bg-slate-900">
              <Cropper image={raw} crop={crop} zoom={zoom} aspect={1} cropShape="round" showGrid={false}
                onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={onCropComplete} />
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="flex items-center gap-3">
                <Icon name="image" tone="current" className="h-4 w-4 text-slate-400" />
                <input type="range" min={1} max={3} step={0.01} value={zoom} data-testid="logo-zoom"
                  onChange={(e) => setZoom(Number(e.target.value))} className="flex-1 accent-[#55B3AD]" />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setRaw(null)} data-testid="logo-crop-cancel" className="rounded-full px-4 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
                <button type="button" onClick={confirm} disabled={busy} data-testid="logo-crop-save" className="rounded-full px-5 py-2 text-sm font-bold bg-[#F2A03B] hover:bg-[#d98c30] text-[#1F3F5B] disabled:opacity-50">{busy ? "Saving…" : "Use logo"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
