const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require(process.env.SNAP_PLAYWRIGHT_PATH || "playwright");
const root = path.resolve(__dirname, "..").replaceAll("\\", "/");
fs.mkdirSync(path.join(root, ".work"), { recursive: true });
const assert = require("node:assert/strict");
(async () => {
  const c = await chromium.launchPersistentContext(
    path.join(root, ".work/browser-profile"),
    {
      headless: true,
      executablePath:
        process.env.SNAP_BROWSER_PATH ||
        "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
      viewport: { width: 1500, height: 1050 },
      args: [
        "--disable-extensions-except=" + root,
        "--load-extension=" + root,
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
        "--enable-unsafe-swiftshader",
      ],
      ignoreDefaultArgs: ["--disable-extensions"],
    },
  );
  try {
    const worker =
        c.serviceWorkers()[0] ||
        (await c.waitForEvent("serviceworker", { timeout: 15000 })),
      base = "chrome-extension://" + new URL(worker.url()).host;
    console.log("BASE", base);
    const p = await c.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(base + "/studio/index.html");
    await p.evaluate(() => {
      window.testStates = [];
      window.addEventListener("message", (e) => {
        if (e.data?.source === "SV_ENGINE" && e.data.type === "status") {
          window.testStatus = e.data.status;
          window.testStates.push(e.data.status);
        }
      });
    });
    const pixels = await p.evaluate(async () => {
      const { DustRenderer } = await import("../engine/renderer.js");
      const source = document.createElement("canvas");
      source.width = 64;
      source.height = 64;
      const ctx = source.getContext("2d");
      ctx.fillStyle = "red";
      ctx.fillRect(0, 0, 64, 32);
      ctx.fillStyle = "blue";
      ctx.fillRect(0, 32, 64, 32);
      const image = await createImageBitmap(source),
        out = document.createElement("canvas"),
        r = new DustRenderer(out);
      const read = () => {
        const c = document.createElement("canvas");
        c.width = 64;
        c.height = 64;
        const x = c.getContext("2d");
        x.drawImage(out, 0, 0);
        return [
          [...x.getImageData(2, 2, 1, 1).data],
          [...x.getImageData(2, 60, 1, 1).data],
        ];
      };
      r.render(image, { width: 64, height: 64 });
      const live = read();
      const room = document.createElement("canvas");
      room.width = 64;
      room.height = 64;
      const bg = room.getContext("2d");
      bg.fillStyle = "#00ff00";
      bg.fillRect(0, 0, 64, 64);
      r.upload("room", await createImageBitmap(room));
      r.setMask({
        width: 64,
        height: 64,
        data: Float32Array.from({ length: 4096 }, (_, i) => (i < 2048 ? 1 : 0)),
      });
      r.snapshot(image);
      r.render(image, { width: 64, height: 64, mode: 1, progress: 0 });
      const start = read();
      r.render(image, { width: 64, height: 64, mode: 3, progress: 1 });
      const empty = read();
      image.close();
      return { live, start, empty, error: r.gl.getError() };
    });
    assert.deepEqual(pixels, {
      live: [
        [255, 0, 0, 255],
        [0, 0, 255, 255],
      ],
      start: [
        [255, 0, 0, 255],
        [0, 255, 0, 255],
      ],
      empty: [
        [0, 255, 0, 255],
        [0, 255, 0, 255],
      ],
      error: 0,
    });
    console.log("PIXEL ORIENTATION, SEGMENTATION MASK, EMPTY ROOM PASSED");
    await p.locator("#start").click();
    await p.waitForFunction(() => window.testStatus?.active, {
      timeout: 30000,
    });
    await p.waitForFunction(() => window.testStatus?.fps > 0);
    console.log("RUNNING", await p.evaluate(() => window.testStatus));
    assert.equal(
      await p
        .locator("#preview")
        .evaluate((v) => v.srcObject.getVideoTracks()[0].getSettings().width),
      1920,
    );
    await p.evaluate(() => {
      const a = document
        .querySelector("#preview")
        .srcObject.getAudioTracks()[0];
      window.testAudio = a;
      window.testClone = a.clone();
    });
    console.log(
      "CAPTURE BUTTON",
      await p
        .locator("#capture")
        .evaluate((b) => ({ disabled: b.disabled, text: b.textContent })),
    );
    await p.screenshot({ path: path.join(root, ".work/before-capture.png") });
    await p.locator("#capture").click();
    await p.waitForFunction(() => window.testStatus?.roomReady, {
      timeout: 12000,
    });
    console.log("ROOM READY");
    // Receive the actual outgoing camera on a second WebRTC peer, without network servers.
    console.log(
      "RTC",
      await p.evaluate(async () => {
        const stream = document.querySelector("#preview").srcObject;
        const tx = new RTCPeerConnection({ iceServers: [] }),
          rx = new RTCPeerConnection({ iceServers: [] });
        window.testPeers = [tx, rx];
        tx.onicecandidate = (e) => {
          if (e.candidate) rx.addIceCandidate(e.candidate).catch(() => {});
        };
        rx.onicecandidate = (e) => {
          if (e.candidate) tx.addIceCandidate(e.candidate).catch(() => {});
        };
        const received = new MediaStream();
        rx.ontrack = (e) => received.addTrack(e.track);
        for (const t of stream.getTracks()) tx.addTrack(t, stream);
        await tx.setLocalDescription(await tx.createOffer());
        await rx.setRemoteDescription(tx.localDescription);
        await rx.setLocalDescription(await rx.createAnswer());
        await tx.setRemoteDescription(rx.localDescription);
        const v = document.createElement("video");
        v.muted = true;
        v.autoplay = true;
        v.srcObject = received;
        window.remoteVideo = v;
        await new Promise((resolve, reject) => {
          v.onloadeddata = resolve;
          setTimeout(() => reject(Error("No WebRTC camera delivered")), 10000);
        });
        await v.play();
        return {
          width: v.videoWidth,
          height: v.videoHeight,
          tracks: received.getTracks().map((t) => t.kind),
        };
      }),
    );
    await p.locator("#trigger").click();
    await p.waitForFunction(() => window.testStatus?.muted);
    assert.deepEqual(
      await p.evaluate(() => [testAudio.enabled, testClone.enabled]),
      [false, false],
    );
    await p.waitForFunction(
      () => window.testStatus?.vanished && !window.testStatus.transitioning,
      { timeout: 10000 },
    );
    assert.equal(await p.evaluate(() => window.testStatus.audioReady), true);
    console.log("VANISHED + MIC GATED + DETECTOR LIVE");
    await p.screenshot({ path: path.join(root, ".work/studio-vanished.png") });
    await p.locator("#trigger").click();
    await p.waitForFunction(
      () =>
        !window.testStatus?.vanished &&
        !window.testStatus.transitioning &&
        !window.testStatus.muted,
      { timeout: 10000 },
    );
    assert.deepEqual(
      await p.evaluate(() => [testAudio.enabled, testClone.enabled]),
      [true, true],
    );
    console.log("RETURN + MIC RESTORED");
    await p.evaluate(() => {
      testAudio.enabled = false;
      testClone.enabled = false;
    });
    await p.locator("#trigger").click();
    await p.waitForFunction(
      () => window.testStatus?.vanished && !window.testStatus.transitioning,
      { timeout: 10000 },
    );
    await p.locator("#trigger").click();
    await p.waitForFunction(
      () => !window.testStatus?.vanished && !window.testStatus.transitioning,
      { timeout: 10000 },
    );
    assert.deepEqual(
      await p.evaluate(() => [testAudio.enabled, testClone.enabled]),
      [false, false],
    );
    console.log("PREVIOUS MUTE PRESERVED");
    // Disable while vanished: restore video and microphone immediately.
    await p.evaluate(() => {
      testAudio.enabled = true;
      testClone.enabled = true;
    });
    await p.locator("#trigger").click();
    await p.waitForFunction(() => window.testStatus?.muted);
    await p.locator("#enabled").uncheck();
    await p.waitForFunction(() => !window.testStatus?.muted);
    assert.equal(await p.evaluate(() => testAudio.enabled), true);
    await p.locator("#enabled").check();
    await p.locator("#stop").click();
    await p.waitForFunction(() => !window.testStatus?.active);
    assert.equal(await p.locator("iframe").count(), 0);
    await p.evaluate(() => {
      testClone.stop();
      testPeers.forEach((p) => p.close());
    });
    console.log("CLEAN SHUTDOWN");
    const pop = await c.newPage();
    await pop.goto(base + "/popup/popup.html");
    await pop.setViewportSize({ width: 370, height: 850 });
    await pop.waitForTimeout(600);
    await pop.screenshot({
      path: path.join(root, ".work/popup.png"),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log("ALL INTEGRATION CHECKS PASSED");
  } finally {
    await c.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
