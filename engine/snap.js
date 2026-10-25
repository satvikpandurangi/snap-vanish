// Vision AND an acoustic click are mandatory. Translation of a hand is not a snap.
export class SnapGesture {
  constructor() {
    this.hands = new Map();
    this.lastSnap = -Infinity;
    this.clicks = [];
  }
  click(t) {
    this.clicks.push(t);
    this.clicks = this.clicks.filter((x) => t - x < 600);
  }
  reset() {
    this.hands.clear();
    this.clicks = [];
  }
  update(result, t, sensitivity = 5) {
    let fired = false;
    const seen = new Set();
    for (let i = 0; i < result.landmarks.length; i++) {
      const p = result.landmarks[i],
        key = result.handedness?.[i]?.[0]?.categoryName || String(i);
      seen.add(key);
      const d = (a, b) =>
        Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
      const scale = d(p[0], p[9]);
      if (scale < 0.045) {
        this.hands.delete(key);
        continue;
      }
      const pinch = d(p[4], p[12]) / scale,
        palm = {
          x: (p[0].x + p[9].x) / 2,
          y: (p[0].y + p[9].y) / 2,
          z: ((p[0].z || 0) + (p[9].z || 0)) / 2,
        },
        reach = d(p[12], palm) / scale;
      const h = this.hands.get(key) || {
          count: 0,
          armed: 0,
          pending: 0,
          prev: null,
        },
        limit = 0.3 + sensitivity * 0.018;
      if (pinch < limit) {
        h.count++;
        if (h.count >= 2 && !h.armed) {
          h.armed = t;
          h.reach = reach;
        }
      } else h.count = 0;
      if (h.armed && t - h.armed > 700) h.armed = 0;
      const relative = {
          x: (p[12].x - p[0].x) / scale,
          y: (p[12].y - p[0].y) / scale,
        },
        dt = h.prev ? t - h.prev.t : 0;
      const speed =
        dt > 0 && dt < 160
          ? (Math.hypot(relative.x - h.prev.x, relative.y - h.prev.y) * 1000) /
            dt
          : 0;
      if (
        h.armed &&
        t - h.armed >= 25 &&
        pinch > limit * 1.5 &&
        reach < h.reach - 0.18 &&
        speed > 3.8 - sensitivity * 0.18
      ) {
        h.pending = t;
        h.armed = 0;
      }
      if (
        h.pending &&
        t - h.pending <= 200 &&
        this.clicks.some((c) => Math.abs(c - h.pending) < 200) &&
        t - this.lastSnap > 1400
      ) {
        this.lastSnap = t;
        h.pending = 0;
        this.clicks = [];
        fired = true;
      }
      if (h.pending && t - h.pending > 200) h.pending = 0;
      h.prev = { ...relative, t };
      this.hands.set(key, h);
    }
    for (const key of this.hands.keys())
      if (!seen.has(key)) this.hands.delete(key);
    return fired;
  }
}
