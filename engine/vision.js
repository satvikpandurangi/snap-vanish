import {
  FilesetResolver,
  ImageSegmenter,
  HandLandmarker,
} from "../vendor/vision_bundle.mjs";
export class Vision {
  async init() {
    const files = await FilesetResolver.forVisionTasks(
      new URL("../vendor/wasm", import.meta.url).href,
    );
    const create = async (delegate) => {
      this.segmenter = await ImageSegmenter.createFromOptions(files, {
        baseOptions: {
          modelAssetPath: new URL(
            "../models/selfie_segmenter_landscape.tflite",
            import.meta.url,
          ).href,
          delegate,
        },
        runningMode: "VIDEO",
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      });
      try {
        this.hands = await HandLandmarker.createFromOptions(files, {
          baseOptions: {
            modelAssetPath: new URL(
              "../models/hand_landmarker.task",
              import.meta.url,
            ).href,
            delegate,
          },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.65,
          minHandPresenceConfidence: 0.65,
          minTrackingConfidence: 0.65,
        });
      } catch (e) {
        this.segmenter.close();
        throw e;
      }
    };
    try {
      await create("GPU");
      this.delegate = "GPU";
    } catch (e) {
      await create("CPU");
      this.delegate = "CPU";
    }
  }
  segment(image, t) {
    let mask;
    this.segmenter.segmentForVideo(image, t, (r) => {
      const m = r.confidenceMasks[0];
      mask = {
        width: m.width,
        height: m.height,
        data: new Float32Array(m.getAsFloat32Array()),
      };
    });
    return mask;
  }
  detect(image, t) {
    return this.hands.detectForVideo(image, t);
  }
  close() {
    this.segmenter?.close();
    this.hands?.close();
  }
}
