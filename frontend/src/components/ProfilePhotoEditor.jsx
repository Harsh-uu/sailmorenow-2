import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import Modal from "@/components/Modal";

export const SAILING_ICONS = ["⛵", "🧭", "🌊", "🛥️", "⚓", "🐋", "🦭", "🏝️", "☀️", "🌤️", "🪢", "🐚"];
const OUT = 320;

// Upload → drag/zoom crop → 320px square JPEG data URL, or pick a preset icon.
export default function ProfilePhotoEditor({ user, onSaved }) {
  const input = useRef(null);
  const [open, setOpen] = useState(false);
  const [img, setImg] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef(null);
  const [busy, setBusy] = useState(false);

  const pick = (file) => {
    if (!file?.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => { setImg(im); setZoom(1); setPos({ x: 0, y: 0 }); setOpen(true); };
    im.src = url;
    if (input.current) input.current.value = "";
  };
  const base = img ? Math.max(OUT / img.width, OUT / img.height) : 1;
  const scale = base * zoom;
  const clamp = (p) => {
    const w = img.width * scale, h = img.height * scale;
    return { x: Math.min(0, Math.max(OUT - w, p.x)), y: Math.min(0, Math.max(OUT - h, p.y)) };
  };
  const onDown = (e) => { drag.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }; };
  const onMove = (e) => { if (drag.current) setPos(clamp({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y })); };
  const onUp = () => { drag.current = null; };
  const centered = () => clamp({ x: (OUT - img.width * scale) / 2, y: (OUT - img.height * scale) / 2 });

  const save = async (picture, avatar) => {
    setBusy(true);
    try { await api.patch("/profile/photo", { picture, avatar }); toast.success("Profile photo updated"); setOpen(false); setImg(null); onSaved?.(); }
    catch (e) { toast.error(errMsg(e, "Couldn't save photo")); } finally { setBusy(false); }
  };
  const confirmCrop = () => {
    const c = document.createElement("canvas"); c.width = OUT; c.height = OUT;
    const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, OUT, OUT);
    ctx.drawImage(img, pos.x, pos.y, img.width * scale, img.height * scale);
    // Upload the cropped square to object storage so web + mobile share one URL.
    setBusy(true);
    c.toBlob(async (blob) => {
      try {
        const fd = new FormData();
        fd.append("file", blob, "avatar.jpg");
        await api.post("/auth/avatar", fd, { headers: { "Content-Type": "multipart/form-data" } });
        toast.success("Profile photo updated");
        setOpen(false); setImg(null); onSaved?.();
      } catch (e) {
        toast.error(errMsg(e, "Couldn't save photo"));
      } finally {
        setBusy(false);
      }
    }, "image/jpeg", 0.85);
  };

  return (
    <div data-testid="profile-photo-editor">
      <input ref={input} type="file" accept="image/*" className="hidden" data-testid="photo-input" onChange={(e) => pick(e.target.files?.[0])} />
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => input.current?.click()} data-testid="photo-upload-btn" className="inline-flex items-center gap-1.5 rounded-full bg-[#1F3F5B] text-white px-4 py-1.5 text-xs font-semibold hover:bg-[#152a3d]"><Icon name="camera" tone="current" className="h-3.5 w-3.5" /> Upload photo</button>
        <span className="text-xs text-slate-500">or pick an icon:</span>
        <div className="flex flex-wrap gap-1">
          {SAILING_ICONS.map((a) => (
            <button key={a} onClick={() => save(null, a)} disabled={busy} data-testid={`icon-${a}`} title={a}
              className={`h-8 w-8 rounded-full text-lg flex items-center justify-center border ${!user.picture && user.avatar === a ? "border-[#F2A03B] bg-[#F2A03B]/15" : "border-slate-200 dark:border-slate-600 hover:border-[#55B3AD]"}`}>{a}</button>
          ))}
        </div>
      </div>
      <Modal open={open} onClose={() => { setOpen(false); setImg(null); }} title="Adjust your photo" testId="crop-modal">
        {img && (
          <div className="p-5 flex flex-col items-center gap-4">
            <div className="relative rounded-full overflow-hidden ring-4 ring-[#55B3AD]/40 cursor-grab active:cursor-grabbing select-none touch-none" style={{ width: OUT, height: OUT, maxWidth: "80vw", maxHeight: "80vw" }}
                 onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} data-testid="crop-area">
              <img src={img.src} alt="" draggable={false} style={{ position: "absolute", left: pos.x, top: pos.y, width: img.width * scale, height: img.height * scale, maxWidth: "none" }} />
            </div>
            <label className="w-full text-xs text-slate-500 flex items-center gap-3">Zoom
              <input type="range" min={1} max={3} step={0.01} value={zoom} data-testid="crop-zoom" onChange={(e) => { const z = +e.target.value; setZoom(z); setTimeout(() => setPos((p) => clamp(p)), 0); }} className="flex-1 accent-[#F2A03B]" />
            </label>
            <div className="flex gap-2 w-full justify-between">
              <button onClick={() => setPos(centered())} className="text-xs text-slate-500 hover:underline">Center</button>
              <div className="flex gap-2">
                <button onClick={() => { setOpen(false); setImg(null); }} className="inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-slate-600 px-4 py-1.5 text-sm"><Icon name="close" tone="current" className="h-4 w-4" /> Cancel</button>
                <button onClick={confirmCrop} disabled={busy} data-testid="crop-save" className="inline-flex items-center gap-1 rounded-full bg-[#F2A03B] hover:bg-[#d98c30] text-white px-4 py-1.5 text-sm font-semibold disabled:opacity-50"><Icon name="check" tone="current" className="h-4 w-4" /> {busy ? "Saving…" : "Use photo"}</button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
