import { DustRenderer } from "./renderer.js";
import { SnapGesture } from "./snap.js";
let connected = false;
window.addEventListener("message", async (event) => {
  if (
    connected ||
    event.source !== parent ||
    event.data?.type !== "SV_CONNECT" ||
    !event.ports[0]
  )
    return;
  connected = true;
  const port = event.ports[0],
    emit = (type, data = {}) => port.postMessage({ type, ...data });
  let renderer, worker;
  try {
    renderer = new DustRenderer(document.querySelector("canvas"));
    worker = new Worker(new URL("vision-worker.js", import.meta.url));
  } catch (e) {
    emit("error", { message: e.message });
    return;
  }
  const gesture = new SnapGesture();
  let settings = {
    enabled: true,
    sensitivity: 5,
    dustDuration: 2200,
    dustDirection: "right",
  };
  let roomReady = false,
    vanished = false,
    animation = null,
    captureAt = 0,
    lastMask = 0,
    lastStatus = 0,
    frames = 0,
    fpsStart = performance.now(),
    fps = 0;
  let mask,
    latest,
    handCount = 0,
    delegate = "",
    inferenceBusy = false,
    inferenceMs = 0,
    maskTime = 0,
    inferenceStarted = 0,
    pendingTrigger = false;
  const toggle = (t) => {
    if (!settings.enabled || !roomReady || animation || !mask || !latest)
      return false;
    renderer.setMask(mask);
    renderer.snapshot(latest);
    animation = { start: t, returning: vanished };
    if (!vanished) emit("gate", { muted: true });
    emit("transition", { vanished: !vanished });
    return true;
  };
  worker.onmessage = ({ data: m }) => {
    if (m.type === "ready") {
      delegate = m.delegate;
      emit("ready", { delegate });
    }
    if (m.type === "error") emit("error", { message: m.message });
    if (m.type === "result") {
      inferenceBusy = false;
      inferenceMs = m.inferenceMs;
      if (m.mask) {
        mask = m.mask;
        maskTime = m.t;
        if (!animation) renderer.setMask(mask);
      }
      if (m.hands) {
        handCount = m.hands.landmarks.length;
        if (gesture.update(m.hands, m.t, settings.sensitivity))
          pendingTrigger = true;
      }
    }
    if (m.type === "frameError") {
      inferenceBusy = false;
      emit("visionError", { message: m.message });
    }
  };
  worker.onerror = (e) =>
    emit("error", { message: e.message || "Vision worker failed." });
  port.onmessage = async ({ data: m }) => {
    try {
      if (m.type === "settings") {
        Object.assign(settings, m.settings);
        if (!settings.enabled) {
          animation = null;
          vanished = false;
          emit("gate", { muted: false });
          gesture.reset();
        }
        return;
      }
      if (m.type === "click") {
        gesture.click(performance.now());
        return;
      }
      if (m.type === "trigger") {
        pendingTrigger = true;
        return;
      }
      if (m.type === "capture") {
        if (!vanished && !animation) {
          captureAt = performance.now() + 5000;
          emit("notice", {
            message: "Step out of view. Capturing the empty room in 5 seconds.",
          });
        }
        return;
      }
      if (m.type === "reset") {
        roomReady = false;
        captureAt = 0;
        animation = null;
        vanished = false;
        emit("gate", { muted: false });
        return;
      }
      if (m.type !== "frame") return;
      const start = performance.now(),
        t = start;
      latest = m.frame;
      try {
        if (settings.enabled && !inferenceBusy) {
          inferenceBusy = true;
          inferenceStarted = t;
          const segment = t - lastMask > 65;
          if (segment) lastMask = t;
          createImageBitmap(latest, {
            resizeWidth: 640,
            resizeHeight: 360,
            resizeQuality: "low",
          })
            .then((frame) =>
              worker.postMessage(
                { type: "infer", frame, t, segment, detect: m.audioReady },
                [frame],
              ),
            )
            .catch((e) => {
              inferenceBusy = false;
              emit("notice", { message: e.message });
            });
        }
        if (inferenceBusy && t - inferenceStarted > 8000)
          throw Error("Vision inference stalled. Reconnect the camera.");
        if (pendingTrigger) {
          pendingTrigger = false;
          if (!toggle(t))
            emit("notice", {
              message: roomReady
                ? "Wait for the transition to finish."
                : "Capture an empty room first.",
            });
        }
        if (captureAt && t >= captureAt) {
          const coverage =
            mask && t - maskTime < 700
              ? mask.data.reduce((n, v) => n + (v > 0.6), 0) / mask.data.length
              : 1;
          if (coverage > 0.018)
            emit("notice", {
              message:
                "A person is still in view. Step fully out, then capture again.",
            });
          else {
            renderer.upload("room", latest);
            roomReady = true;
            emit("notice", {
              message: "Empty room captured. Return to your seat.",
            });
          }
          captureAt = 0;
        }
        let progress = vanished ? 1 : 0,
          mode = vanished ? 3 : 0;
        if (animation) {
          const elapsed = Math.min(
            1,
            (t - animation.start) / settings.dustDuration,
          );
          progress = animation.returning ? 1 - elapsed : elapsed;
          mode = 1;
          if (elapsed >= 1) {
            vanished = !animation.returning;
            animation = null;
            mode = vanished ? 3 : 0;
            if (!vanished) emit("gate", { muted: false });
          }
        }
        renderer.render(latest, {
          width: m.width,
          height: m.height,
          progress,
          mode,
          direction: settings.dustDirection,
        });
        const bitmap = await createImageBitmap(renderer.canvas);
        port.postMessage({ type: "frame", frame: bitmap }, [bitmap]);
        frames++;
        if (t - fpsStart >= 1000) {
          fps = Math.round((frames * 1000) / (t - fpsStart));
          frames = 0;
          fpsStart = t;
        }
        if (t - lastStatus > 350) {
          lastStatus = t;
          emit("status", {
            roomReady,
            vanished,
            transitioning: !!animation,
            captureSeconds: captureAt
              ? Math.max(0, Math.ceil((captureAt - t) / 1000))
              : 0,
            fps,
            workMs: Math.round(performance.now() - start),
            inferenceMs,
            delegate,
            handCount,
            width: m.width,
            height: m.height,
          });
        }
      } finally {
        latest.close();
        latest = null;
      }
    } catch (e) {
      emit(m.type === "frame" ? "frameError" : "notice", {
        message: e.message,
      });
    }
  };
});
