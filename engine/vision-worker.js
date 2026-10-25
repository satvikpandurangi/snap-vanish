// Classic worker deliberately: MediaPipe's WASM loader uses importScripts.
// All assets are packaged. No remote code or model downloads at runtime.
let vision;
const ready = import("./vision.js")
  .then(async ({ Vision }) => {
    vision = new Vision();
    await vision.init();
    postMessage({ type: "ready", delegate: vision.delegate });
  })
  .catch((e) => postMessage({ type: "error", message: e.message }));
onmessage = async ({ data: m }) => {
  await ready;
  if (!vision || m.type !== "infer") {
    m.frame?.close();
    return;
  }
  const start = performance.now();
  try {
    const mask = m.segment ? vision.segment(m.frame, m.t) : null;
    const hands = m.detect ? vision.detect(m.frame, m.t) : null;
    postMessage(
      {
        type: "result",
        mask,
        hands,
        t: m.t,
        inferenceMs: Math.round(performance.now() - start),
      },
      mask ? [mask.data.buffer] : [],
    );
  } catch (e) {
    postMessage({ type: "frameError", message: e.message });
  } finally {
    m.frame.close();
  }
};
