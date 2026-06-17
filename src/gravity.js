// 重力の入力（PCドラッグ＝傾ける / スマホ＝端末の傾き）。
// gTarget（目標重力ベクトル）を更新し続ける。滑らかな追従は呼び出し側で行う。

const DEG = Math.PI / 180;

// 端末の左右/上下/奥行きが想定と逆に動く時は、対応する符号を -1 にする。
//  （端末や OS で軸の向きが違うことがあるため、ここで手早く合わせられる）
const INV_X = 1, INV_Y = 1, INV_Z = 1;

export function createGravity(canvas, G) {
  let tiltX = 0, tiltZ = 0;   // ドラッグによる傾き（PC / センサ非対応時）
  let motionOn = false;       // devicemotion（加速度センサ）が有効
  let orientOn = false;       // deviceorientation（フォールバック）が有効
  const gTarget = { x: 0, y: -G, z: 0 };
  const g = { x: 0, y: 0, z: 0 };

  // ドラッグ傾き（PC）。端末センサが有効なら何もしない。
  function update() {
    if (motionOn || orientOn) return;
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

  // 画面の向き（縦/横）に応じて、画面平面内の x,y を回す。z（画面法線）は不変。
  function applyScreenAngle(v) {
    const ang = (screen.orientation && screen.orientation.angle) ||
                (typeof window.orientation === "number" ? window.orientation : 0);
    if (ang === 90)                      { const t = v.x; v.x = -v.y; v.y = t; }
    else if (ang === 270 || ang === -90) { const t = v.x; v.x = v.y;  v.y = -t; }
    else if (ang === 180)                { v.x = -v.x; v.y = -v.y; }
  }

  function commit() {
    applyScreenAngle(g);
    gTarget.x = g.x * INV_X;
    gTarget.y = g.y * INV_Y;
    gTarget.z = g.z * INV_Z;
  }

  // --- 端末モーション（推奨）：重力ベクトルを直接使う ---
  //  accelerationIncludingGravity は端末座標(x=右, y=上, z=画面手前)での
  //  「重力込みの加速度」。静止時はほぼ重力の反力なので、重力下向き = その逆ベクトル。
  //  角度から三角関数で組み立てないため、端末を立ててもジンバルで符号が飛ばない
  //  ＝左右が反転しない。奥行き(z)も自然に得られる。
  function onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || (a.x == null && a.y == null && a.z == null)) return;
    motionOn = true;
    const s = G / 9.81;
    g.x = -(a.x || 0) * s;
    g.y = -(a.y || 0) * s;
    g.z = -(a.z || 0) * s;
    commit();
  }

  // --- 端末の傾き（フォールバック）：devicemotion が重力を返さない端末用 ---
  function onOrientation(e) {
    if (motionOn) return; // devicemotion が来ていればそちらを優先
    if (e.beta == null && e.gamma == null) return;
    orientOn = true;
    const beta = (e.beta || 0) * DEG, gamma = (e.gamma || 0) * DEG;
    const cB = Math.cos(beta), sB = Math.sin(beta);
    const cG = Math.cos(gamma), sG = Math.sin(gamma);
    g.x = cB * sG * G;   // 左右
    g.y = -sB * G;       // 上下
    g.z = -cB * cG * G;  // 奥行き
    commit();
  }

  // 端末センサを有効化する。iOS Safari は requestPermission を
  //  「ユーザー操作のハンドラ内で同期的に」呼ぶ必要があるため、
  //  click / touchend / pointerdown のどれでも確実に走らせる。
  let motionRequested = false;
  function enableMotion() {
    if (motionRequested) return;
    motionRequested = true;
    const subscribe = () => {
      window.addEventListener("devicemotion", onMotion);
      window.addEventListener("deviceorientation", onOrientation);
    };
    const M = window.DeviceMotionEvent, O = window.DeviceOrientationEvent;
    const reqM = M && typeof M.requestPermission === "function";
    const reqO = O && typeof O.requestPermission === "function";
    if (reqM || reqO) {
      // iOS：モーションと向きの許可をユーザー操作内でまとめて要求
      const ps = [];
      if (reqM) ps.push(M.requestPermission().catch(() => "denied"));
      if (reqO) ps.push(O.requestPermission().catch(() => "denied"));
      Promise.all(ps).then((res) => {
        if (res.some((s) => s === "granted")) subscribe();
        else motionRequested = false; // 拒否時は次のタップで再要求できるように
      });
    } else {
      // Android 等：許可不要ならそのまま購読
      subscribe();
    }
  }
  window.addEventListener("click", enableMotion);
  window.addEventListener("touchend", enableMotion);

  return { gTarget, update };
}
