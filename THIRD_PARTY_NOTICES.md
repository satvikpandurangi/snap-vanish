# Bundled third-party assets

MediaPipe Tasks Vision 0.10.32, Google / MediaPipe authors.
- Package: https://www.npmjs.com/package/@mediapipe/tasks-vision/v/0.10.32
- Source: https://github.com/google-ai-edge/mediapipe
- License: Apache 2.0; see vendor/LICENSE.txt.
- Shipped runtime: vision_bundle.mjs and both SIMD and non-SIMD WASM loaders/binaries. Files are unmodified.

Hand Landmarker float16 revision 1:
- https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
- Guide/model information: https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker

Selfie Segmenter Landscape float16 revision 1:
- https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/1/selfie_segmenter_landscape.tflite
- Guide/model information: https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter

Model downloads and runtime packaging occurred during development. The installed extension loads every asset locally. See models/SHA256SUMS.txt for integrity hashes.

The user's reference image/video is not included in the release.
