# Depth: the 3D route

Read this when the treatment's subject is a `depth3d` device (`depth: "3d"`), or when a cover takes
the `hero-3d` recipe. A drawn 3D object is the right subject when the film is about a thing that has
a back and an inside: a product that turns, opens, unfolds or is assembled. A flat diagram, a chart or
type does not need it; keep those on the 2D page.

## What the renderer gives you

- **A pinned three.js.** The skill ships three.js r170 (npm `three@0.170.0`, MIT) unminified in
  `engine/vendor/three/`: `three.module.js` plus two addons, `environments/RoomEnvironment.js` and
  `geometries/RoundedBoxGeometry.js`. Their hashes and the licence are in `THIRD_PARTY_NOTICES`, and a
  test pins them. The renderer serves them under `/lit/three/` (JavaScript files only; the licence and
  any other path answer 404), and a page imports them through an import map:

  ```html
  <script type="importmap">{ "imports": { "three": "/lit/three/three.module.js", "three/addons/": "/lit/three/addons/" } }</script>
  <script type="module">
    import * as THREE from "three";
    import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
  </script>
  ```

  The network rules still hold: never load three.js, a model or a texture from a CDN, and never copy
  a library into `stage/`.
- **The GPU rung.** A `depth: 3d` film and a `hero-3d` cover start Chrome on the platform's GPU rung
  (ANGLE on Metal on macOS, GL on Linux, D3D11 on Windows) with GPU rasterization of the page itself
  left off, so the type and the capture path are the same as on the software rung. The manifest
  records `rung` and the WebGL `renderer` string, and the gate's WebGL line names both. The same
  determinism replay runs as on the software rung: a fresh browser on the same rung must reproduce
  the sampled frames pixel for pixel, or the render stops with exit 18.
- **A labelled fallback.** When the GPU rung cannot start, or starts without WebGL, the render
  reopens every browser of the round on the software rung (SwiftShader), puts a notice in the report
  and the manifest's `warnings` naming the reason, and records `rung: "swiftshader"`. The film still
  renders, more slowly, with the same frames. Say in the reply that it rendered without the GPU. Only
  when neither rung has WebGL is it exit 11.

The rung comes from the treatment (`depth`) or the cover recipe, never from the page.

## The scaffold's world

`render.mjs scaffold` on a `depth: 3d` treatment adds, on top of the 2D shots:

- `<canvas id="world">` behind every shot's section, so the type stays DOM text the QA can read;
- one renderer for the whole film (alpha, `preserveDrawingBuffer`, pixel ratio 1, ACES tone mapping,
  soft shadows), a `RoomEnvironment` for reflections, a key light with a biased shadow, a hemisphere
  light in the style's colours and a shadow-only floor;
- `HERO`, a group that holds the protagonist from the first frame to the last;
- `aim(layout)`, which offsets the camera so the world origin lands on the centre of the shot's subject
  zone, so a `hero` layout shot fills the frame and a `split` shot keeps the object on its side;
- `WORLD[i](s, hero, cam, t)`, one function per shot that poses the hero, the camera and anything else
  as a function of the shot (`s.p`, `s.local`, `s.enter(...)`).

Build the protagonist once, in `HERO`, and only pose it per shot: that is what makes it the same
object across the film. For a named product, start from its real logo and screens: a fetched logo or
screenshot goes on a plane or a face of the object as a texture (`TextureLoader` on the file under
`stage/assets/`); a simple logo shape can be traced into a `THREE.Shape` and given depth with
`ExtrudeGeometry`.

## Craft and the gate

- **Turn slowly.** A full turn takes the loop (a cover) or a whole shot (a film). Fast spins, flickering
  specular highlights and shadow acne all read as flashes and fail the flash audit (MO-C-03).
- **Bias the shadow.** On a turning object set `shadow.bias` about -0.0004 and `shadow.normalBias`
  about 0.03; without them the self-shadow flickers frame to frame.
- **Ease every open and close.** A lid, a drawer or an exploded view eases in and out (`ease.smooth`),
  holds, and returns; the move is the beat, so it happens once, where the treatment's story puts it.
- **Keep the type in the DOM.** Copy stays in the shot's type zone as HTML text over the canvas; text
  drawn inside the 3D scene is invisible to the QA unless registered with `LitStage.text`.
- **Mind the dead air.** A small object on a large empty ground is `DEAD-AIR`; frame it with the
  `hero` layout or move the camera in.
- **Covers at 20 fps with q94.** See `cover.md`, craft rule 13 and 14.

## The Blender rung (`render3d: "blender"`)

For a film that asks for high-quality, cinematic or photoreal 3D, and only when Blender is installed
(`runtime.md`, "Blender"), the world is rendered offline with Cycles and the page shows the result.
`render.mjs scaffold` prints a `BLENDER:` line when the request asks for that quality: with the path
Blender was found at when it is installed, and with a note to stay on three.js when it is not. Otherwise
the three.js world on the GPU rung is the route and nothing below applies.

1. Set `render3d: "blender"` (with `depth: "3d"` and a `depth3d` subject) and write the world as a
   Blender Python script in `stage/scene.py`. The runner puts `lit` in scope: `lit.camera(location,
   target, lens, dof)`, `lit.world(color)`, `lit.area_light(...)`, `lit.material(...)`,
   `lit.rounded_box(...)`, `lit.image_card(name, path)` for a fetched product image, and
   `lit.key(obj, prop, t, value)` to keyframe at film seconds. Pose the protagonist once and key it
   across the shots.
2. `render.mjs blender --out <d>` renders one preview still per shot, at half size and low samples, to
   `stage/plate-preview/`. Open them with the read tool and fix `scene.py` before the long render.
3. `render.mjs blender --out <d> --final --detach` renders every frame at 30 fps into `stage/plate/` with
   `plate.json`, the receipt the stage trusts (Blender version, device, samples, every frame by name
   and size). A plate is hundreds of Cycles frames and can take most of an hour; run it detached and
   wait for the exit file.
4. The page keeps the type, labels and panels and shows the plate behind them:
   `const plate = LitStage.plate({ parent: document.body, fps: 30, count: N })` and `plate(t)` in
   `render(t)`. The scaffold writes this for a Blender film. The stage then runs on the software rung.

Cycles runs on the GPU (Metal on Apple silicon, else the backend Blender finds, else the CPU, which the
receipt names). The seed is the treatment's, taken modulo 2^31, so a plate renders the same twice. A
missing `scene.py` or a failed Blender exits 17 with Blender's last lines; a stage render with no plate,
or a plate whose frame count is not `durationSec` times 30, exits 17 and names the command to run.
When Blender is not installed the command prints `FALLBACK:`; set `render3d` to `three`, build the world
in three.js and say in the reply that the film used the GPU rung because Blender is not installed.

## Camera moves

In a rich film most shots move the camera. On the three.js world, pose `cam.position` and the look-at
point from the shot's progress `s.p` on the style's `move` ease: a push-in (position toward the hero, the
field of view narrowing a little), a truck (position slides across while the look-at stays), a crane
(position rises while the look-at holds) and an orbit (position circles at a slow angle per second).
On a Blender plate, key the camera object with `lit.key`. Keep moves slow: a fast camera on a bright
specular surface flashes, and the flash audit decides.
