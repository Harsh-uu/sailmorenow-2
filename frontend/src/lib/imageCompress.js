import { MAX_PHOTO_URL_CHARS } from "@/lib/constants";

/**
 * iPhones often hand us HEIC/HEIF files that most browsers (Chrome, Firefox,
 * Android, desktop Edge) cannot decode in an <img>/canvas, so the photo would
 * silently fail to upload. Detect those and convert to a JPEG File in the
 * browser before any canvas work. Returns the original file for normal types.
 * Throws a friendly Error if a HEIC file can't be converted.
 */
export async function normalizeImageFile(file) {
  if (!file) return file;
  const name = (file.name || "").toLowerCase();
  const isHeic = /image\/hei[cf]/i.test(file.type || "") || /\.(heic|heif)$/i.test(name);
  if (!isHeic) return file;
  try {
    const { default: heic2any } = await import("heic2any");
    const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
    const blob = Array.isArray(out) ? out[0] : out;
    return new File([blob], name.replace(/\.(heic|heif)$/i, ".jpg") || "photo.jpg", { type: "image/jpeg" });
  } catch (e) {
    throw new Error("HEIC_CONVERT_FAILED");
  }
}

/**
 * Downscale + re-encode an image File into a JPEG data URL that fits under
 * `maxDataUrlLen` CHARACTERS (base64 is what the backend measures — a 400 KB
 * JPEG blob balloons to ~535 KB as a data URL, so we gate on characters not
 * blob bytes to avoid a server-side 400 rejection).
 *
 * Strategy: try a ladder of long-edge caps (1600 → 1200 → 900 px). At each
 * cap, walk JPEG quality from 0.85 down to 0.40 in 0.05 steps. If nothing
 * under the limit fits at any cap, return the SMALLEST payload produced
 * (best-effort with ok:false) so the caller can surface a clear message
 * instead of the file silently disappearing.
 */
export async function compressImageToDataURL(file, maxDataUrlLen = MAX_PHOTO_URL_CHARS) {
  file = await normalizeImageFile(file);
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    // Long-edge caps from most-detailed to least. If a noisy 4000×3000
    // camera shot can't fit at 1600 px even at q=0.4, dropping to 1200 or
    // 900 usually clears it before we give up.
    const caps = [1600, 1200, 900];
    // Integer denominators so float drift can't skip q=0.40.
    const qualities = [85, 75, 65, 55, 45, 40];
    let best = null;
    for (const cap of caps) {
      let { width, height } = img;
      if (Math.max(width, height) > cap) {
        const s = cap / Math.max(width, height);
        width = Math.round(width * s);
        height = Math.round(height * s);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      // Paint a white background so transparent PNGs don't turn black
      // when re-encoded as JPEG.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      for (const step of qualities) {
        const q = step / 100;
        const blob = await new Promise((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", q),
        );
        if (!blob) continue;
        const dataUrl = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = reject;
          r.readAsDataURL(blob);
        });
        const chars = dataUrl.length;
        const shot = { dataUrl, bytes: blob.size, chars, quality: q, cap };
        if (!best || chars < best.chars) best = shot;
        if (chars <= maxDataUrlLen) return { ...shot, ok: true };
      }
      // Couldn't fit at this cap — outer loop drops the long edge and tries
      // again. Discarding the canvas between caps keeps peak memory small.
    }
    return best ? { ...best, ok: false } : null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Downscale (never upscale) an image File to a JPEG data URL at up to `maxEdge`
 * px on the long side and `quality` JPEG quality. Used for the STORED ORIGINAL
 * that the full-size viewer shows. Uploads now go to object storage (not base64
 * in JSON), so we no longer cap on characters — we keep quality instead.
 * Cover + gallery: 2000px / 0.8. Logo: smaller (shown small), see caller.
 */
export async function resizeImageToDataURL(file, maxEdge = 2000, quality = 0.8, format = "jpeg") {
  file = await normalizeImageFile(file);
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    let { width, height } = img;
    if (Math.max(width, height) > maxEdge) {
      const s = maxEdge / Math.max(width, height);
      width = Math.round(width * s);
      height = Math.round(height * s);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    // Draw onto a transparent canvas first so we can detect alpha when asked.
    ctx.drawImage(img, 0, 0, width, height);
    let usePng = false;
    if (format === "auto") {
      try {
        const d = ctx.getImageData(0, 0, width, height).data;
        for (let i = 3; i < d.length; i += 4) { if (d[i] < 250) { usePng = true; break; } }
      } catch { usePng = file.type === "image/png" || file.type === "image/webp"; }
    } else if (format === "png") {
      usePng = true;
    }
    if (usePng) {
      const dataUrl = canvas.toDataURL("image/png");
      return { dataUrl, mime: "image/png", bytes: Math.round((dataUrl.length - 22) * 0.75), width, height, ok: true };
    }
    // JPEG: composite over white so any transparency doesn't turn black.
    const c2 = document.createElement("canvas");
    c2.width = width; c2.height = height;
    const x = c2.getContext("2d");
    x.fillStyle = "#ffffff";
    x.fillRect(0, 0, width, height);
    x.drawImage(canvas, 0, 0);
    const dataUrl = c2.toDataURL("image/jpeg", quality);
    return { dataUrl, mime: "image/jpeg", bytes: Math.round((dataUrl.length - 22) * 0.75), width, height, ok: true };
  } finally {
    URL.revokeObjectURL(url);
  }
}
