// エントリ：たまご（膜）とかたまり（中身）を構築し、物理ステップとループを回す。
import { buildIcosphere, buildEdges, computeVolume, accumulatePressure, solveEdges }
  from "./icosphere.js";
import { createScene } from "./scene.js";
import { createGravity } from "./gravity.js";

const THREE = window.THREE;
const DEG = Math.PI / 180;
const R = 5;                          // たまごの基準半径
const G = 42;                         // 重力の強さ

const canvas = document.getElementById("scene");
const { renderer, scene, camera, coreLight, shellMat, coreMat } = createScene(canvas);
const gravity = createGravity(canvas, G);

// ============================================================
// たまご（膜）とかたまり（中身）の構築
// ============================================================
// 単位球の方向ベクトルをたまご形に写像する。
//  ・縦に伸ばし、上を少し細く（下が丸い）卵形のテーパー。
function eggMap(ux, uy, uz, out, o) {
  const taper = 1 - 0.20 * uy;        // 上(uy>0)を細く
  out[o]   = ux * R * taper;
  out[o+1] = uy * R * 1.32;
  out[o+2] = uz * R * taper;
}

// --- 膜 ---
const shellGeo0 = buildIcosphere(3);  // 642頂点 / 1280面
const SN = shellGeo0.count, sFaces = shellGeo0.faces;
const sRest = new Float32Array(SN * 3); // 元の形（戻る先）
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
const CORE_R = 3.4;
const coreGeo0 = buildIcosphere(3);   // 642頂点 / 1280面
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

// かたまりを閉じ込める内側の楕円体（膜の肉厚ぶん内側）
const MARGIN = 0.55;
const cax = R - MARGIN, cay = R * 1.32 - MARGIN, caz = R - MARGIN;

// ============================================================
// 物理ステップ（Verlet + 位置ベース拘束）
// ============================================================
const DT = 1 / 120;
const ITER = 3;
// 膜
const S_PRESS = 55, S_STIFF = 0.9, S_RESTORE = 340, S_DAMP = 0.95;
// かたまり：内圧は高めで丸い体積を保ちつつ、バネは弱く粘性低めでムニッと流れる
const C_PRESS = 135, C_STIFF = 0.14, C_DAMP = 0.986;
// 接触（中身→膜を押し出す / 膜→中身を押し戻す）
const CR = 1.3, CR2 = CR * CR, K_SHELL = 0.5, K_CORE = 0.5;

const gCur = { x: 0, y: -G, z: 0 };

function step() {
  // 重力を滑らかに追従
  const gT = gravity.gTarget;
  gCur.x += (gT.x - gCur.x) * 0.08;
  gCur.y += (gT.y - gCur.y) * 0.08;
  gCur.z += (gT.z - gCur.z) * 0.08;

  // --- 膜：内圧＋元形状への復元力 ---
  sFrc.fill(0);
  const sV = computeVolume(sPos, sFaces);
  accumulatePressure(sPos, sFaces, sFrc, S_PRESS * (sRestVol / Math.max(sV, 1e-3) - 1));
  for (let i = 0; i < SN*3; i++) sFrc[i] += (sRest[i] - sPos[i]) * S_RESTORE;
  const dt2 = DT * DT;
  for (let i = 0; i < SN*3; i++) {
    const cur = sPos[i];
    sPos[i] = cur + (cur - sPrev[i]) * S_DAMP + sFrc[i] * dt2;
    sPrev[i] = cur;
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

  // --- 距離拘束 ---
  solveEdges(sPos, sEdges, S_STIFF, ITER);
  solveEdges(cPos, cEdges, C_STIFF, ITER);

  // --- 接触（かたまりが膜を内側から押す。両者を押し合う） ---
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

  // --- かたまりを内側の楕円体に閉じ込める（膜を突き抜けない安全網） ---
  for (let i = 0; i < CN; i++) {
    const x = cPos[i*3], y = cPos[i*3+1], z = cPos[i*3+2];
    const q = (x*x)/(cax*cax) + (y*y)/(cay*cay) + (z*z)/(caz*caz);
    if (q > 1) {
      const s = 1 / Math.sqrt(q);
      cPos[i*3] = x*s; cPos[i*3+1] = y*s; cPos[i*3+2] = z*s;
    }
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

  // 点光源をかたまりの重心へ追従させ、膜の内側をほのかに照らす
  let mx=0,my=0,mz=0;
  for (let i=0;i<CN;i++){ mx+=cPos[i*3]; my+=cPos[i*3+1]; mz+=cPos[i*3+2]; }
  coreLight.position.set(mx/CN, my/CN, mz/CN);
  coreLight.intensity = 0.7;

  shellGeometry.attributes.position.needsUpdate = true;
  shellGeometry.computeVertexNormals();
  coreGeometry.attributes.position.needsUpdate = true;
  coreGeometry.computeVertexNormals();

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
