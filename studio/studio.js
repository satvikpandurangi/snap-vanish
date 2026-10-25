const $ = (id) => document.getElementById(id);
let stream = null,
  status = {},
  settings = await chrome.storage.local.get({
    enabled: true,
    sensitivity: 5,
    dustDuration: 2200,
    dustDirection: "right",
  });
const post = (command) =>
  window.postMessage({ source: "SV_BRIDGE", type: "command", command }, "*");
const metric = (id, value, sub) => {
  const el = $(id);
  el.replaceChildren(document.createTextNode(value));
  const small = document.createElement("small");
  small.textContent = sub;
  el.append(small);
};
function render() {
  $("enabled").checked = settings.enabled;
  $("duration").value = settings.dustDuration;
  $("sensitivity").value = settings.sensitivity;
  $("durationValue").textContent =
    (settings.dustDuration / 1000).toFixed(1) + " s";
  $("sensitivityValue").textContent = settings.sensitivity + " / 10";
  document
    .querySelectorAll("[data-direction]")
    .forEach((b) =>
      b.setAttribute(
        "aria-pressed",
        String(b.dataset.direction === settings.dustDirection),
      ),
    );
  $("trigger").disabled =
    !settings.enabled ||
    !status.active ||
    !status.roomReady ||
    status.transitioning ||
    status.failed;
  $("trigger").querySelector("span").textContent = status.vanished
    ? "Reappear"
    : "Vanish";
  $("capture").disabled =
    !settings.enabled ||
    !status.active ||
    status.vanished ||
    status.transitioning ||
    !!status.captureSeconds;
  $("stop").disabled = !stream;
  $("empty").hidden = !!stream;
  $("empty").style.display = stream ? "none" : "flex";
  $("cameraLabel").hidden = !stream;
  $("state").textContent = !stream
    ? "Camera disconnected"
    : !status.active
      ? "Effect unavailable"
      : !settings.enabled
        ? "Effect switched off"
        : status.failed
          ? "Processing paused"
          : status.vanished
            ? "Vanished · microphone gated"
            : status.transitioning
              ? "Dust in motion"
              : status.roomReady
                ? "Ready for your snap"
                : "Capture your empty room";
  $("hint").textContent = !stream
    ? "Start here, then capture your room."
    : !status.active
      ? "See the diagnostic message below."
      : status.audioReady
        ? "Hand tracking + click confirmation active"
        : "Click inside the page to enable audio confirmation.";
  $("stateDot").style.background = status.roomReady ? "#b7cda8" : "#8a789d";
  $("liveDot").style.background = stream ? "#b7cda8" : "#5c5865";
  $("roomCheck").textContent = status.roomReady ? "✓" : "○";
  $("countdown").hidden = !status.captureSeconds;
  $("countdown").querySelector("b").textContent = status.captureSeconds || 5;
  $("stageLabel").textContent = status.vanished
    ? "EMPTY ROOM · MICROPHONE GATED"
    : "YOUR CAMERA PREVIEW";
  metric(
    "fps",
    status.active ? String(status.fps || 0) : "—",
    "frames / second",
  );
  metric(
    "latency",
    status.active ? String(status.frameMs || 0) : "—",
    `ms frame path · vision ${status.inferenceMs || 0} ms`,
  );
  metric(
    "delegate",
    status.delegate || "Local AI",
    status.audioReady ? "hand + audio confirmation" : "waiting for microphone",
  );
  metric(
    "outputSize",
    "1920 × 1080",
    status.sourceWidth
      ? `camera: ${status.sourceWidth} × ${status.sourceHeight}`
      : "Full HD target",
  );
}
async function save(change) {
  Object.assign(settings, change);
  await chrome.storage.local.set(change);
  render();
}
$("start").onclick = async () => {
  $("start").disabled = true;
  $("start").textContent = "Starting local AI…";
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        aspectRatio: { ideal: 16 / 9 },
        frameRate: { ideal: 30, max: 30 },
      },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    $("preview").srcObject = stream;
    await $("preview").play();
    post("resumeAudio");
  } catch (e) {
    $("notice").textContent = `${e.name}: ${e.message}`;
  } finally {
    $("start").disabled = false;
    $("start").textContent = "Connect camera ↗";
    render();
  }
};
$("stop").onclick = () => {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  $("preview").srcObject = null;
  status = {};
  render();
};
$("trigger").onclick = () => post("trigger");
$("capture").onclick = () => post("capture");
$("duration").oninput = (e) => save({ dustDuration: Number(e.target.value) });
$("sensitivity").oninput = (e) => save({ sensitivity: Number(e.target.value) });
$("enabled").onchange = (e) => save({ enabled: e.target.checked });
document
  .querySelectorAll("[data-direction]")
  .forEach(
    (b) => (b.onclick = () => save({ dustDirection: b.dataset.direction })),
  );
window.addEventListener("message", ({ source, data: m }) => {
  if (source !== window || m?.source !== "SV_ENGINE") return;
  if (m.type === "status") {
    status = m.status;
    render();
  }
  if (m.type === "notice") $("notice").textContent = m.message;
});
window.addEventListener("pagehide", () =>
  stream?.getTracks().forEach((t) => t.stop()),
);
render();
