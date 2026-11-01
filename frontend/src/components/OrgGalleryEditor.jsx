import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { toast } from "sonner";
import { compressImageToDataURL } from "@/lib/imageCompress";

// Gallery editor for org listings. Stores [{ url, caption }]. The first item is
// the cover/hero. "Set as cover" moves a photo to the front.
export default function OrgGalleryEditor({ value, onChange, max = 1, showSetCover = true }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const photos = value || [];

  const add = async (files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    const room = max - photos.length;
    if (room <= 0) { toast.error(`You can add up to ${max} photo${max === 1 ? "" : "s"}.`); return; }
    setBusy(true);
    try {
      const next = [...photos];
      for (const file of list.slice(0, room)) {
        if (!(file.type.startsWith("image/") || /\.(heic|heif)$/i.test(file.name || ""))) continue;
        const res = await compressImageToDataURL(file);
        if (!res?.ok) { toast.error("That image is too large even after compression"); continue; }
        next.push({ url: res.dataUrl, caption: "" });
      }
      onChange(next);
    } catch { toast.error("Couldn't process that image"); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  };

  const setCaption = (i, caption) => onChange(photos.map((p, j) => (j === i ? { ...p, caption } : p)));
  const remove = (i) => onChange(photos.filter((_, j) => j !== i));
  const setCover = (i) => { if (i === 0) return; const next = [...photos]; const [moved] = next.splice(i, 1); next.unshift(moved); onChange(next); };

  return (
    <div data-testid="org-gallery-editor">
      <input ref={input} type="file" accept="image/*" multiple className="hidden" data-testid="gallery-input" onChange={(e) => add(e.target.files)} />
      {photos.length > 0 && (
        <div className="space-y-3 mb-3">
          {photos.map((p, i) => (
            <div key={i} data-testid={`gallery-item-${i}`} className="flex gap-3 items-start rounded-xl border border-slate-200 dark:border-slate-700 p-3">
              <div className="relative shrink-0">
                <img src={p.url} alt={p.caption || `Photo ${i + 1}`} className="h-20 w-20 rounded-lg object-cover bg-slate-100" />
                {i === 0 && showSetCover && <span data-testid="gallery-cover-badge" className="absolute -top-2 -left-2 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-[#F2A03B] text-[#1F3F5B]">Cover</span>}
              </div>
              <div className="flex-1 min-w-0">
                <input type="text" value={p.caption || ""} maxLength={140} onChange={(e) => setCaption(i, e.target.value)} data-testid={`gallery-caption-${i}`}
                  placeholder="Add a caption (optional)" className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm outline-none focus:border-[#55B3AD]" />
                <div className="mt-2 flex items-center gap-3">
                  {i !== 0 && showSetCover && <button type="button" onClick={() => setCover(i)} data-testid={`gallery-set-cover-${i}`} className="text-xs font-semibold text-[#55B3AD] hover:underline">Set as cover</button>}
                  <button type="button" onClick={() => remove(i)} data-testid={`gallery-remove-${i}`} className="text-xs font-semibold text-red-500 hover:underline">Remove</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {photos.length < max && (
        <button type="button" onClick={() => input.current?.click()} disabled={busy} data-testid="gallery-add"
          className="w-full rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-600 hover:border-[#55B3AD] px-4 py-5 text-sm text-slate-500 flex flex-col items-center gap-1 disabled:opacity-50">
          <Icon name="image-plus" tone="current" className="h-5 w-5 text-[#55B3AD]" /> {busy ? "Processing…" : `Add photo (${photos.length}/${max})`}
        </button>
      )}
    </div>
  );
}
