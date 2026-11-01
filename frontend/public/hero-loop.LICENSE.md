# Hero video attribution

**Files**:
- `hero-loop-portrait.mp4` / `.webm` — primary hero video, 720×1280, ≈8 s
- `hero-loop.mp4` / `.webm` — landscape 1280×720 crop (used for `og:video`
  and `twitter:player` social previews)
- `hero-loop-alt-portrait.mp4` — secondary/"second angle" clip staged for
  future hero rotation
- `hero-poster.jpg` — matching portrait poster frame

**Source**: original 4K portrait clips (`IMG_6086.MOV`, `IMG_6088.MOV`) shot
by the Sail More Now founders during a Pacific Northwest spinnaker run.

**License**: owned by Sail More Now — no third-party attribution required.

**Processing**: `ffmpeg` used to trim to an 8 s window, center-crop to the
target aspect (720×1280 portrait for the hero, 1280×720 landscape crop of
the upper third for social OG), then re-encode as H.264 CRF 24-25 and
VP9 CRF 34 with audio stripped and `+faststart` for fast web playback.
