# Architecture

Snap Vanish is a Manifest V3 extension. The release runs directly from the checked-in JavaScript, packaged WASM runtime, and model files.

## Components

| Component | Responsibility |
| --- | --- |
| `injected/snap-engine.js` | Runs in the page's main JavaScript world at document start; wraps camera acquisition, substitutes output video tracks, gates outgoing audio, and manages per-camera lifecycle. |
| `content/content.js` | Runs in the isolated extension world; bridges preferences and commands to the page and presents the small in-call panel. |
| `engine/processor.html` / `processor.js` | Extension-origin processing frame; owns the compositor, transition state, room capture, and worker coordination. |
| `engine/vision-worker.js` / `vision.js` | Runs MediaPipe person segmentation and hand landmarks independently of full-resolution rendering. |
| `engine/renderer.js` | WebGL 2 composition, directional dissolve field, and color-sampled dust particles. |
| `engine/snap.js` | Temporal landmark state machine; requires middle-finger/thumb pinch, rapid relative motion, and a recent acoustic click. |
| `popup/` | Controls and diagnostics for the active camera tab. |
| `studio/` | Camera preview, first-use room capture, effect settings, and performance readouts. |
| `background/background.js` | Initializes preferences and routes keyboard commands. |

## Camera path

The main-world hook calls the native `getUserMedia` API with the application's constraints, preferring 1080p/30 fps when the application has not specified those fields. It keeps the raw video in a private video element and returns a canvas capture track to the calling application.

A private `MessageChannel` transfers camera images to the extension-origin processor. The compositor draws at 1920 × 1080. At most one video request is in flight, so a slow renderer drops incoming opportunities instead of accumulating a queue. A separate inference request uses a 640 × 360 image; its results update the segmentation mask and gesture state without blocking the next video render.

Images transferred as `ImageBitmap` need explicit texture-coordinate orientation handling because their WebGL upload behavior differs from DOM canvas/image sources. Browser tests verify orientation and mask alignment at the pixel level.

## Empty room and transition

Room capture waits five seconds and rejects a frame if recent segmentation still detects a substantial person region. The plate remains in memory for the current camera session. It is a real background image, not generative inpainting.

On a trigger, the renderer stores a person image and mask, generates particles only inside the person, and removes that image along an irregular directional front. Particle color comes from the stored person texture. The vanished state displays the captured room. Return uses a fresh person snapshot and reverses the dust trajectories; visible steady-state output returns to live video.

## Audio path

The outgoing audio track and its registered clones are disabled while any active camera session is vanished. Desired enabled state is remembered separately, so an already-muted microphone remains muted after returning. A local clone feeds a transient detector and is never added to the outgoing stream. This lets a second snap be heard locally while meeting audio is gated.

The extension does not click a calling site's microphone button. That avoids fragile selectors and prevents accidental changes to unrelated call controls; it also means the site's mute icon may not reflect the extension's audio gate.

## Failure handling and privacy

If vision startup fails, the original camera stream is returned with a diagnostic. If processing stalls during a running session, the last output frame is held; disabling the effect restores the live camera. Camera-session cleanup closes the channel, removes the processor frame and its worker, and stops the owned video tracks.

All runtime assets are local. Preferences are persisted using extension storage. Frames, audio samples, model results and room plates are held in memory. The calling application still transmits its outgoing processed feed to participants normally.

## Boundaries

The hook covers page/frame `getUserMedia` capture on allowed sites. Native applications, screen-sharing streams, worker-side acquisition, site-specific capture bypasses, browser policy restrictions, and meeting-service resolution/bandwidth controls are outside its guarantees. See the README for current validation and performance limitations.
