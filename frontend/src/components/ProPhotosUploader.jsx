import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { compressImageToDataURL } from "@/lib/imageCompress";

/**
 * Boat Pro photo gallery uploader. Reads local files, auto-downscales each
 * (long-edge cap ladder 1600→1200→900 px + JPEG quality ladder 0.85→0.40)
 * to fit under the shared MAX_PHOTO_URL_CHARS limit, then PATCHes the array
 * to /api/boat-pros/photos. Renders up to 6 thumbnails with per-slot delete.
 *
 * Load state ("loading" | "ready" | "error"): a fetch failure keeps the
 * "Add photos" input disabled so a stale 401 can't PATCH an empty array
 * over an existing gallery.
 */
export default function ProPhotosUploader() {
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loadState, setLoadState] = useState("loading");
  const fileRef = useRef(null);

  useEffect(() => {
    api.get("/boat-pros/mine")
      .then(({ data }) => { setPhotos(data?.photos || []); setLoadState("ready"); })
      .catch((e) => {
        // 404 = user just doesn't have a listing yet, so uploads are fine.
        // Any other failure (401, 5xx) means we can't trust `photos` to
        // reflect the server, so lock the input to avoid wiping the gallery.
        if (e?.response?.status === 404) { setPhotos([]); setLoadState("ready"); }
        else setLoadState("error");
      });
  }, []);

  const save = async (next) => {
    setBusy(true);
    try {
      const { data } = await api.patch("/boat-pros/photos", { photos: next });
      setPhotos(data.photos || []);
      toast.success("Photos updated");
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to save"); }
    finally { setBusy(false); }
  };

  const onFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setBusy(true);
    try {
      const results = await Promise.all(files.map(async (f) => {
        if (!(f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name || ""))) {
          toast.error(`${f.name} isn't an image - skipped`);
          return null;
        }
        try {
          const r = await compressImageToDataURL(f);
          if (!r) {
            toast.error(`${f.name} couldn't be processed — skipped`);
            return null;
          }
          if (!r.ok) {
            toast.error(`${f.name} is too detailed to fit under the 400 KB cap — try cropping or a smaller shot`);
            return null;
          }
          return r.dataUrl;
        } catch {
          toast.error(`${f.name} couldn't be read`);
          return null;
        }
      }));
      const cleaned = results.filter(Boolean);
      if (!cleaned.length) return;
      const next = [...photos, ...cleaned].slice(0, 6);
      await save(next);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeAt = async (i) => save(photos.filter((_, idx) => idx !== i));

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6" data-testid="pro-photos-uploader">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Showcase photos</div>
          <div className="text-sm text-slate-500">Up to 6 photos — shown on your directory profile. Big camera shots are auto-compressed.</div>
          {loadState === "error" && (
            <div className="mt-2 text-xs font-semibold text-red-600" data-testid="pro-photos-load-error">
              Couldn&apos;t load your gallery — please refresh before uploading so we don&apos;t overwrite it.
            </div>
          )}
        </div>
        <label className={`inline-flex items-center gap-1 rounded-full px-4 py-2 text-sm font-semibold cursor-pointer ${photos.length >= 6 || busy || loadState !== "ready" ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-[#F2A03B] hover:bg-[#d9852b] text-white"}`}>
          <Icon name="upload" tone="current" className="h-3.5 w-3.5" /> {busy ? "Working…" : loadState === "loading" ? "Loading…" : "Add photos"}
          <input ref={fileRef} type="file" accept="image/*" multiple onChange={onFiles}
                 disabled={photos.length >= 6 || busy || loadState !== "ready"}
                 data-testid="pro-photos-file" className="hidden" />
        </label>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 6 }).map((_, i) => {
          const src = photos[i];
          return (
            <div key={i} className="relative aspect-square rounded-xl overflow-hidden bg-slate-100 flex items-center justify-center" data-testid={`pro-photo-slot-${i}`}>
              {src ? (
                <>
                  <img src={src} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                  <button onClick={() => removeAt(i)} data-testid={`pro-photo-remove-${i}`}
                          className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-red-600">
                    <Icon name="close" tone="current" className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <Icon name="image" tone="current" className="h-6 w-6 text-slate-300" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
