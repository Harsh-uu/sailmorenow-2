import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { toast } from "sonner";
import { compressImageToDataURL } from "@/lib/imageCompress";

// Up to `max` photos, each downsized client-side to a data URL. Used by For Sale
// posts. Grid of fixed slots like the org / Boat Pro gallery editor: a filled
// slot shows Replace / Remove on hover, an empty slot is a plus tile.
export default function MultiPhotoUploader({ value = [], onChange, max = 6 }) {
  const input = useRef(null);
  const replaceIndex = useRef(null);
  const [busy, setBusy] = useState(false);

  const openPicker = (index) => { replaceIndex.current = index; input.current?.click(); };

  const handleFiles = async (files) => {
    const isImageLike = (f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name || "");
    const list = Array.from(files || []).filter(isImageLike);
    const idx = replaceIndex.current;
    replaceIndex.current = null;
    if (input.current) input.current.value = "";
    if (!list.length) return;
    setBusy(true);
    let failed = 0;
    try {
      if (idx != null) {
        try {
          const res = await compressImageToDataURL(list[0]);
          if (res?.ok) onChange(value.map((u, j) => (j === idx ? res.dataUrl : u)));
          else failed++;
        } catch { failed++; }
      } else {
        const room = max - value.length;
        if (room <= 0) { toast.error(`Up to ${max} photos`); return; }
        const added = [];
        for (const file of list.slice(0, room)) {
          try { const res = await compressImageToDataURL(file); if (res?.ok) added.push(res.dataUrl); else failed++; } catch { failed++; }
        }
        if (added.length) onChange([...value, ...added]);
      }
      if (failed) toast.error(failed === 1 ? "We couldn't add that photo. Try a JPG or PNG." : `We couldn't add ${failed} photos. Try JPG or PNG.`);
    } finally { setBusy(false); }
  };

  const slots = Array.from({ length: max });

  return (
    <div data-testid="multi-photo-uploader">
      <input ref={input} type="file" accept="image/*" multiple className="hidden" data-testid="multi-photo-input" onChange={(e) => handleFiles(e.target.files)} />
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {slots.map((_, i) => {
          const url = value[i];
          const isFirstEmpty = i === value.length;
          if (url) {
            return (
              <div key={i} data-testid={`photo-slot-${i}`} className="group relative aspect-square rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
                <img src={url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" data-testid={`photo-thumb-${i}`} />
                <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/45 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <button type="button" onClick={() => openPicker(i)} data-testid={`photo-replace-${i}`}
                    className="text-[11px] font-bold uppercase tracking-wide rounded-full bg-white/90 text-[#1F3F5B] px-2.5 py-1">Replace</button>
                  <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} data-testid={`photo-remove-${i}`}
                    className="text-[11px] font-bold uppercase tracking-wide rounded-full bg-white/90 text-[#1F3F5B] px-2.5 py-1">Remove</button>
                </div>
              </div>
            );
          }
          if (isFirstEmpty) {
            return (
              <button key={i} type="button" onClick={() => openPicker(null)} disabled={busy} data-testid="photo-add"
                className="aspect-square rounded-lg border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-[#55B3AD] text-slate-400 flex flex-col items-center justify-center gap-0.5 text-xs disabled:opacity-50">
                <Icon name="image-plus" tone="current" className="h-5 w-5 text-[#55B3AD]" /> {busy ? "…" : "Add"}
              </button>
            );
          }
          return <div key={i} data-testid={`photo-slot-empty-${i}`} className="aspect-square rounded-lg border border-dashed border-slate-200 dark:border-slate-700" />;
        })}
      </div>
      <div className="text-[11px] text-slate-400 mt-1">{value.length}/{max} photos</div>
    </div>
  );
}
