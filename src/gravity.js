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
    enableMotion(); // iOS 用：ユーザー操作で許可要求
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

  // --- 端末の傾き（スマホ）：実世界の重力ベクトルを端末座標へ射影して gTarget に設定 ---
  function onOrientation(e) {
    if (e.beta == null && e.gamma == null) return;
    orientationOn = true;
    const beta = (e.beta || 0) * DEG;   // 前後(pitch)
    const gamma = (e.gamma || 0) * DEG; // 左右(roll)
    const cB = Math.cos(beta), sB = Math.sin(beta);
    const cG = Math.cos(gamma), sG = Math.sin(gamma);
    // 端末座標系での下向き単位ベクトル（奥行きも含む正しい射影）。
    //  単純な sin(gamma) 近似だと端末を立てた時(beta>90°)にジンバルで
    //  gamma の符号が反転し、左右が逆になる。cos(beta) 込みにすると連続して反転しない。
    let gx = cB * sG;   // 左右（右が +x）
    let gy = -sB;       // 上下（画面の上が +y）
    let gz = -cB * cG;  // 奥行き（手前が +z、画面奥が -z）
    // 画面の向き（縦/横）を補正（画面平面内の x,y のみ回す。奥行き z はそのまま）
    const ang = (screen.orientation && screen.orientation.angle) ||
                (typeof window.orientation === "number" ? window.orientation : 0);
    if (ang === 90)                      { const t = gx; gx = -gy; gy = t; }
    else if (ang === 270 || ang === -90) { const t = gx; gx = gy; gy = -t; }
    else if (ang === 180)                { gx = -gx; gy = -gy; }
    gTarget.x = gx * G;
    gTarget.y = gy * G;
    gTarget.z = gz * G;
  }
  // 端末傾きを有効化する。iOS Safari は requestPermission を
  //  「ユーザー操作のハンドラ内で同期的に」呼ぶ必要があるため、
  //  click / touchend / pointerdown のどれでも確実に走らせる。
  let motionRequested = false;
  function enableMotion() {
    if (motionRequested) return;
    motionRequested = true;
    const D = window.DeviceOrientationEvent;
    if (D && typeof D.requestPermission === "function") {
      D.requestPermission().then((s) => {
        if (s === "granted") window.addEventListener("deviceorientation", onOrientation);
        else motionRequested = false; // 拒否/失敗時は次のタップで再要求できるように
      }).catch(() => { motionRequested = false; });
    } else {
      // Android 等：許可不要ならそのまま購読
      window.addEventListener("deviceorientation", onOrientation);
    }
  }
  window.addEventListener("click", enableMotion);
  window.addEventListener("touchend", enableMotion);

  return { gTarget, update };
}
