// Shared public gallery for org/club AND Boat Pro listings.
// Laptop/tablet: ONE row in a fixed 5-column grid so tile size never changes
// with the photo count (fewer photos leave empty slots on the right, no
// stretching). Phone: 3 columns x 2 rows. Tiles are wide and short (5:2) so the
// gallery stays about a third of the cover height and never overtakes it.
// GALLERY_TILE_ASPECT is the single source of truth, reused by the editor crop
// frame so what you crop is what displays.
export const GALLERY_TILE_ASPECT = "5 / 2";

export default function PhotoGallery({
  photos = [],
  onTileClick,
  containerTestId = "photos-gallery",
  testIdPrefix = "photo",
  altFor = (i) => `Photo ${i + 1}`,
  bgClass = "bg-white/10",
  max = 5,
}) {
  const items = photos.slice(0, max);
  if (items.length === 0) return null;
  return (
    <div className={`grid grid-cols-3 sm:grid-cols-5 gap-1 p-1 ${bgClass}`} data-testid={containerTestId}>
      {items.map((p, i) => {
        const src = typeof p === "string" ? p : p?.url;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onTileClick?.(i)}
            data-testid={`${testIdPrefix}-btn-${i}`}
            aria-label={`View photo ${i + 1}`}
            className="relative block w-full aspect-[3/2] sm:aspect-[5/2] rounded-sm overflow-hidden focus:outline-none focus:ring-2 focus:ring-white/70"
          >
            <img
              src={src}
              alt={typeof p === "string" ? altFor(i) : (p?.caption || altFor(i))}
              data-testid={`${testIdPrefix}-${i}`}
              className="w-full h-full object-cover"
              loading="lazy"
            />
            {typeof p !== "string" && p?.caption && (
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1 text-[11px] text-white truncate text-left">{p.caption}</div>
            )}
          </button>
        );
      })}
    </div>
  );
}
