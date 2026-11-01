import { useCallback, useRef, useState } from "react";
import Cropper from "react-easy-crop";
import { Icon } from "@/components/Icon";

// Renders the react-easy-crop pixel area to a data URL. PNG (lossless, keeps
// transparency) for logos whose source is transparent; JPEG (small) otherwise.
async function toCroppedDataURL(src, area, outW, outH, format = "jpeg") {
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = src;
  });
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (format === "png") {
    ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, outW, outH);
    return canvas.toDataURL("image/png");
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, outW, outH);
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, outW, outH);
  return canvas.toDataURL("image/jpeg", 0.85);
}

// Reusable crop dialog (drag to reposition, slider/pinch to zoom). Full screen on
// phone, centered modal on tablet/laptop. Square+round for logos, banner aspect
// for covers. onSave receives the cropped data URL.
export default function CropModal({ image, aspect = 1, cropShape = "rect", objectFit = "contain", title = "Crop photo", format = "jpeg", onCancel, onSave }) {
  const round = cropShape === "round";
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [minZoom, setMinZoom] = useState(round ? 0.1 : 1);
  const [cropSize, setCropSize] = useState(null);
  const [areaPx, setAreaPx] = useState(null);
  const [busy, setBusy] = useState(false);
  const containerRef = useRef(null);
  const onComplete = useCallback((_a, px) => setAreaPx(px), []);

  // Logo (round): fit the WHOLE image inside the circle on open (contain), and
  // let the slider zoom out that far. react-easy-crop scales media to COVER the
  // crop area at zoom 1, so we set an explicit crop circle and compute the zoom
  // that makes the full image fit inside it.
  const onMediaLoaded = useCallback((mediaSize) => {
    if (!round) return;
    const el = containerRef.current;
    if (!el) return;
    const d = Math.floor(Math.min(el.clientWidth, el.clientHeight) * 0.9);
    const fit = Math.min(d / mediaSize.width, d / mediaSize.height);
    setCropSize({ width: d, height: d });
    setMinZoom(fit);
    setZoom(fit);
  }, [round]);

  const save = async () => {
    if (!areaPx) return;
    setBusy(true);
    try {
      let outW, outH;
      if (round) {
        // Never upscale a small logo: cap output at the cropped source size.
        outW = Math.min(512, Math.round(areaPx.width));
        outH = outW;
      } else {
        outW = 1600;
        outH = Math.round(1600 / aspect);
      }
      onSave(await toCroppedDataURL(image, areaPx, outW, outH, format));
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/80 flex sm:items-center justify-center" data-testid="crop-modal">
      <div className="w-full h-full sm:h-auto sm:max-w-lg sm:rounded-2xl bg-white dark:bg-slate-800 flex flex-col overflow-hidden shadow-xl">
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700 shrink-0">
          <h3 className="font-display font-bold text-lg smn-heading">{title}</h3>
          <p className="text-xs text-slate-400">Drag to reposition · pinch or use the slider to zoom</p>
        </div>
        <div ref={containerRef} className={`relative flex-1 min-h-[280px] ${round ? "bg-white" : "bg-slate-900"}`}>
          <Cropper image={image} crop={crop} zoom={zoom} aspect={aspect} cropShape={cropShape}
            objectFit={round ? "contain" : objectFit}
            cropSize={round ? (cropSize || undefined) : undefined}
            minZoom={minZoom} maxZoom={3} restrictPosition={!round}
            showGrid={false} onMediaLoaded={onMediaLoaded}
            onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={onComplete} />
        </div>
        <div className="px-5 py-4 space-y-4 shrink-0">
          <div className="flex items-center gap-3">
            <Icon name="image" tone="current" className="h-4 w-4 text-slate-400 shrink-0" />
            <input type="range" min={minZoom} max={3} step={0.01} value={zoom} data-testid="crop-zoom"
              onChange={(e) => setZoom(Number(e.target.value))} className="flex-1 accent-[#55B3AD] h-11" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onCancel} data-testid="crop-cancel" className="min-h-[44px] rounded-full px-5 text-sm font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
            <button type="button" onClick={save} disabled={busy} data-testid="crop-save" className="min-h-[44px] rounded-full px-6 text-sm font-bold bg-[#F2A03B] hover:bg-[#d98c30] text-[#1F3F5B] disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
