/* Capture the native camera before the calling app starts. Pixels stay in this tab. */
(() => {
  if (window.__SNAP_VANISH_V2__ || !navigator.mediaDevices?.getUserMedia)
    return;
  window.__SNAP_VANISH_V2__ = true;
  const nativeGet = navigator.mediaDevices.getUserMedia.bind(
    navigator.mediaDevices,
  );
  const trackProto = MediaStreamTrack.prototype,
    enabledDescriptor = Object.getOwnPropertyDescriptor(trackProto, "enabled");
  const nativeClone = trackProto.clone,
    nativeStop = trackProto.stop;
  const audioTracks = new Map(),
    videoTracks = new Map(),
    sessions = new Set();
  let settings = {
      enabled: true,
      sensitivity: 5,
      dustDuration: 2200,
      dustDirection: "right",
    },
    processorURL = "",
    settingsLoaded = false;
  let detector = null,
    lastNotice = "",
    sequence = 0;
  const send = (type, data = {}) =>
    window.postMessage({ source: "SV_ENGINE", type, ...data }, "*");
  const gated = () => [...sessions].some((s) => s.gated);
  const applyGate = () => {
    for (const [t, desired] of audioTracks) {
      if (t.readyState === "ended") {
        audioTracks.delete(t);
        continue;
      }
      enabledDescriptor.set.call(t, gated() ? false : desired);
    }
  };
  const registerAudio = (t, desired = t.enabled) => {
    audioTracks.set(t, desired);
    if (gated()) enabledDescriptor.set.call(t, false);
  };
  Object.defineProperty(trackProto, "enabled", {
    ...enabledDescriptor,
    set(value) {
      if (audioTracks.has(this)) {
        audioTracks.set(this, Boolean(value));
        enabledDescriptor.set.call(this, gated() ? false : Boolean(value));
      } else enabledDescriptor.set.call(this, value);
    },
  });
  trackProto.clone = function () {
    const t = nativeClone.call(this);
    if (audioTracks.has(this)) registerAudio(t, audioTracks.get(this));
    const s = videoTracks.get(this);
    if (s) {
      s.outputs.add(t);
      videoTracks.set(t, s);
    }
    return t;
  };
  trackProto.stop = function () {
    nativeStop.call(this);
    audioTracks.delete(this);
    const s = videoTracks.get(this);
    if (s) {
      s.outputs.delete(this);
      videoTracks.delete(this);
      if (!s.outputs.size) s.close();
    }
    if (![...audioTracks.keys()].some((t) => t.readyState === "live")) {
      detector?.close();
      detector = null;
    }
  };
  function state() {
    const s = [...sessions].at(-1);
    return {
      active: !!s,
      enabled: settings.enabled,
      ...(s?.status || {}),
      audioReady: !!detector?.ready,
      muted: gated(),
      notice: lastNotice,
      sourceWidth: s?.video.videoWidth,
      sourceHeight: s?.video.videoHeight,
    };
  }
  function publish() {
    send("status", { status: state() });
  }
  function notice(message) {
    lastNotice = message;
    send("notice", { message });
    publish();
  }
  async function attachDetector(track) {
    if (detector?.origin === track && detector.track.readyState === "live")
      return;
    detector?.close();
    const clone = nativeClone.call(track);
    enabledDescriptor.set.call(clone, true);
    const context = new AudioContext({ latencyHint: "interactive" }),
      source = context.createMediaStreamSource(new MediaStream([clone]));
    const filter = context.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 1800;
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0;
    source.connect(filter);
    filter.connect(analyser);
    const samples = new Float32Array(512);
    let floor = 0.002,
      lastEnergy = 0,
      lastClick = -Infinity,
      timer;
    detector = {
      track: clone,
      origin: track,
      ready: false,
      context,
      close() {
        clearTimeout(timer);
        source.disconnect();
        nativeStop.call(clone);
        context.close().catch(() => {});
      },
    };
    const current = detector;
    const resume = () => context.resume().catch(() => {});
    if (context.state === "suspended") resume();
    const poll = () => {
      if (detector !== current) return;
      current.ready = context.state === "running";
      analyser.getFloatTimeDomainData(samples);
      let energy = 0,
        peak = 0;
      for (const x of samples) {
        energy += x * x;
        peak = Math.max(peak, Math.abs(x));
      }
      energy = Math.sqrt(energy / samples.length);
      const threshold = Math.max(
        0.009 + (11 - settings.sensitivity) * 0.002,
        floor * (4.6 - settings.sensitivity * 0.15),
      );
      if (
        energy > threshold &&
        energy > lastEnergy * 1.5 &&
        peak > energy * 2 &&
        performance.now() - lastClick > 180
      ) {
        lastClick = performance.now();
        for (const s of sessions) s.port.postMessage({ type: "click" });
      }
      floor = floor * 0.985 + Math.min(energy, floor * 2 + 0.002) * 0.015;
      lastEnergy = energy;
      timer = setTimeout(poll, 12);
    };
    poll();
    document.addEventListener("pointerdown", resume, { once: true });
  }
  async function waitBridge() {
    send("hello");
    const until = performance.now() + 2000;
    while (!settingsLoaded && performance.now() < until)
      await new Promise((r) => setTimeout(r, 20));
  }
  async function createSession(raw) {
    if (!document.documentElement)
      await new Promise((r) =>
        document.addEventListener("DOMContentLoaded", r, { once: true }),
      );
    const id = ++sequence,
      video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream(raw.getVideoTracks());
    await video.play();
    const canvas = document.createElement("canvas");
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    ctx.drawImage(video, 0, 0, 1920, 1080);
    const stream = canvas.captureStream(30),
      output = stream.getVideoTracks()[0];
    const iframe = document.createElement("iframe");
    iframe.src = processorURL;
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText =
      "position:fixed;width:1px;height:1px;left:-10px;top:0;border:0;pointer-events:none;opacity:0";
    const channel = new MessageChannel(),
      port = channel.port1;
    let readyResolve, readyReject;
    const ready = new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    const s = {
      id,
      video,
      canvas,
      port,
      outputs: new Set([output]),
      gated: false,
      status: {
        roomReady: false,
        vanished: false,
        fps: 0,
        width: 1920,
        height: 1080,
      },
      closed: false,
    };
    let busy = false,
      lastSent = 0,
      timeout,
      frameTimer,
      watchdog,
      frameErrors = 0;
    s.close = (keepRaw = false) => {
      if (s.closed) return;
      s.closed = true;
      clearTimeout(timeout);
      clearTimeout(frameTimer);
      clearInterval(watchdog);
      port.close();
      iframe.remove();
      video.pause();
      video.srcObject = null;
      if (!keepRaw) raw.getVideoTracks().forEach((t) => nativeStop.call(t));
      for (const t of s.outputs) {
        videoTracks.delete(t);
        nativeStop.call(t);
      }
      s.outputs.clear();
      sessions.delete(s);
      applyGate();
      if (!sessions.size && !audioTracks.size) {
        detector?.close();
        detector = null;
      }
      publish();
    };
    port.onmessage = ({ data: m }) => {
      if (s.closed) {
        m.frame?.close();
        return;
      }
      if (m.type === "ready") {
        clearTimeout(timeout);
        s.status.delegate = m.delegate;
        readyResolve();
      }
      if (m.type === "error") {
        if (sessions.has(s)) {
          s.status.failed = true;
          notice(m.message);
        } else readyReject(Error(m.message));
      }
      if (m.type === "frame") {
        ctx.drawImage(m.frame, 0, 0, canvas.width, canvas.height);
        m.frame.close();
        output.requestFrame?.();
        for (const t of s.outputs) if (t !== output) t.requestFrame?.();
        s.status.frameMs = Math.round(performance.now() - lastSent);
        busy = false;
        frameErrors = 0;
      }
      if (m.type === "frameError") {
        busy = false;
        frameErrors++;
        notice("Video processing error: " + m.message);
        if (frameErrors >= 3) {
          s.status.failed = true;
          publish();
        }
      }
      if (m.type === "visionError") {
        s.status.failed = true;
        notice("Vision processing error: " + m.message);
      }
      if (m.type === "gate") {
        s.gated = m.muted;
        applyGate();
        publish();
      }
      if (m.type === "transition") {
        s.status.transitioning = true;
        publish();
      }
      if (m.type === "status") {
        s.status = { ...s.status, ...m };
        delete s.status.type;
        publish();
      }
      if (m.type === "notice") notice(m.message);
    };
    iframe.onload = () =>
      iframe.contentWindow.postMessage(
        { type: "SV_CONNECT" },
        new URL(processorURL).origin,
        [channel.port2],
      );
    document.documentElement.appendChild(iframe);
    timeout = setTimeout(
      () =>
        readyReject(
          Error(
            "Local vision processor could not start. This site may block extension frames.",
          ),
        ),
      20000,
    );
    try {
      await ready;
    } catch (e) {
      s.close(true);
      throw e;
    }
    sessions.add(s);
    videoTracks.set(output, s);
    port.postMessage({ type: "settings", settings });
    raw
      .getVideoTracks()[0]
      .addEventListener("ended", () => s.close(), { once: true });
    const tick = async () => {
      if (s.closed) return;
      frameTimer = setTimeout(tick, 8);
      const t = performance.now();
      if (t - lastSent < 32 || video.readyState < 2) return;
      if (!settings.enabled) {
        lastSent = t;
        const vw = video.videoWidth,
          vh = video.videoHeight,
          sw = Math.min(vw, (vh * 16) / 9),
          sh = (sw * 9) / 16;
        ctx.drawImage(
          video,
          (vw - sw) / 2,
          (vh - sh) / 2,
          sw,
          sh,
          0,
          0,
          1920,
          1080,
        );
        output.requestFrame?.();
        return;
      }
      if (busy || s.status.failed) return;
      busy = true;
      lastSent = t;
      try {
        // Crop once to 16:9, preserving shape instead of stretching a 4:3 camera.
        const vw = video.videoWidth,
          vh = video.videoHeight,
          sw = Math.min(vw, (vh * 16) / 9),
          sh = (sw * 9) / 16;
        const frame = await createImageBitmap(
          video,
          (vw - sw) / 2,
          (vh - sh) / 2,
          sw,
          sh,
        );
        if (s.closed) {
          frame.close();
          return;
        }
        port.postMessage(
          {
            type: "frame",
            frame,
            width: 1920,
            height: 1080,
            audioReady: !!detector?.ready,
          },
          [frame],
        );
      } catch (e) {
        busy = false;
        notice(e.message);
      }
    };
    tick();
    // Never reveal the camera automatically after a failure while vanished.
    watchdog = setInterval(() => {
      if (settings.enabled && busy && performance.now() - lastSent > 3000) {
        s.status.failed = true;
        notice(
          "Processing stalled. Last frame held; turn the extension off to restore your camera.",
        );
      }
    }, 1000);
    publish();
    return { output, s };
  }
  navigator.mediaDevices.getUserMedia = async function (constraints) {
    await waitBridge();
    // Respect exact application constraints. Prefer 1080p when the app has no preference.
    let request = constraints;
    if (settings.enabled && constraints?.video) {
      const v = constraints.video === true ? {} : constraints.video;
      request = {
        ...constraints,
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30, max: 30 },
          ...v,
        },
      };
    }
    const raw = await nativeGet(request);
    for (const t of raw.getAudioTracks()) {
      registerAudio(t);
      attachDetector(t).catch((e) =>
        notice("Snap audio unavailable: " + e.message),
      );
    }
    if (
      !constraints?.video ||
      !settingsLoaded ||
      !settings.enabled ||
      !processorURL
    )
      return raw;
    try {
      const { output } = await createSession(raw);
      return new MediaStream([output, ...raw.getAudioTracks()]);
    } catch (e) {
      notice("Effect unavailable: " + e.message);
      return raw;
    }
  };
  window.addEventListener("message", ({ source, data: m }) => {
    if (source !== window || m?.source !== "SV_BRIDGE") return;
    if (m.type === "settings") {
      settings = { ...settings, ...m.settings };
      processorURL = m.processorURL || processorURL;
      settingsLoaded = true;
      for (const s of sessions) {
        s.port.postMessage({ type: "settings", settings });
        if (!settings.enabled) {
          s.status.failed = false;
          s.gated = false;
          s.status.vanished = false;
          s.status.transitioning = false;
        }
      }
      applyGate();
      publish();
    }
    if (m.type === "command") {
      if (m.command === "status") publish();
      else if (m.command === "resumeAudio") {
        detector?.context
          .resume()
          .then(publish)
          .catch(() => {});
      } else for (const s of sessions) s.port.postMessage({ type: m.command });
    }
  });
  window.addEventListener("pagehide", () => {
    for (const s of [...sessions]) s.close();
    detector?.close();
  });
  send("hello");
})();
