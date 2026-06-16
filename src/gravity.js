// 重力の入力（PCドラッグ＝傾ける / スマホ＝本体の傾き）。
// gTarget（目標重力ベクトル）を更新し続ける。滑らかな追従は呼び出し側で行う。

const DEG = Math.PI / 180;

export function createGravity(canvas, G) {
  let tiltX = 0, tiltZ = 0;   // ドラッグによる傾き（PC / 傾き非対応時）
  let orientationOn = false;  // 端末傾きが有効になったら true
  const gTarget = { x: 0, y: -G, z: 0 };

  // ドラッグ傾き：下向きベクトルを X まわり→Z まわりに回す（毎フレーム呼ぶ）
  function update() {
    if (orientationOn) return; // 端末傾き時は onOrientation が gTarget を直接設定
    const cx = Math.cos(tiltX), sx = Math.sin(tiltX);
    const y1 = -G * cx, z1 = -G * sx;
    const cz = Math.cos(tiltZ), sz = Math.sin(tiltZ);
    gTarget.x = -y1 * sz; gTarget.y = y1 * cz; gTarget.z = z1;
  }

  // --- ポインタ（ドラッグで傾ける） ---
  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    canvas.classList.add("grabbing");
    canvas.setPointerCapture(e.pointerId);
    requestOrientationPermission(); // iOS 用：ユーザー操作で許可要求
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    tiltZ += (e.clientX - lastX) * 0.006;
    tiltX += (e.clientY - lastY) * 0.006;
    const LIM = 2.7;            // 傾けすぎを緩く抑える
    tiltX = Math.max(-LIM, Math.min(LIM, tiltX));
    tiltZ = Math.max(-LIM, Math.min(LIM, tiltZ));
    lastX = e.clientX; lastY = e.clientY;
  });
  function endDrag() { dragging = false; canvas.classList.remove("grabbing"); }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  // --- 端末の傾き（スマホ）：実世界の重力を画面平面へ投影して gTarget に設定 ---
  function onOrientation(e) {
    if (e.beta == null && e.gamma == null) return;
    orientationOn = true;
    const beta = (e.beta || 0) * DEG;   // 前後(pitch)
    const gamma = (e.gamma || 0) * DEG; // 左右(roll)
    // 端末を立てるほど真下が強く、寝かせるほど弱まる（＝傾けて注ぐ感覚）
    let gx = Math.sin(gamma);
    let gy = -Math.sin(beta);
    // 画面の向き（縦/横）を補正
    const ang = (screen.orientation && screen.orientation.angle) ||
                (typeof window.orientation === "number" ? window.orientation : 0);
    if (ang === 90)                      { const t = gx; gx = -gy; gy = t; }
    else if (ang === 270 || ang === -90) { const t = gx; gx = gy; gy = -t; }
    else if (ang === 180)                { gx = -gx; gy = -gy; }
    gTarget.x = gx * G;
    gTarget.y = gy * G;
    gTarget.z = 0;
  }
  function requestOrientationPermission() {
    const D = window.DeviceOrientationEvent;
    if (D && typeof D.requestPermission === "function") {
      D.requestPermission().then((s) => {
        if (s === "granted") window.addEventListener("deviceorientation", onOrientation);
      }).catch(() => {});
    }
  }
  if (window.DeviceOrientationEvent &&
      typeof window.DeviceOrientationEvent.requestPermission !== "function") {
    // Android 等：許可不要ならそのまま購読
    window.addEventListener("deviceorientation", onOrientation);
  }

  return { gTarget, update };
}
