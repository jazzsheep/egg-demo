// エントリ：たまご（殻）と中身（メタボール slime）を構築し、物理とループを回す。
//  殻は固定メッシュ（剛体）。中身は粒子群を物理シミュし、毎フレーム
//  THREE.MarchingCubes で滑らかな等値面（メタボール）に変換して描画する。
//  固定メッシュではないので、流れて潰れても折り目（しわ）が出ない。
import { buildIcosphere, buildEdges, computeVolume, accumulatePressure, solveEdges }
  from "./icosphere.js";
import { initParticles, stepParticles } from "./metaball.js";
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
    count:      18,    // メタボール粒子数（多いほど滑らかで重い）
    resolution: 48,    // マーチングキューブ解像度（大きいほど滑らかで重い）
    strength:   0.62,  // 各ボールの強さ（大きいほど太く融合する）
    subtract:   12,    // 影響の減衰（基本そのまま）
    isolation:  80,    // 等値面のしきい値（小さいほど膨らむ）
    separation: 2.0,   // 粒子の最小間隔（広がり＝体積）
    cohesion:   0.03,  // まとまる力（小さいほどデロッと広がる、0で完全バラけ）
    damping:    0.99,  // 速度減衰（1に近いほどよく揺れる）
  },
  gravity:     6,      // 重力の強さ（大きいほど速く流れて反応がきびきびする）
};

const G = CONFIG.gravity;
const SHELL_SOFT = CONFIG.shell.softness;

const canvas = document.getElementById("scene");
const { renderer, scene, camera, shellMat, coreMat } =
  createScene(canvas, { shellOpacity: CONFIG.shell.thickness });
const gravity = createGravity(canvas, G);

// たまご形への写像（単位球の方向ベクトル→卵形：縦に伸ばし上を細く）。
function eggMap(ux, uy, uz, out, o) {
  const taper = 1 - 0.20 * uy;
  out[o]   = ux * R * taper;
  out[o+1] = uy * R * 1.32;
  out[o+2] = uz * R * taper;
}

// ============================================================
// 殻（固定メッシュ。softness>0 のときだけ柔らかく変形）
// ============================================================
const shellGeo0 = buildIcosphere(CONFIG.shell.detail);
const SN = shellGeo0.count, sFaces = shellGeo0.faces;
const sRest = new Float32Array(SN * 3);
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

// ============================================================
// 中身（メタボール）：粒子の物理 + マーチングキューブの等値面
// ============================================================
const N = CONFIG.slime.count;
const pPos  = initParticles(N, 2.5);  // 粒子の現在位置
const pPrev = new Float32Array(pPos); // 前回位置（Verlet）

// 等値面を作るフィールド立方体。卵（縦±6.6 / 横±6）を余裕をもって包む。
const FIELD_HALF = 7.5;               // 立方体の半サイズ（ワールド単位）
const FIELD_SPAN = FIELD_HALF * 2;

// マーチングキューブ本体。reset()+addBall() するだけで描画時に三角形化される。
const effect = new THREE.MarchingCubes(CONFIG.slime.resolution, coreMat, false, false);
effect.isolation = CONFIG.slime.isolation;
effect.position.set(0, 0, 0);
effect.scale.set(FIELD_HALF, FIELD_HALF, FIELD_HALF); // フィールド[-1,1]→[-HALF,HALF]
effect.frustumCulled = false;          // 形状が毎フレーム変わるのでカリングしない
effect.renderOrder = 1;
scene.add(effect);

// 粒子を“たまご形の内側”に閉じ込める。等値面はボール半径ぶん外へ膨らむので、
//  そのぶん内側（MARGIN_P）にクランプして殻からはみ出さないようにする。
const EGG_H = R * 1.32;                // 縦の半径
const MARGIN_P = 1.4;                  // 殻からの余裕（≒ボールの等値面半径）
const EGG_YLIM = EGG_H - MARGIN_P;
function confine(pos, i) {
  let y = pos[i*3+1];
  if (y > EGG_YLIM) y = EGG_YLIM; else if (y < -EGG_YLIM) y = -EGG_YLIM;
  const uy = y / EGG_H;
  const taper = 1 - 0.20 * uy;
  const maxR = Math.max(0, (R * taper - MARGIN_P) * Math.sqrt(Math.max(0, 1 - uy*uy)));
  let x = pos[i*3], z = pos[i*3+2];
  const r = Math.hypot(x, z);
  if (r > maxR) { const s = maxR / (r || 1e-6); x *= s; z *= s; }
  pos[i*3] = x; pos[i*3+1] = y; pos[i*3+2] = z;
}

// ============================================================
// 物理ステップ（殻：Verlet+PBD / 中身：粒子）
// ============================================================
const DT = 1 / 120;
const ITER = 6;
// 殻（柔らかくする時=softness>0 のみ使用）
const S_PRESS = 55, S_STIFF = 0.9, S_RESTORE = 340, S_DAMP = 0.95;
// 中身の粒子パラメータ
const slimeParams = {
  damping:    CONFIG.slime.damping,
  separation: CONFIG.slime.separation,
  cohesion:   CONFIG.slime.cohesion,
  iters:      4,
};

const gCur = { x: 0, y: -G, z: 0 };

function step() {
  // 重力を滑らかに追従（係数を上げて傾きへの反応をきびきびさせる）
  const gT = gravity.gTarget;
  gCur.x += (gT.x - gCur.x) * 0.3;
  gCur.y += (gT.y - gCur.y) * 0.3;
  gCur.z += (gT.z - gCur.z) * 0.3;

  const dt2 = DT * DT;

  // --- 殻：剛体なら何もしない。softness>0 のとき内圧＋形状復元で柔らかく変形 ---
  if (SHELL_SOFT > 0) {
    sFrc.fill(0);
    const sV = computeVolume(sPos, sFaces);
    accumulatePressure(sPos, sFaces, sFrc, S_PRESS * (sRestVol / Math.max(sV, 1e-3) - 1));
    const restK = S_RESTORE / SHELL_SOFT;
    for (let i = 0; i < SN*3; i++) sFrc[i] += (sRest[i] - sPos[i]) * restK;
    for (let i = 0; i < SN*3; i++) {
      const cur = sPos[i];
      sPos[i] = cur + (cur - sPrev[i]) * S_DAMP + sFrc[i] * dt2;
      sPrev[i] = cur;
    }
    solveEdges(sPos, sEdges, S_STIFF, ITER);
  }

  // --- 中身：粒子を進める（重力・反発・まとまり・閉じ込め）---
  stepParticles(pPos, pPrev, N, dt2, gCur, slimeParams, confine);
}

// 粒子群からマーチングキューブのフィールドを作る（毎フレーム）。
//  ワールド座標 → フィールドの正規化座標[0,1] に変換して addBall する。
function buildField() {
  effect.reset();
  const st = CONFIG.slime.strength, sub = CONFIG.slime.subtract;
  for (let i = 0; i < N; i++) {
    const nx = pPos[i*3]   / FIELD_SPAN + 0.5;
    const ny = pPos[i*3+1] / FIELD_SPAN + 0.5;
    const nz = pPos[i*3+2] / FIELD_SPAN + 0.5;
    effect.addBall(nx, ny, nz, st, sub);
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

  buildField(); // 等値面の元データを更新（描画時に三角形化される）

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
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  const halfV = Math.tan(camera.fov * DEG / 2);
  const reqH = 7.5, reqW = 6.0, margin = 1.1;
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
