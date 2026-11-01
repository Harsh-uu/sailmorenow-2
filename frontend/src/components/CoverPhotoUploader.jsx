import { useEffect, useRef, useState } from "react";
import ReactCrop, { centerCrop, makeAspectCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { Icon } from "@/components/Icon";
import { toast } from "sonner";
import { normalizeImageFile } from "@/lib/imageCompress";

// Banner aspect used for the public profile hero (≈ 1024 x 224).
export const BANNER_ASPECT = 1024 / 224;
const OUT_W = 1024;
const OUT_H = Math.round(OUT_W / BANNER_ASPECT);

function centeredBannerCrop(w, h) {
  return centerCrop(makeAspectCrop({ unit: "%", width: 100 }, BANNER_ASPECT, w, h), w, h);
}

// Renders the pixel crop (from react-image-crop) to a fixed-size banner JPEG.
function cropToBanner(image, px) {
  const scaleX = image.naturalWidth / image.width;
  const scaleY = image.naturalHeight / image.height;
  const canvas = document.createElement("canvas");
  canvas.width = OUT_W;
  canvas.height = OUT_H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, OUT_W, OUT_H);
  ctx.drawImage(image, px.x * scaleX, px.y * scaleY, px.width * scaleX, px.height * scaleY, 0, 0, OUT_W, OUT_H);
  return canvas.toDataURL("image/jpeg", 0.82);
}

// Cover/banner photo uploader with a react-image-crop modal fixed to the public
// banner aspect ratio. Produces a cropped data URL via onChange.
export default function CoverPhotoUploader({ value, onChange }) {
  const input = useRef(null);
  const imgRef = useRef(null);
  const [raw, setRaw] = useState(null);
  const [crop, setCrop] = useState();
  const [completed, setCompleted] = useState(null);
  const [busy, setBusy] = useState(false);
  const [broken, setBroken] = useState(false);

  useEffect(() => { setBroken(false); }, [value]);
  const hasCover = Boolean(value) && !broken;

  const onFile = async (file) => {
    if (!file) return;
    const isImageLike = file.type.startsWith("image/") || /\.(heic|heif)$/i.test(file.name || "");
    if (!isImageLike) return toast.error("Please choose an image");
    try { file = await normalizeImageFile(file); }
    catch { return toast.error("We couldn't read that photo. Try a JPG or PNG."); }
    const reader = new FileReader();
    reader.onload = () => { setRaw(reader.result); setCrop(undefined); setCompleted(null); };
    reader.readAsDataURL(file);
    if (input.current) input.current.value = "";
  };

  const onImageLoad = (e) => {
    const { width, height } = e.currentTarget;
    setCrop(centeredBannerCrop(width, height));
  };

  const apply = async () => {
    if (!imgRef.current || !completed?.width) { toast.error("Drag to select the banner area first"); return; }
    setBusy(true);
    try {
      onChange(cropToBanner(imgRef.current, completed));
      setRaw(null);
    } catch { toast.error("Couldn't crop that image"); }
    finally { setBusy(false); }
  };

  return (
    <div data-testid="cover-uploader">
      <input ref={input} type="file" accept="image/*" className="hidden" data-testid="cover-input" onChange={(e) => onFile(e.target.files?.[0])} />

      {hasCover ? (
        <div>
          <div className="relative rounded-xl overflow-hidden ring-1 ring-slate-200 dark:ring-slate-700" style={{ aspectRatio: String(BANNER_ASPECT) }}>
            <img src={value} alt="Cover banner" data-testid="cover-current" onError={() => setBroken(true)} className="w-full h-full object-cover" />
          </div>
          <div className="flex gap-2 mt-2">
            <button type="button" onClick={() => input.current?.click()} data-testid="cover-change" className="rounded-full border border-slate-200 dark:border-slate-600 hover:border-[#55B3AD] px-4 py-1.5 text-sm font-semibold text-[#1F3F5B] dark:text-slate-200">Replace &amp; crop</button>
            <button type="button" onClick={() => onChange("")} data-testid="cover-remove" className="rounded-full px-4 py-1.5 text-sm font-semibold text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10">Remove</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => input.current?.click()} data-testid="cover-placeholder" aria-label="Upload a cover photo"
          className="w-full rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 hover:border-[#55B3AD] bg-slate-50 dark:bg-slate-800 flex flex-col items-center justify-center gap-1 text-slate-500 transition-colors"
          style={{ aspectRatio: String(BANNER_ASPECT) }}>
          <Icon name="org" tone="current" className="h-8 w-8 text-[#55B3AD]" />
          <span className="text-sm font-semibold">{broken ? "That image couldn't load — upload a new cover" : "Upload a cover photo"}</span>
        </button>
      )}

      {raw && (
        <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4" data-testid="cover-crop-modal">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-xl overflow-hidden shadow-xl">
            <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700">
              <h3 className="font-display font-bold text-lg smn-heading">Crop your cover photo</h3>
              <p className="text-xs text-slate-400">Drag the box to frame the banner that shows on your public profile.</p>
            </div>
            <div className="p-4 bg-slate-900 flex justify-center max-h-[60vh] overflow-auto">
              <ReactCrop crop={crop} onChange={(c) => setCrop(c)} onComplete={(c) => setCompleted(c)} aspect={BANNER_ASPECT} keepSelection>
                <img ref={imgRef} src={raw} alt="Crop source" onLoad={onImageLoad} style={{ maxHeight: "50vh" }} />
              </ReactCrop>
            </div>
            <div className="px-5 py-4 flex justify-end gap-2">
              <button type="button" onClick={() => setRaw(null)} data-testid="cover-crop-cancel" className="rounded-full px-4 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
              <button type="button" onClick={apply} disabled={busy} data-testid="cover-crop-save" className="rounded-full px-5 py-2 text-sm font-bold bg-[#F2A03B] hover:bg-[#d98c30] text-[#1F3F5B] disabled:opacity-50">{busy ? "Saving…" : "Apply crop"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
