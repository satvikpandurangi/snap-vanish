# Contributing

## Get started

Clone the repository, then load its root folder through **Load unpacked** at `brave://extensions`. No compilation or dependency installation is required to run the extension.

For development tooling, use Node.js 22+ and run `npm install`.

## Before submitting a change

1. Run `npm test` for the deterministic gesture checks.
2. Run `npm run test:browser` on Windows with Brave installed. These checks use synthetic camera and microphone devices, not your webcam. They cover rendering orientation, room capture, audio gating and restoration, a local WebRTC receiver, and a restrictive-CSP test page.
3. Reload the extension and check the preview studio manually if the change affects the video pipeline or interface.
4. Run `npm run package` if the change affects files shipped to users. The unpacked result goes to `release/Snap-Vanish`; the ZIP is `snap-vanish.zip`.

Browser integration tests require a browser that allows loading unpacked extensions through command-line flags. Set `SNAP_BROWSER_PATH` to a different compatible browser executable, or `SNAP_PLAYWRIGHT_PATH` to an existing Playwright package directory. The current browser test defaults to Brave's standard Windows installation path.

## Keep local data out of commits

Do not commit webcam recordings, microphone samples, captured room plates, reference media, browser profiles, credentials, or `.work/`. Keep bundled model/runtime attribution and checksums with any dependency change.

## Bug reports

Include the browser/version, calling site, camera source resolution, reported output fps/frame time, and reproduction steps. State whether the issue also occurs in the preview studio. Screenshots should avoid showing other meeting participants or private room details.

## Scope and expectations

See [architecture](docs/architecture.md) and the README's performance/compatibility notes. A 1080p output canvas is not a guarantee of 1080p transmission, and synthetic tests do not certify a live calling service.
