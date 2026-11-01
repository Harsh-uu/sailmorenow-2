import * as ImageManipulator from "expo-image-manipulator";

// The backend measures the base64 data URL LENGTH (characters), not blob bytes.
// A ~400 KB JPEG balloons to ~535 KB as a data URL, so we gate on characters to
// avoid a server-side 400 "Photo too large". Mirrors the web contract in
// frontend/src/lib/constants.js -> MAX_PHOTO_URL_CHARS.
export const MAX_PHOTO_URL_CHARS = 400_000;

export type CompressResult = {
  dataUrl: string;
  chars: number;
  width: number;
  height: number;
  ok: boolean;
};

// Downscale + re-encode a picked image into a JPEG base64 data URL that fits
// under `maxChars` characters. Mirrors the web standard
// (frontend/src/lib/imageCompress.js): a ladder of long-edge caps with a JPEG
// quality walk, never upscaling. Returns the smallest payload with ok:false if
// nothing fits, so the caller can show a plain message instead of failing late.
export async function compressPhotoToDataUrl(
  uri: string,
  srcW?: number,
  srcH?: number,
  maxChars: number = MAX_PHOTO_URL_CHARS,
): Promise<CompressResult | null> {
  const caps = [1600, 1200, 900];
  const qualities = [0.8, 0.7, 0.6, 0.5, 0.45, 0.4];
  const longEdge = Math.max(srcW || 0, srcH || 0);
  let best: CompressResult | null = null;

  for (const cap of caps) {
    // Cap the LONG edge, never upscale. Resize by width for landscape/square,
    // by height for portrait; expo-image-manipulator keeps the aspect ratio.
    const actions: { resize: { width?: number; height?: number } }[] = [];
    if (longEdge === 0) {
      actions.push({ resize: { width: cap } });
    } else if (longEdge > cap) {
      if ((srcW || 0) >= (srcH || 0)) actions.push({ resize: { width: cap } });
      else actions.push({ resize: { height: cap } });
    }

    for (const q of qualities) {
      const res = await ImageManipulator.manipulateAsync(uri, actions, {
        compress: q,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      });
      if (!res.base64) continue;
      const dataUrl = `data:image/jpeg;base64,${res.base64}`;
      const shot: CompressResult = {
        dataUrl,
        chars: dataUrl.length,
        width: res.width,
        height: res.height,
        ok: true,
      };
      if (!best || shot.chars < best.chars) best = shot;
      if (shot.chars <= maxChars) return shot;
    }
  }
  return best ? { ...best, ok: false } : null;
}

export const PHOTO_TOO_LARGE_MESSAGE =
  "That photo is too large to upload. Please pick a smaller photo or take a new one.";
