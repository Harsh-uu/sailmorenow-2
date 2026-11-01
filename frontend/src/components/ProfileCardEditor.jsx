import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { resizeImageToDataURL } from "@/lib/imageCompress";
import CropModal from "@/components/CropModal";
import { ICON_BOAT_PROS } from "@/lib/api";

const BANNER_ASPECT = 1024 / 224;
const GALLERY_ASPECT = 2.5; // 5:2 — shared by crop frame, editor tile and public thumbnail (see PhotoGallery.jsx)
const ACCEPT = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE = 15 * 1024 * 1024;

const TARGET_LABEL = { logo: "Logo", cover: "Cover photo" };
const cfgFor = (t) => (t === "logo"
  ? { aspect: 1, cropShape: "round", title: "Crop logo" }
  : t === "cover"
    ? { aspect: BANNER_ASPECT, cropShape: "rect", title: "Crop cover photo" }
    : { aspect: GALLERY_ASPECT, cropShape: "rect", title: "Crop photo" });

// Edit-in-place profile card: tap the logo, banner, or a gallery slot to upload /
// crop / remove. Every upload goes through crop-before-save and auto-saves.
export default function ProfileCardEditor({ data, maxPhotos, accent, onImageChange, showCover = true, showLogo = true, badgeLabel, coverAspect = BANNER_ASPECT, cropObjectFit = "contain", galleryLocked = false, onContactUs, entityKind }) {
  const fileInput = useRef(null);
  const uploadTarget = useRef(null);
  const [menu, setMenu] = useState(null);          // target: 'logo' | 'cover' | number
  const [crop, setCrop] = useState(null);          // { target, source, original }
  const [busy, setBusy] = useState({});            // { [key]: true }
  const [errors, setErrors] = useState({});        // { [key]: { msg, retry } }
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [previews, setPreviews] = useState({});       // { [key]: dataUrl } optimistic

  const photos = data.photos || [];
  const coverRecW = 1600;
  const coverRecH = Math.round(coverRecW / (coverAspect || BANNER_ASPECT));
  const keyOf = (t) => (typeof t === "number" ? `g${t}` : t);

  // Upload one image (data URL) to object storage, return its /api/files URL.
  // Keeps the listing save tiny (URLs only) so it never trips the size cap.
  const uploadImage = async (dataUrl) => {
    const blob = await (await fetch(dataUrl)).blob();
    const ok = ["image/jpeg", "image/png", "image/webp"];
    const type = ok.includes(blob.type) ? blob.type : "image/jpeg";
    const fd = new FormData();
    fd.append("file", new File([blob], "photo.jpg", { type }));
    const res = await api.post("/org-listing/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
    return res.data.url;
  };
  const ensureUrl = async (src) => (src.startsWith("/api/") || src.startsWith("http") ? src : uploadImage(src));

  const openFilePicker = (target) => {
    // Adding beyond the gallery cap must say so, not silently do nothing.
    if (typeof target === "number" && target >= photos.length && photos.length >= maxPhotos) {
      setMenu(null);
      toast.error(`Your gallery is full (${maxPhotos} photos). Remove one to add another.`);
      return;
    }
    uploadTarget.current = target; setMenu(null); fileInput.current?.click();
  };

  const onFile = async (file) => {
    const target = uploadTarget.current;
    if (fileInput.current) fileInput.current.value = "";
    if (!file || target == null) return;
    if (!ACCEPT.includes(file.type)) { toast.error("Please use a JPG, PNG or WEBP image"); return; }
    if (file.size > MAX_FILE) { toast.error("That file is too large — max 15 MB"); return; }
    // The stored ORIGINAL (shown in the full-size viewer) keeps high quality:
    // cover/gallery up to 2000px long side at 0.8; the small logo stays modest.
    // Logo uses "auto" so a transparent PNG/WebP logo is kept as PNG (no black box).
    const res = await resizeImageToDataURL(file, target === "logo" ? 1000 : 2000, 0.8, target === "logo" ? "auto" : "jpeg");
    if (!res?.dataUrl) { toast.error("Couldn't read that image — try another file"); return; }
    setCrop({ target, source: res.dataUrl, original: res.dataUrl, format: res.mime === "image/png" ? "png" : "jpeg" });
  };

  const openCropCurrent = (target) => {
    setMenu(null);
    const src = target === "logo" ? (data.logo_original_url || data.logo_url)
      : target === "cover" ? (data.cover_original_url || data.cover_url)
        : (photos[target]?.original || photos[target]?.url);
    if (!src) return;
    // Preserve a transparent logo on re-crop: a stored .png means keep PNG.
    const format = target === "logo" && /\.png(\?|$)/i.test(src) ? "png" : "jpeg";
    setCrop({ target, source: src, original: src, format });
  };

  const persist = async (key, partial, retry) => {
    setBusy((b) => ({ ...b, [key]: true }));
    setErrors((e) => { const n = { ...e }; delete n[key]; return n; });
    try {
      await onImageChange(partial);
      toast.success("Saved");
    } catch {
      setErrors((e) => ({ ...e, [key]: { msg: "Could not save. Tap Try again.", retry } }));
      toast.error("Could not save");
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[key]; return n; });
    }
  };

  const applyCrop = (cropped) => {
    const { target, original } = crop;
    setCrop(null);
    const key = keyOf(target);
    setPreviews((p) => ({ ...p, [key]: cropped }));
    const run = async () => {
      setBusy((b) => ({ ...b, [key]: true }));
      setErrors((e) => { const n = { ...e }; delete n[key]; return n; });
      try {
        const url = await uploadImage(cropped);
        const originalUrl = await ensureUrl(original);
        let partial;
        if (target === "logo") partial = { logo_url: url, logo_original_url: originalUrl };
        else if (target === "cover") partial = { cover_url: url, cover_original_url: originalUrl };
        else {
          const next = [...photos];
          next[target] = { url, original: originalUrl, caption: photos[target]?.caption || "" };
          partial = { photos: next.filter(Boolean) };
        }
        await onImageChange(partial);
        setPreviews((p) => { const n = { ...p }; delete n[key]; return n; });
        toast.success("Saved");
      } catch {
        setErrors((e) => ({ ...e, [key]: { msg: "Could not save. Tap Try again.", retry: run } }));
        toast.error("Could not save");
      } finally {
        setBusy((b) => { const n = { ...b }; delete n[key]; return n; });
      }
    };
    run();
  };

  const doRemove = (target) => {
    setConfirmRemove(null);
    const key = keyOf(target);
    setPreviews((p) => { const n = { ...p }; delete n[key]; return n; });
    let partial;
    if (target === "logo") partial = { logo_url: "", logo_original_url: "" };
    else if (target === "cover") partial = { cover_url: "", cover_original_url: "" };
    else partial = { photos: photos.filter((_, i) => i !== target) };
    persist(key, partial, () => doRemove(target));
  };

  const Affordance = ({ label }) => (
    <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100 transition-opacity" aria-hidden>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-white/90 text-[#1F3F5B] text-xs font-bold px-3 py-1.5">
        <Icon name="image-plus" tone="current" className="h-4 w-4" /> {label}
      </span>
    </span>
  );

  const BusyOverlay = ({ k }) => busy[k] ? (
    <span className="absolute inset-0 flex items-center justify-center bg-black/40" data-testid={`slot-busy-${k}`}>
      <span className="h-6 w-6 rounded-full border-2 border-white/40 border-t-white animate-spin" />
    </span>
  ) : null;

  const ErrorOverlay = ({ k }) => errors[k] ? (
    <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 p-2 text-center" data-testid={`slot-error-${k}`}>
      <span className="text-[11px] text-white font-medium">{errors[k].msg}</span>
      <button type="button" onClick={(e) => { e.stopPropagation(); errors[k].retry?.(); }} data-testid={`slot-retry-${k}`} className="min-h-[36px] rounded-full bg-white text-[#1F3F5B] text-xs font-bold px-4">Try again</button>
    </span>
  ) : null;

  return (
    <div data-testid="profile-card-editor">
      <input ref={fileInput} type="file" accept={ACCEPT.join(",")} className="hidden" data-testid="image-file-input" onChange={(e) => onFile(e.target.files?.[0])} />

      <div className="rounded-3xl overflow-hidden shadow-sm ring-1 ring-black/5" style={{ backgroundColor: accent }}>
        {/* Cover / banner */}
        {showCover && (
        <button type="button" onClick={() => setMenu("cover")} data-testid="edit-cover"
          className="group relative block w-full" style={{ aspectRatio: String(coverAspect) }} aria-label="Edit cover photo">
          {(previews.cover || data.cover_url)
            ? <img src={previews.cover || data.cover_url} alt="Cover" data-testid="cover-img" className="w-full h-full object-cover" />
            : <span className="absolute inset-2 flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-white/60 text-white/90" data-testid="cover-empty"><Icon name="image-plus" tone="current" className="h-7 w-7" /><span className="text-xs font-semibold text-center px-2">Add cover photo<span className="block text-[10px] font-normal text-white/70">recommended {coverRecW} x {coverRecH}</span></span></span>}
          {(previews.cover || data.cover_url) && <Affordance label="Edit cover" />}
          <BusyOverlay k="cover" />
          <ErrorOverlay k="cover" />
        </button>
        )}

        {/* Logo + identity */}
        <div className="p-5 flex items-center gap-4">
          {showLogo && (
          <button type="button" onClick={() => setMenu("logo")} data-testid="edit-logo"
            className={`group relative h-20 w-20 shrink-0 rounded-full overflow-hidden flex items-center justify-center ${(previews.logo || data.logo_url) ? "bg-white" : "border-2 border-dashed border-white/70"}`} aria-label="Edit logo">
            {(previews.logo || data.logo_url)
              ? <img src={previews.logo || data.logo_url} alt="Logo" data-testid="logo-img" className="h-full w-full object-cover" />
              : <span className="flex flex-col items-center justify-center gap-0.5 text-white/90" data-testid="logo-empty">{entityKind === "boat_pro" ? <img src={ICON_BOAT_PROS} alt="" className="h-7 w-7 object-contain opacity-90" /> : <Icon name="image-plus" tone="current" className="h-6 w-6" />}<span className="text-[10px] font-bold leading-none">Add logo</span></span>}
            <Affordance label="Edit" />
            <BusyOverlay k="logo" />
            <ErrorOverlay k="logo" />
          </button>
          )}
          <div className="min-w-0">
            {data.isCP && <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-[#F2A03B] text-[#1F3F5B]">{badgeLabel || "Community Partner"}</span>}
            <div className="text-white font-display font-bold text-xl leading-tight mt-1 truncate">{data.org_name || "Your organization"}</div>
            {data.handle && <div className="text-slate-200 text-xs font-mono">@{data.handle}</div>}
          </div>
        </div>

        {/* Gallery slots */}
        {galleryLocked ? (
        <div className="px-5 pb-5" data-testid="gallery-locked">
          <div className="rounded-2xl bg-white/10 ring-1 ring-white/15 p-4 flex items-center gap-3">
            <span className="h-10 w-10 shrink-0 rounded-full bg-white/15 flex items-center justify-center">
              <Icon name="lock" tone="current" className="h-5 w-5 text-white" />
            </span>
            <p className="flex-1 text-sm font-semibold text-white/90 leading-snug">More photos are part of Community Partner.</p>
            <button type="button" onClick={() => onContactUs?.()} data-testid="gallery-contact-us"
              className="shrink-0 inline-flex items-center min-h-[44px] rounded-full bg-white text-[#1F3F5B] px-4 text-sm font-bold hover:bg-white/90">Contact us</button>
          </div>
        </div>
        ) : maxPhotos > 0 && (
        <div className="px-5 pb-5">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/70 mb-2">Photo gallery</div>
          <div className="grid grid-cols-5 gap-2">
            {Array.from({ length: maxPhotos }).map((_, i) => {
              const p = photos[i];
              const k = `g${i}`;
              const hasErr = !!errors[k];
              const pv = previews[k];
              const showSrc = pv || p?.url;
              return (p || pv) ? (
                <button key={i} type="button" onClick={() => hasErr ? errors[k].retry?.() : setMenu(i)} data-testid={`gallery-slot-${i}`}
                  className="group relative rounded-xl overflow-hidden aspect-[5/2] bg-white/10" aria-label={hasErr ? `Retry photo ${i + 1}` : `Edit photo ${i + 1}`}>
                  <img src={showSrc} alt={p?.caption || `Photo ${i + 1}`} data-testid={`gallery-img-${i}`} className="w-full h-full object-cover" />
                  {!hasErr && <Affordance label="Edit" />}
                  <BusyOverlay k={k} />
                  {hasErr && <span className="absolute top-1 left-1 h-5 w-5 rounded-full bg-red-600 flex items-center justify-center" data-testid={`slot-error-${k}`}><Icon name="error" tone="current" className="h-3.5 w-3.5 text-white" /></span>}
                </button>
              ) : (
                <button key={i} type="button" onClick={() => hasErr ? errors[k].retry?.() : openFilePicker(photos.length)} data-testid={`gallery-empty-${i}`}
                  className="relative rounded-xl aspect-[5/2] border-2 border-dashed border-white/40 hover:border-white text-white/70 flex flex-col items-center justify-center gap-1 transition-colors">
                  <Icon name="add" tone="current" className="h-5 w-5" />
                  <span className="text-[11px] font-semibold">Add photo</span>
                  <BusyOverlay k={k} />
                  {hasErr && <span className="absolute top-1 left-1 h-5 w-5 rounded-full bg-red-600 flex items-center justify-center" data-testid={`slot-error-${k}`}><Icon name="error" tone="current" className="h-3.5 w-3.5 text-white" /></span>}
                </button>
              );
            })}
          </div>
          {Object.keys(errors).some((k) => k.startsWith("g")) && (
            <p className="mt-2 text-xs font-semibold text-red-200" data-testid="gallery-error-line">Upload failed. Tap the photo to try again.</p>
          )}
        </div>
        )}
      </div>

      {/* Action sheet */}
      {menu !== null && (
        <div className="fixed inset-0 z-[110] bg-black/50 flex sm:items-center items-end justify-center p-0 sm:p-4" onClick={() => setMenu(null)} data-testid="image-menu">
          <div className="w-full sm:max-w-xs bg-white dark:bg-slate-800 rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 text-sm font-bold smn-heading border-b border-slate-100 dark:border-slate-700">{TARGET_LABEL[menu] || "Photo"}</div>
            <button type="button" onClick={() => openFilePicker(menu)} data-testid="menu-upload" className="w-full text-left px-4 min-h-[48px] text-sm font-semibold text-[#1F3F5B] dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"><Icon name="image-plus" tone="current" className="h-4 w-4 text-[#55B3AD]" /> Upload new photo</button>
            {((menu === "logo" && data.logo_url) || (menu === "cover" && data.cover_url) || (typeof menu === "number" && photos[menu])) && (
              <button type="button" onClick={() => openCropCurrent(menu)} data-testid="menu-crop" className="w-full text-left px-4 min-h-[48px] text-sm font-semibold text-[#1F3F5B] dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"><Icon name="edit" tone="current" className="h-4 w-4 text-[#55B3AD]" /> Crop current photo</button>
            )}
            {((menu === "logo" && data.logo_url) || (menu === "cover" && data.cover_url) || (typeof menu === "number" && photos[menu])) && (
              <button type="button" onClick={() => { const t = menu; setMenu(null); setConfirmRemove(t); }} data-testid="menu-remove" className="w-full text-left px-4 min-h-[48px] text-sm font-semibold text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 flex items-center gap-2"><Icon name="delete" tone="current" className="h-4 w-4" /> Remove</button>
            )}
            <button type="button" onClick={() => setMenu(null)} data-testid="menu-cancel" className="w-full text-center px-4 min-h-[48px] text-sm font-semibold text-slate-500 border-t border-slate-100 dark:border-slate-700">Cancel</button>
          </div>
        </div>
      )}

      {/* Remove confirm */}
      {confirmRemove !== null && (
        <div className="fixed inset-0 z-[115] bg-black/50 flex items-center justify-center p-4" data-testid="remove-confirm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-xs w-full p-5 shadow-xl">
            <h3 className="font-display font-bold text-lg smn-heading">Remove this photo?</h3>
            <p className="text-sm text-slate-500 mt-1">This can't be undone. You can upload a new one anytime.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmRemove(null)} data-testid="remove-confirm-no" className="min-h-[44px] rounded-full px-5 text-sm font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
              <button type="button" onClick={() => doRemove(confirmRemove)} data-testid="remove-confirm-yes" className="min-h-[44px] rounded-full px-5 text-sm font-bold bg-red-500 hover:bg-red-600 text-white">Remove</button>
            </div>
          </div>
        </div>
      )}

      {crop && (
        <CropModal image={crop.source} {...cfgFor(crop.target)}
          aspect={crop.target === "cover" ? coverAspect : cfgFor(crop.target).aspect}
          objectFit={cropObjectFit}
          format={crop.format || "jpeg"}
          onCancel={() => setCrop(null)} onSave={applyCrop} />
      )}
    </div>
  );
}
