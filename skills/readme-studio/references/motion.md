# Portable rendering and delivery

Choose one engine and record its version/license before rendering. Remotion 4.0.526 is preferred when its company license terms fit the project; it is not an unrestricted MIT renderer. Review https://www.remotion.dev/docs/license and https://www.remotion.dev/docs/cli/render. The alternative is published `hyperframes@0.8.51` (MIT), with its own bundled dependency notices: https://github.com/heygen-com/hyperframes. Inspect installed help for the pinned version; no `latest`, global installs or invented package names.

Copy the selected template directory from the exact native-selected SKILL.md root into the authorized project. Run `npm ci --no-audit --no-fund` there; install no engine into the product's runtime dependencies. Both lockfiles travel with the template. Chrome and the renderer's FFmpeg path must be available locally. A sandbox failure is MOTION_RENDER_BLOCKED, not permission to disable the host's sandbox. Keep source for an authorized external local render and disclose that boundary.

## Remotion

Put the inspected background at `public/background.png` and the six outlined assets at `public/{title,subtitle,label}-{dark,light}.svg`. Suffix names ink. Verify light ink is bound to Dark compositions. The component uses a solid theme field behind type, two staged Gaussian background planes (far and middle), seeded grain, the existing glow, a second static rim-light band, and an original crisp pixel sprite. The panel stays sharp above both blur planes. Props `farBlur`, `middleBlur`, `grain`, `glow`, and `depth` control restraint; use a props JSON file, not interpolated user text. All motion is frame-derived; no CSS animations or random-per-frame noise. Reduced-motion posters are still renders of this composition: preserve both blur planes and the rim-light band in the static image.

```sh
./node_modules/.bin/remotion compositions src/index.tsx
./node_modules/.bin/remotion render src/index.tsx WideDark out/wide-dark-v1.mp4 --codec=h264 --concurrency=1 --overwrite=false
./node_modules/.bin/remotion still src/index.tsx WideDark out/poster-wide-dark-v1.png --frame=150 --overwrite=false
```

Repeat for WideLight, MobileDark and MobileLight. Metadata specifies 60fps, 300 frames, 5 seconds. At frame zero type is already legible; a short eased translation settles into a readable hold and returns for the seam. Verify actual output, not just this metadata. Existing output names must never be reused.

## HyperFrames

The HTML recipe is a wide dark starting composition; copy it into separate local light/mobile variants and change field, ink asset bindings, dimensions and layout together. Use `background.png` and the light-ink SVGs beside index.html. It stages far and middle blur planes below a sharp panel and a separate rim-light band; reduced-motion mode disables movement while keeping those effects visible. Keep `data-composition-id`, dimensions, five-second duration and `data-no-timeline`: this template uses finite CSS keyframes, not a missing GSAP timeline. The motion sidecar probes the cover container (including descendants), not a leaf. Render with one worker; multiple workers have produced clipped output for this recipe.

```sh
./node_modules/.bin/hyperframes --version
./node_modules/.bin/hyperframes render --help
./node_modules/.bin/hyperframes check . --samples 60 --no-contrast --json
./node_modules/.bin/hyperframes render . -c . --fps 60 --workers 1 -o out/wide-dark-v1.mp4
```

Verify current help's overwrite behavior and choose a fresh output. The positional argument is the project directory; `-c .` selects index.html (`-c` accepts a composition file path, not its id). A check or render failure stays partial; preserve logs and do not switch engines silently.

## Inspect and distribute

Probe width/height/r_frame_rate/nb_frames/duration with ffprobe when available, then decode frame 0/150/299 and inspect each master for clipping, title exactness, readable contrast and seam continuity. Inspect posters and previews at 320/390/1440px in both themes. Verify the paths-only SVGs and source strings at asset level; CSS cannot recolor an external SVG image.

Encode each inline preview initially at 6fps, 560x280 wide or 384x480 mobile, <=64 colors; 30 frames for five seconds. Use ffmpeg palettegen/paletteuse or an available equivalent. The master remains 60fps; do not describe the preview as 60fps. Inspect readability before trading dimensions/quality for bytes. Budget <=2.5 MiB each; record an explicit delivery decision if that cannot be met. GIF and animated WebP compatibility are separate checks. A static poster is always required.

Use `templates/readme-cover-section.md`, updating only to existing local asset names and meaningful alt text. Reduced-motion sources precede animation sources; img is static. Link MP4 as an optional viewing master; arbitrary README video HTML is not assumed supported. Verify local media selection and reduced motion now; GitHub/npm sanitization and actual public playback remain POST_PUBLICATION_UNVERIFIED. Never publish, invent a CDN URL or target new files at an immutable old version to close that gate.
