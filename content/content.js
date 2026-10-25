(() => {
  const defaults = {
    enabled: true,
    sensitivity: 5,
    dustDuration: 2200,
    dustDirection: "right",
  };
  let settings = { ...defaults },
    status = { active: false },
    host,
    root,
    lastNotice = "",
    loaded = false;
  const post = (type, data = {}) =>
    window.postMessage({ source: "SV_BRIDGE", type, ...data }, "*");
  const sync = () => {
    if (loaded)
      post("settings", {
        settings,
        processorURL: chrome.runtime.getURL("engine/processor.html"),
      });
  };
  chrome.storage.local.get(defaults).then((s) => {
    settings = s;
    loaded = true;
    sync();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
      for (const k of Object.keys(defaults))
        if (changes[k]) settings[k] = changes[k].newValue;
      sync();
    }
  });
  function paint() {
    if (location.protocol === "chrome-extension:") return;
    if (!status.active) {
      host?.remove();
      host = null;
      root = null;
      return;
    }
    if (!host) {
      host = document.createElement("div");
      host.style.cssText =
        "position:fixed;bottom:22px;right:22px;z-index:2147483647";
      root = host.attachShadow({ mode: "closed" });
      root.innerHTML = `<style>:host{font:12px system-ui;color:#eee}*{box-sizing:border-box}.panel{width:282px;padding:14px;background:#111319f5;border:1px solid #ffffff24;border-radius:17px;box-shadow:0 8px 35px #0005}header{display:flex;justify-content:space-between;font-weight:650;margin-bottom:9px}b{color:#c1b5ff}small{font-size:10px;color:#9ca0b4}p{margin:8px 0;color:#b5b8c7;line-height:1.5}button{background:#bca9ff;color:#171120;border:0;border-radius:9px;padding:9px 12px;font:600 12px system-ui;cursor:pointer}button:disabled{opacity:.4;cursor:default}.row{display:flex;gap:8px}.secondary{background:#ffffff12;color:#ddd}#note{font-size:11px;color:#d1c5fa}#stats{margin:8px 0 0;font-size:10px;color:#7f8598}</style><div class="panel"><header><span>✦ SNAP VANISH</span><b id="state"></b></header><p id="hint"></p><div class="row"><button id="snap">Vanish</button><button class="secondary" id="capture">Capture room</button></div><p id="note"></p><div id="stats"></div></div>`;
      root.querySelector("#snap").onclick = () =>
        post("command", { command: "trigger" });
      root.querySelector("#capture").onclick = () =>
        post("command", { command: "capture" });
      document.documentElement.appendChild(host);
    }
    root.querySelector("#state").textContent = !settings.enabled
      ? "OFF"
      : status.vanished
        ? "VANISHED"
        : status.transitioning
          ? "DUST"
          : status.roomReady
            ? "READY"
            : "SETUP";
    root.querySelector("#hint").textContent = status.failed
      ? "Processing paused. Switch the extension off to restore your camera."
      : status.captureSeconds
        ? `Step out of frame · ${status.captureSeconds}s`
        : !status.roomReady
          ? "Capture your empty room once before your first snap."
          : status.audioReady
            ? "Hold your snapping hand in view. Snap to vanish."
            : "Mic confirmation unavailable. Click inside the page or use the Vanish button.";
    root.querySelector("#snap").textContent = status.vanished
      ? "Reappear"
      : "Vanish";
    root.querySelector("#snap").disabled =
      !settings.enabled ||
      !status.roomReady ||
      status.transitioning ||
      status.failed;
    root.querySelector("#capture").disabled =
      !settings.enabled ||
      status.vanished ||
      status.transitioning ||
      !!status.captureSeconds;
    root.querySelector("#stats").textContent =
      `${status.width || 1920} × ${status.height || 1080} · ${status.fps || 0} fps · ${status.frameMs || 0} ms · ${status.delegate || "Local"}`;
    root.querySelector("#note").textContent = lastNotice;
  }
  window.addEventListener("message", ({ source, data: m }) => {
    if (source !== window || m?.source !== "SV_ENGINE") return;
    if (m.type === "hello") sync();
    if (m.type === "status") {
      status = m.status;
      paint();
    }
    if (m.type === "notice") {
      lastNotice = String(m.message).slice(0, 300);
      paint();
    }
  });
  chrome.runtime.onMessage.addListener((m, sender, reply) => {
    if (m.type === "SV_STATUS") {
      post("command", { command: "status" });
      reply(status);
    }
    if (m.type === "SV_COMMAND") {
      post("command", { command: m.command });
      reply({ ok: status.active });
    }
  });
  if (location.protocol === "chrome-extension:") {
    chrome.tabs.getCurrent().then((tab) => {
      chrome.runtime.onMessage.addListener((m, sender, reply) => {
        if (m.type !== "SV_STUDIO_REQUEST" || m.targetTabId !== tab?.id) return;
        if (m.request.type === "SV_STATUS") reply(status);
        if (m.request.type === "SV_COMMAND") {
          post("command", { command: m.request.command });
          reply({ ok: status.active });
        }
      });
    });
  }
})();
