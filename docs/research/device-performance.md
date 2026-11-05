# Running the planet well on every device

The question: how do we tell whether a device or connection is too weak for the live WebGL planet (the marketing hero and the
app's question stage), and what should it show instead, so the page looks as good as the device can manage and no worse.

Researched 2026-11-05. Browser support comes from MDN's browser-compat-data at commit `188707c73f` (2026-11-05). Each claim
links its source. Lines marked "measured" are from this repo's own runs on 2026-11-05.

## The short answer

You can't know ahead of time. Browsers expose very little about hardware, mostly in Chromium only, and Safari reports almost
nothing. Measure instead: draw the planet cheaply, watch how long frames take for a second or two, then raise or lower the
quality. Three.js's ecosystem (drei's `PerformanceMonitor`), react-three-fiber and Babylon.js all work this way. Use the few
hints browsers do give only to pick a safe starting point, and to skip the planet outright where the visitor has asked for
less (reduced motion, data saver).

## What the planet costs today (measured)

- It's a WebGL2 fragment shader with four map lookups per pixel, redrawn every frame. The app's stage draws at up to 2x device
  pixel ratio (`marketing/src/planet/earth.js`), the hero at up to 1.75x (`marketing/src/components/HomeHero.astro`).
- On a 1440 px desktop the drawn square is about 3 million pixels a frame at 2x, and about 0.8 million on a 402 px phone.
- On an Apple M5 in Helium, frames take 8.3 ms (median) at 120 Hz with the off-screen copy. Nothing slower has been tested.
- Download: four map images of about 725 KB (day 522 KB), the sky at 94 KB, and the still at 141 KB.
- Decoding and uploading the four maps take about 150 ms in all on the M5. The 4096 px day map is the largest share, about
  40 ms to decode and 50 ms to upload. The image format makes little difference: AVIF, WebP and JPEG are within a few
  milliseconds of each other at the same size.

## What each level costs (measured)

On 2026-11-05 the stage's real shader and maps were timed at the stage's real size (a 1440 x 562 box, planet radius 320),
each frame waited on until finished. The mock levels are `?quality=full|light|still` on `/results`.

| | Apple M5 GPU, per frame | Software renderer (SwiftShader), per frame |
|---|---|---|
| Full: 2x resolution, full shader, 4096 px day map | 1.4 ms | 83 ms |
| Light: 1x resolution, lighter shader, 2048 px day map | 0.8 ms | 8 ms |
| Full shader at 1x | 0.8 ms | 22 ms |
| Lighter shader at 2x | 1.2 ms | 28 ms |

On the M5 the numbers sit near a fixed cost of the timing itself, so they understate the gap. On the software renderer
dropping to 1x cuts the cost by about 4x, the lighter shader by about 3x more, and together by about 10x. The light level
also draws every other frame, so per second it does about a fortieth of the full level's work there.

The real stage page, frames per second over 4 seconds at 1440 x 900 and 2x:

| | Apple M5 GPU | Software renderer |
|---|---|---|
| Full | 110 | 5 |
| Light (the planet redraws 30 times a second) | 121 | 120 |
| Still | 110 | 45 |

The still level was slower than the light one on the software renderer. A likely cause is the soft fade mask on the still
image, which is costly to draw without a GPU; the light level hides that image once the live planet starts. Confining the
browser to the efficiency cores as well (`taskpolicy -c background`) slowed every level, the still included, to between 0.3
and 1.3 frames a second, which is harsher than any real device and so not useful.

## What was built, and what it measured (2026-11-05, evening)

The hero and the app's stage now share one planet: `marketing/src/planet/earth.js`, bundled into the marketing page and
served to the app by `app/question-stage/earth.js/route.ts`. It lives under `marketing/` because the marketing site's
Docker build sees only that folder.

The ladder, from `LEVELS` in `earth.js`:

| Level | What draws | Who starts there |
|---|---|---|
| 5 | Full shader, up to 2x resolution | Not a start level. The monitor raises a fast GPU to it |
| 4 | Full shader, up to 1.5x | Any GPU not named below, with more than 4 GB and 4 cores |
| 3 | Full shader, 1x | 4 GB or less, or 4 cores or fewer |
| 2 | Light shader, 1x | Not a start level. The monitor passes through it |
| 1 | Light shader, 0.75x, every other frame | Software renderers by name, a failed `failIfMajorPerformanceCaveat` context, old GPUs from Stripe's list, 2 GB or 2 cores |
| 0 | The still image and the ring's spark, no WebGL | Data saver or a 2G connection, and anything too slow at level 1 |

- The level reached is kept in `sessionStorage`, so it lasts for the visit and not beyond. The hero sends it to the app as
  the eighth number of `hero=`, because the two sites are different origins and can't read each other's storage.
- At level 0 the hero fetches the still only when it needs it, and crossfades it in over the live planet. The app skips
  the four map downloads when it knows it will draw the still.
- A bug skewed the earlier light-level figures. The light shader's `#define` swallowed the rest of its line, so it never
  compiled and every light level ran the full shader. With the fix, level 1 on SwiftShader went from 49 to 64 frames a
  second on the hero. The light shader keeps `highp` precision: at `mediump`, which is 16-bit on phone GPUs, pixel
  coordinates on a 1440 px screen round to several pixels.
- In Chromium on an M5 the hero runs at 120 fps on level 5. On SwiftShader the monitor takes the hero from level 1 to the
  still within a few seconds, and the hero at rest runs at about 117 fps.

### Showing that work is happening

The planet can't be the signal: at level 0 it doesn't move, and even at level 5 it turns slowly. Research for this
(`/tmp/q-mock/research-r3-alive-while-waiting.md`, summarised here) put the signal where the eye already is, the
visitor's own question:

1. A wave of light reads across the question's words while the query is written: one pass every 2.4 s, crossing the
   question in 1.6 s, each word dim (to 0.55) for a quarter of the pass, so three or four words are dim at once. When the
   query arrives the pass it's on finishes, and the underlines of the matched words follow it across.
2. A status line under the question names only real steps, "Writing a search query", then "Finding papers". It appears
   after a second, and after 8 seconds it shows the elapsed seconds. It is the stage's live region, in place of the
   question.
3. At levels 0 and 1 only, up to eight bright stars twinkle, one at a time.

Measured on SwiftShader at 1440 x 900 and 2x, level 0: the wave and the status line cost nothing measurable (117 to 121
fps against 120 with neither). The stars cost a lot when they twinkled together: two far apart took the page from 120 to
70 fps, because the browser redraws the rectangle that spans everything changing in a frame. Taking turns, one star at a
time, costs nothing measurable. The same rule applies to any future cue: things that change in the same frame should be
close together.

## What a browser tells you before anything draws

| Signal | Chrome / Edge | Firefox | Safari (macOS, iOS) | What it's good for |
|---|---|---|---|---|
| `navigator.deviceMemory` | yes (63+) | no | no | Rough RAM. From Chrome 147 desktop reports 2, 4, 8, 16 or 32, Android 1, 2, 4 or 8.[^bcd-nav] The spec rounds to one significant bit and clamps the range on purpose.[^devmem] |
| `navigator.hardwareConcurrency` | yes | yes | clamped to 4 or 8[^bcd-nav] | Weak alone: a cheap phone can have 8 slow cores. |
| `navigator.connection` `effectiveType`, `saveData`, `downlink`, `rtt` | yes | no | no | Data saver is a clear request for less. `downlink` never reports more than 10 Mbps and `rtt` never more than 3000 ms, to limit fingerprinting.[^bcd-net] |
| `Save-Data` request header | yes (experimental) | no | no | The server can see data saver too.[^bcd-headers] |
| `Sec-CH-Device-Memory` client hint | yes (experimental) | no | no | Memory on the server, after an opt-in.[^bcd-headers] |
| `prefers-reduced-motion` | yes | yes | yes | A user preference to honour: show the still, don't animate.[^bcd-media] |
| `prefers-reduced-data` | flag only | no | no | Not usable yet.[^bcd-media] |
| GPU name (`WEBGL_debug_renderer_info`) | yes | yes, deprecated | yes | `detect-gpu` maps names to tiers (below). In Safari the name is generic, so it tells you little there.[^bcd-gpu] |
| `GPUAdapterInfo` (WebGPU) | yes (desktop 144+, Android 121+) | Windows only | Safari 26+ | Vendor and architecture through WebGPU. Newer, coarse.[^bcd-gpu] |
| WebGL `failIfMajorPerformanceCaveat` | all | all | all | Asks for no context if "the system performance is low or if no hardware GPU is available".[^mdn-ctx] Older reports say Chrome's software renderer doesn't always trip it, so treat a context as a maybe, not a yes.[^khronos] |
| Media Capabilities `decodingInfo()` | 66+ | 63+ | 13+ | Says whether a video would decode `smooth` and `powerEfficient`. Browsers report both as true until they have stats for that device, so a "true" is optimistic.[^mdn-media] |

Battery state (`navigator.getBattery`) is Chromium only and says nothing about speed.[^bcd-nav]

## Measuring while it runs

- **Frame timing (all browsers).** Record the gaps between `requestAnimationFrame` calls. Bounds have to follow the screen's
  refresh rate: a 120 Hz Mac at 70 fps is struggling, while a 60 Hz laptop at 58 fps is fine. drei measures the highest rate
  seen and sets the bounds from it.[^drei]
- **Safari's Low Power Mode caps `requestAnimationFrame` at about 30 fps, on purpose.** WebKit's test fixes the throttle
  interval at 30 ms, about 33 fps.[^webkit-lpm] A steady 30 in Safari therefore means the user wants to save power, not that
  the device is weak: treat it as a ceiling to respect, not a failure to climb out of.
- **Long Animation Frames (Chromium 123+).** Reports frames whose rendering was held up beyond 50 ms, and which scripts did
  it.[^loaf] [^bcd-perf] Good for catching a busy main thread. It doesn't see GPU time.
- **GPU timer queries** (`EXT_disjoint_timer_query_webgl2`): desktop Chrome and Edge only, nowhere else.[^bcd-gpu] Too patchy
  to rely on.
- **Compute Pressure (`PressureObserver`).** Desktop Chromium 125+, still experimental. Reports CPU pressure as `nominal`,
  `fair`, `serious` or `critical`, for sites to scale work down as it rises.[^pressure] [^bcd-perf] A useful extra signal there.
- **Download speed (all browsers).** Resource Timing gives each file's size and timings, so bandwidth can be worked out from
  the hero's own downloads.[^bcd-perf] For files from another origin (the hero fetching the app's images) the sizes read as
  zero unless that server sends `Timing-Allow-Origin`.[^restiming]

## How mature libraries do it

- **drei `PerformanceMonitor`** (three.js ecosystem).[^drei] It averages the frame rate over 250 ms windows, keeps 10 of
  them, and acts when 75% of those agree. It steps quality down when they're below the lower bound and up when they're above
  the upper one. The default bounds are 60 to 100 fps on screens over 100 Hz and 40 to 60 fps otherwise. A `flipflops` limit
  catches a device that keeps bouncing between levels and holds it at a fixed baseline. Its documented example adjusts the
  drawing resolution between 0.5x and 2x.
- **react-three-fiber.**[^r3f] Recommends rendering only when something changes, "movement regression" (drop resolution and
  heavy effects while things move, as Sketchfab does), and the monitor above.
- **Babylon.js `SceneOptimizer`.**[^babylon] Aims for a target frame rate (60 by default), checks every 2 seconds, and works
  through a priority list of quality cuts. Resolution scaling is first in its example. It can run the other way too, adding
  quality back while there's headroom.
- **`@pmndrs/detect-gpu`.**[^detect-gpu] Turns the GPU name into a tier (1, 2 or 3 at 15, 30 and 60 fps) from GFXBench scores,
  for a sensible first guess. Its data source stopped updating in December 2025, and Safari's generic GPU names limit it.
  Fine as a starting hint, not as the decision.

## What to show when it can't run

In order, from smallest to biggest loss:

1. **Lower resolution.** Each step from 2x towards 1x cuts pixel work by roughly the square: at 1x it's a quarter of 2x. All
   three libraries reach for this first.[^drei] [^babylon]
2. **A lower frame rate.** Drawing every other frame halves the cost. The planet turns slowly (about 0.05 radians a second),
   so 30 fps still looks smooth.
3. **A lighter shader.** Drop the cloud shadow, sea glint and second cloud lookup (fewer map reads per pixel), and use the
   2048 px day map. Measured: it decodes in about 13 ms against about 40 ms at 4096 px.
4. **The still image,** placed exactly as now. No GPU cost after it's drawn, and the stage already uses it for direct visitors.
5. **Video.** Hardware decoding makes it cheap to draw, but it costs more to download than the maps. A seamless full turn is
   about 2 minutes long at the hero's speed. A transparent background is needed because the planet sits between the ring's
   halves over a changing sky. WebM with transparency plays in Chrome (VP8 and VP9)[^chrome-alpha] and WebKit has supported
   transparent video since Safari 13,[^webkit13] so two files would be needed. It can't show the lighting changes (the sun
   swinging behind the planet, the light wave) except as fixed clips. It helps weak devices, not slow connections.

## Recommendation

1. **Respect what's asked.** Reduced motion means the still and no motion. Data saver, or a 2G/slow-2G `effectiveType`,
   means no live planet and none of the hero's background downloads.
2. **Start cheap and step up.** Draw the hero's planet at 1x first. Over the first 2 seconds, measure with drei's method:
   bounds set from the measured refresh rate, a 30 fps ceiling in Safari Low Power Mode, and a flip-flop limit. Step up to
   1.5x and 2x while there's headroom, and down through 30 fps, the lighter shader, then the still while there isn't.
   `deviceMemory` of 2 GB or less, or a failed `failIfMajorPerformanceCaveat` context, only lowers the starting level.
3. **Remember it for the visit.** Keep the level reached for the visit only (`sessionStorage`), as production heroes do: a
   device that was slow on battery saver yesterday may not be today. Send it to the app in the `hero=` address, as the
   planet's rotation already is, so the stage starts at the same level without measuring again.
4. **Keep watching cheaply.** Keep sampling frame times, and in Chromium the CPU pressure, so a device that heats up or
   switches to battery saver steps down mid-visit.
5. **Size the downloads to the connection.** Time the hero's own downloads (same origin, no extra header) to decide whether
   to fetch the app's maps in the background, and whether to fetch the 2048 or 4096 px day map. Add `Timing-Allow-Origin`
   for the marketing origin on the app's `/question-stage/` files if they need timing as well.
6. **Don't build video for now.** It solves only weak devices, costs more download than it saves, and loses the lighting. The
   lower resolution, the lighter shader and the still cover weak devices more cheaply.

## Not yet known

- How the planet runs on real weak hardware: an older iPhone, a low-end Android phone, a laptop with integrated graphics.
  Chrome's CPU throttling slows JavaScript but not the GPU, so it can't stand in for these.
- Whether current Chrome trips `failIfMajorPerformanceCaveat` when it falls back to software rendering. The sources found
  are old forum and mailing-list posts.[^khronos]
- Whether Safari still caps Low Power Mode at 30 fps today. The sources are a 2020 WebKit bug and the test on WebKit's main
  branch.[^webkit-lpm]

[^bcd-nav]: MDN browser-compat-data, `api/Navigator.json` (deviceMemory, hardwareConcurrency, connection, getBattery, gpu). https://github.com/mdn/browser-compat-data/blob/main/api/Navigator.json
[^bcd-net]: MDN browser-compat-data, `api/NetworkInformation.json`. https://github.com/mdn/browser-compat-data/blob/main/api/NetworkInformation.json
[^bcd-headers]: MDN browser-compat-data, `http/headers/Save-Data.json`, `Device-Memory.json`, `Sec-CH-Device-Memory.json`, `Timing-Allow-Origin.json`. https://github.com/mdn/browser-compat-data/tree/main/http/headers
[^bcd-media]: MDN browser-compat-data, `css/at-rules/media.json`. https://github.com/mdn/browser-compat-data/blob/main/css/at-rules/media.json
[^bcd-gpu]: MDN browser-compat-data, `api/WEBGL_debug_renderer_info.json`, `api/GPUAdapterInfo.json`, `api/EXT_disjoint_timer_query_webgl2.json`. https://github.com/mdn/browser-compat-data/tree/main/api
[^bcd-perf]: MDN browser-compat-data, `api/PerformanceLongAnimationFrameTiming.json`, `api/PressureObserver.json`, `api/PerformanceResourceTiming.json`. https://github.com/mdn/browser-compat-data/tree/main/api
[^devmem]: W3C, Device Memory. https://www.w3.org/TR/device-memory/
[^mdn-ctx]: MDN, `HTMLCanvasElement.getContext()`, context attributes. https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext
[^khronos]: Khronos public_webgl mailing list, 2013, on software rendering and the performance caveat. https://www.khronos.org/webgl/public-mailing-list/public_webgl/1309/msg00024.php
[^mdn-media]: MDN, `MediaCapabilities.decodingInfo()`. https://developer.mozilla.org/en-US/docs/Web/API/MediaCapabilities/decodingInfo
[^drei]: pmndrs/drei, `src/core/PerformanceMonitor.tsx` and its documentation. https://github.com/pmndrs/drei/blob/master/src/core/PerformanceMonitor.tsx
[^r3f]: pmndrs/react-three-fiber, "Scaling performance". https://github.com/pmndrs/react-three-fiber/blob/master/docs/advanced/scaling-performance.mdx
[^babylon]: Babylon.js documentation, "The Scene Optimizer". https://doc.babylonjs.com/features/featuresDeepDive/scene/sceneOptimizer
[^detect-gpu]: pmndrs/detect-gpu, README and `src/index.ts`. https://github.com/pmndrs/detect-gpu
[^webkit-lpm]: WebKit bug 215745 ("Throttling requestAnimationFrame to 30 FPS in low power mode"), closed as intended; WebKit layout test `request-animation-frame-throttling-lowPowerMode.html`. https://bugs.webkit.org/show_bug.cgi?id=215745 and https://github.com/WebKit/WebKit/blob/main/LayoutTests/fast/animation/request-animation-frame-throttling-lowPowerMode.html
[^loaf]: Chrome for Developers, "Long Animation Frames API". https://developer.chrome.com/docs/web-platform/long-animation-frames
[^pressure]: Chrome for Developers, "Compute Pressure API". https://developer.chrome.com/docs/web-platform/compute-pressure
[^restiming]: W3C, Resource Timing, section on the `Timing-Allow-Origin` header. https://www.w3.org/TR/resource-timing/
[^chrome-alpha]: Chrome for Developers, "Alpha transparency in Chrome video". https://developer.chrome.com/blog/alpha-transparency-in-chrome-video/
[^webkit13]: WebKit blog, "New WebKit Features in Safari 13". https://webkit.org/blog/9246/new-webkit-features-in-safari-13/
