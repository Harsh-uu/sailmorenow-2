import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { toast } from "sonner";
import { compressImageToDataURL } from "@/lib/imageCompress";

// Event flyer: picks a file, downsizes client-side, hands back a data URL.
export default function FlyerUploader({ value, onChange, label = "Upload event flyer (optional)" }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file) => {
    if (!file) return;
    const isImageLike = file.type.startsWith("image/") || /\.(heic|heif)$/i.test(file.name || "");
    if (!isImageLike) return toast.error("Please choose an image");
    setBusy(true);
    try {
      const res = await compressImageToDataURL(file);
      if (!res?.ok) return toast.error("That image is too large even after compression — try a smaller one");
      onChange(res.dataUrl);
    }
    catch { toast.error("Couldn't process that image"); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  return (
    <div data-testid="flyer-uploader">
      <input ref={input} type="file" accept="image/*" className="hidden" data-testid="flyer-input" onChange={(e) => pick(e.target.files?.[0])} />
      {value ? (
        <div className="relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-600">
          <img src={value} alt="Event flyer" className="w-full max-h-56 object-cover" data-testid="flyer-preview" />
          <button type="button" onClick={() => onChange("")} data-testid="flyer-remove" className="absolute top-2 right-2 rounded-full bg-white/90 text-slate-700 p-1 shadow hover:bg-white"><Icon name="close" tone="current" className="h-4 w-4" /></button>
        </div>
      ) : (
        <button type="button" onClick={() => input.current?.click()} disabled={busy} data-testid="flyer-pick"
          className="w-full rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-600 hover:border-[#55B3AD] px-4 py-6 text-sm text-slate-500 flex flex-col items-center gap-1 disabled:opacity-50">
          <Icon name="image-plus" tone="current" className="h-5 w-5 text-[#55B3AD]" /> {busy ? "Processing…" : label}
        </button>
      )}
    </div>
  );
}
