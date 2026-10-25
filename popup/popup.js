const $ = (id) => document.getElementById(id);
const defaults = {
  enabled: true,
  sensitivity: 5,
  dustDuration: 2200,
  dustDirection: "right",
};
let activeTab,
  settings,
  status = { active: false };
async function request(message) {
  try {
    return await chrome.tabs.sendMessage(activeTab.id, message);
  } catch {
    return await chrome.runtime.sendMessage({
      type: "SV_STUDIO_REQUEST",
      targetTabId: activeTab.id,
      request: message,
    });
  }
}
async function command(command) {
  if (activeTab?.id)
    try {
      await request({ type: "SV_COMMAND", command });
    } catch {}
}
function render() {
  $("enabled").checked = settings.enabled;
  $("sensitivity").value = settings.sensitivity;
  $("duration").value = settings.dustDuration;
  $("sensitivityValue").textContent = `${settings.sensitivity} / 10`;
  $("durationValue").textContent =
    `${(settings.dustDuration / 1000).toFixed(1)} s`;
  document
    .querySelectorAll("[data-direction]")
    .forEach((b) =>
      b.setAttribute(
        "aria-pressed",
        String(b.dataset.direction === settings.dustDirection),
      ),
    );
  $("state").textContent = !settings.enabled
    ? "Effect switched off"
    : !status.active
      ? "Waiting for your camera"
      : status.failed
        ? "Processing paused"
        : status.captureSeconds
          ? `Room capture in ${status.captureSeconds}s`
          : status.vanished
            ? "Vanished · microphone gated"
            : status.transitioning
              ? "The dust is moving…"
              : status.roomReady
                ? "Ready for your snap"
                : "One step to movie magic";
  $("detail").textContent = status.active
    ? `${status.width || 1920} × ${status.height || 1080} · ${status.fps || 0} fps · ${status.frameMs || 0} ms frame processing`
    : "Open a call or try the preview studio.";
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
  $("help").textContent =
    status.notice ||
    (status.active && !status.audioReady
      ? "Mic click confirmation needs an active microphone. Manual controls are ready."
      : "Capture an empty room once. Step back in, then snap.");
  $("dot").style.background = status.roomReady ? "#b7dca5" : "#a091bf";
}
async function save(change) {
  Object.assign(settings, change);
  await chrome.storage.local.set(change);
  render();
}
async function poll() {
  try {
    status = (await request({ type: "SV_STATUS" })) || { active: false };
  } catch {
    status = { active: false };
  }
  render();
}
(async () => {
  settings = await chrome.storage.local.get(defaults);
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  render();
  await poll();
  setInterval(poll, 700);
  $("enabled").onchange = (e) => save({ enabled: e.target.checked });
  $("sensitivity").oninput = (e) =>
    save({ sensitivity: Number(e.target.value) });
  $("duration").oninput = (e) => save({ dustDuration: Number(e.target.value) });
  document
    .querySelectorAll("[data-direction]")
    .forEach(
      (b) => (b.onclick = () => save({ dustDirection: b.dataset.direction })),
    );
  $("trigger").onclick = () => command("trigger");
  $("capture").onclick = () => command("capture");
  $("studio").onclick = () =>
    chrome.tabs.create({ url: chrome.runtime.getURL("studio/index.html") });
})();
