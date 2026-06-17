// エントリ：たまご（殻）とかたまり（中身）を構築し、物理ステップとループを回す。
import { buildIcosphere, buildEdges, computeVolume, accumulatePressure, solveEdges }
  from "./icosphere.js";
import { createScene } from "./scene.js";
import { createGravity } from "./gravity.js";

const THREE = window.THREE;
const DEG = Math.PI / 180;
const R = 5;                          // たまごの基準半径

// ============================================================
// 調整パラメータ（ここをいじれば見た目・挙動を変えられる）
// ============================================================
const CONFIG = {
  shell: {
    thickness: 0.10,   // 殻の見た目の薄さ（=不透明度）。上げると厚いガラスに見える
    softness:  0.0,    // 0=剛体。上げると殻が柔らかく変形する（〜1 目安）
    detail:    4,      // 殻の分割数（大きいほど滑らか・模様が出にくい）
  },
  slime: {
    detail:    4,      // 中身の分割数（大きいほど均質で滑らか）
    size:      3.5,    // 中身の半径
    pressure:  90,     // 内圧（弾性。大きいほど張る／丸みへ戻る力が強い）
    stiffness: 0.6,    // バネの硬さ（小さいほど流れる。均質さとのバランス）
    damping:   0.98,   // 速度減衰（小さいほどよく揺れる）
  },
  gravity:     4,      // 重力の強さ（体積は保たれるので主に流れの速さに効く）
};

const G = CONFIG.gravity;
const SHELL_SOFT = CONFIG.shell.softness;

const canvas = document.getElementById("scene");
const { renderer, scene, camera, shellMat, coreMat } =
  createScene(canvas, { shellOpacity: CONFIG.shell.thickness });
const gravity = createGravity(canvas, G);

// ============================================================
// たまご（殻）とかたまり（中身）の構築
// ============================================================
// 単位球の方向ベクトルをたまご形に写像する。
//  ・縦に伸ばし、上を少し細く（下が丸い）卵形のテーパー。
function eggMap(ux, uy, uz, out, o) {
  const taper = 1 - 0.20 * uy;        // 上(uy>0)を細く
  out[o]   = ux * R * taper;
  out[o+1] = uy * R * 1.32;
  out[o+2] = uz * R * taper;
}

// --- 殻 ---
const shellGeo0 = buildIcosphere(CONFIG.shell.detail);
const SN = shellGeo0.count, sFaces = shellGeo0.faces;
const sRest = new Float32Array(SN * 3); // 元の形（戻る先 / 剛体時はこのまま固定）
for (let i = 0; i < SN; i++) {
  eggMap(shellGeo0.dir[i*3], shellGeo0.dir[i*3+1], shellGeo0.dir[i*3+2], sRest, i*3);
}
const sPos  = new Float32Array(sRest);
const sPrev = new Float32Array(sRest);
const sFrc  = new Float32Array(SN * 3);
const sEdges = buildEdges(sRest, sFaces);
const sRestVol = computeVolume(sRest, sFaces);

const shellGeometry = new THREE.BufferGeometry();
shellGeometry.setAttribute("position", new THREE.BufferAttribute(sPos, 3));
shellGeometry.setIndex(new THREE.BufferAttribute(shellGeo0.index, 1));
shellGeometry.computeVertexNormals();
const shellMesh = new THREE.Mesh(shellGeometry, shellMat);
shellMesh.renderOrder = 2;
scene.add(shellMesh);

// --- かたまり（中身）---
const CORE_R = CONFIG.slime.size;
const coreGeo0 = buildIcosphere(CONFIG.slime.detail);
const CN = coreGeo0.count, cFaces = coreGeo0.faces;
const cPos  = new Float32Array(CN * 3);
const cPrev = new Float32Array(CN * 3);
const cFrc  = new Float32Array(CN * 3);
for (let i = 0; i < CN; i++) {
  cPos[i*3]   = coreGeo0.dir[i*3]   * CORE_R;
  cPos[i*3+1] = coreGeo0.dir[i*3+1] * CORE_R;
  cPos[i*3+2] = coreGeo0.dir[i*3+2] * CORE_R;
}
cPrev.set(cPos);
const cEdges = buildEdges(cPos, cFaces);
const cRestVol = computeVolume(cPos, cFaces);

const coreGeometry = new THREE.BufferGeometry();
coreGeometry.setAttribute("position", new THREE.BufferAttribute(cPos, 3));
coreGeometry.setIndex(new THREE.BufferAttribute(coreGeo0.index, 1));
coreGeometry.computeVertexNormals();
const coreMesh = new THREE.Mesh(coreGeometry, coreMat);
coreMesh.renderOrder = 1;
scene.add(coreMesh);

// かたまりを“たまご形そのものの内側”に閉じ込める為の寸法（殻の肉厚ぶん内側）。
//  楕円体ではなく eggMap と同じ形で拘束するので、下が太い卵形にちゃんと収まる。
const MARGIN = 0.5;
const EGG_H = R * 1.32;               // 縦の半径
const EGG_YLIM = EGG_H - MARGIN;

// ============================================================
// 物理ステップ（Verlet + 位置ベース拘束）
// ============================================================
const DT = 1 / 120;
let ITER = 6;
// 殻（柔らかくする時=softness>0 のみ使用）
const S_PRESS = 55, S_STIFF = 0.9, S_RESTORE = 340, S_DAMP = 0.95;
// かたまり
let C_PRESS = CONFIG.slime.pressure, C_STIFF = CONFIG.slime.stiffness, C_DAMP = CONFIG.slime.damping;
// 接触（殻が柔らかい時だけ、中身が殻を内側から押す）
const CR = 1.3, CR2 = CR * CR, K_SHELL = 0.5, K_CORE = 0.5;

const gCur = { x: 0, y: -G, z: 0 };

function step() {
  // 重力を滑らかに追従（係数を上げて傾きへの反応をきびきびさせる）
  const gT = gravity.gTarget;
  gCur.x += (gT.x - gCur.x) * 0.2;
  gCur.y += (gT.y - gCur.y) * 0.2;
  gCur.z += (gT.z - gCur.z) * 0.2;

  const dt2 = DT * DT;

  // --- 殻：剛体なら何もしない。softness>0 のとき内圧＋形状復元で柔らかく変形 ---
  if (SHELL_SOFT > 0) {
    sFrc.fill(0);
    const sV = computeVolume(sPos, sFaces);
    accumulatePressure(sPos, sFaces, sFrc, S_PRESS * (sRestVol / Math.max(sV, 1e-3) - 1));
    const restK = S_RESTORE / SHELL_SOFT; // softness が小さいほど硬い（剛体寄り）
    for (let i = 0; i < SN*3; i++) sFrc[i] += (sRest[i] - sPos[i]) * restK;
    for (let i = 0; i < SN*3; i++) {
      const cur = sPos[i];
      sPos[i] = cur + (cur - sPrev[i]) * S_DAMP + sFrc[i] * dt2;
      sPrev[i] = cur;
    }
    solveEdges(sPos, sEdges, S_STIFF, ITER);
  }

  // --- かたまり：内圧＋重力 ---
  cFrc.fill(0);
  const cV = computeVolume(cPos, cFaces);
  accumulatePressure(cPos, cFaces, cFrc, C_PRESS * (cRestVol / Math.max(cV, 1e-3) - 1));
  for (let i = 0; i < CN; i++) {
    cFrc[i*3]   += gCur.x;
    cFrc[i*3+1] += gCur.y;
    cFrc[i*3+2] += gCur.z;
  }
  for (let i = 0; i < CN*3; i++) {
    const cur = cPos[i];
    cPos[i] = cur + (cur - cPrev[i]) * C_DAMP + cFrc[i] * dt2;
    cPrev[i] = cur;
  }
  solveEdges(cPos, cEdges, C_STIFF, ITER);

  // --- 接触（殻が柔らかい時のみ：中身が殻を押し、両者を押し合う） ---
  if (SHELL_SOFT > 0) {
    for (let i = 0; i < CN; i++) {
      const bx = cPos[i*3], by = cPos[i*3+1], bz = cPos[i*3+2];
      for (let j = 0; j < SN; j++) {
        const dx = sPos[j*3]-bx, dy = sPos[j*3+1]-by, dz = sPos[j*3+2]-bz;
        const d2 = dx*dx + dy*dy + dz*dz;
        if (d2 >= CR2 || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const overlap = (CR - d) / d;
        const ox = dx * overlap, oy = dy * overlap, oz = dz * overlap;
        sPos[j*3]   += ox * K_SHELL; sPos[j*3+1] += oy * K_SHELL; sPos[j*3+2] += oz * K_SHELL;
        cPos[i*3]   -= ox * K_CORE;  cPos[i*3+1] -= oy * K_CORE;  cPos[i*3+2] -= oz * K_CORE;
      }
    }
  }

  // --- かたまりを“たまご形の内側”に閉じ込める（殻を突き抜けない安全網） ---
  //  高さ y から uy を求め、その高さでのたまご内側の水平半径に押し戻す。
  clampToEgg();

  // 体積は厳密には保持しない（びよんびよんと伸縮してよい）。
  //  丸みへ戻る力は内圧（C_PRESS）とバネ（solveEdges）の弾性が担うので、
  //  ここで等方スケールして元体積へ戻す処理は行わない。
}

// かたまりの各頂点を、その高さでのたまご内側の水平半径・上下限に押し戻す。
function clampToEgg() {
  for (let i = 0; i < CN; i++) {
    let y = cPos[i*3+1];
    if (y > EGG_YLIM) y = EGG_YLIM; else if (y < -EGG_YLIM) y = -EGG_YLIM;
    const uy = y / EGG_H;
    const taper = 1 - 0.20 * uy;
    const maxR = Math.max(0, (R * taper - MARGIN) * Math.sqrt(Math.max(0, 1 - uy*uy)));
    let x = cPos[i*3], z = cPos[i*3+2];
    const r = Math.hypot(x, z);
    if (r > maxR) { const s = maxR / (r || 1e-6); x *= s; z *= s; }
    cPos[i*3] = x; cPos[i*3+1] = y; cPos[i*3+2] = z;
  }
}

// ============================================================
// メインループ（固定ステップ + アキュムレータ）
// ============================================================
let acc = 0, last = performance.now();
function loop(now) {
  let frame = (now - last) / 1000; last = now;
  if (frame > 0.1) frame = 0.1;
  acc += frame;

  gravity.update();
  let steps = 0;
  while (acc >= DT && steps < 8) { step(); acc -= DT; steps++; }

  // 中身は毎フレーム更新。殻は剛体なら法線は初期計算のままで良い。
  coreGeometry.attributes.position.needsUpdate = true;
  coreGeometry.computeVertexNormals();
  if (SHELL_SOFT > 0) {
    shellGeometry.attributes.position.needsUpdate = true;
    shellGeometry.computeVertexNormals();
  }

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

// ============================================================
// リサイズ・起動
// ============================================================
// 縦長スマホでも卵が画面に収まるよう、アスペクト比からカメラ距離を決める
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  const halfV = Math.tan(camera.fov * DEG / 2);
  const reqH = 7.5, reqW = 6.0, margin = 1.1; // 卵の半径（変形ぶん込み）
  const distH = reqH / halfV;
  const distW = reqW / (camera.aspect * halfV);
  const dist = Math.max(distH, distW) * margin;
  camera.position.set(0, 0.4, dist);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
if (screen.orientation && screen.orientation.addEventListener) {
  screen.orientation.addEventListener("change", resize);
}

resize();
requestAnimationFrame(loop);
