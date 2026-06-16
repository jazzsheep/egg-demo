// レンダラ / シーン / カメラ / 環境 / ライト / マテリアルのセットアップ。
// three.js は index.html の classic script で読み込まれた window.THREE を使う。
const THREE = window.THREE;

// 反射に“柄”が出ないよう、単色のごく淡い環境マップを作る。
// （グラデ環境だと殻に縞模様が映り込むため、あえてフラット）
function makeEnvTexture() {
  const c = document.createElement("canvas");
  c.width = 4; c.height = 4;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#262b34"; ctx.fillRect(0, 0, 4, 4);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

// シーン一式を構築して返す。
//  opts.shellOpacity : 殻の見た目の厚み（不透明度）。小さいほど薄いガラス。
export function createScene(canvas, opts) {
  const o = opts || {};
  const shellOpacity = o.shellOpacity != null ? o.shellOpacity : 0.12;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0c12, 0.009);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  camera.position.set(0, 0.4, 19);
  camera.lookAt(0, 0, 0);

  // 単色のごく淡い環境（反射の素地。柄は出さない）
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(makeEnvTexture()).texture;

  // 光源は一意：1灯のディレクショナルライトのみ（リアルな陰影・ハイライト）。
  //  クラッシュ防止に極小の環境光だけ補助で足す。
  scene.add(new THREE.AmbientLight(0xffffff, 0.05));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
  keyLight.position.set(6, 9, 8);
  scene.add(keyLight);

  // 殻：ごく薄い透明ガラス（厚み=不透明度で調整）。
  //  depthWrite を切って中身が透けて見えるようにする。
  const shellMat = new THREE.MeshPhysicalMaterial({
    color: 0xeef3fb,
    roughness: 0.06,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    reflectivity: 0.5,
    envMapIntensity: 0.55,
    transparent: true,
    opacity: shellOpacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  // 中のかたまり：濡れたような滑らかな黒スライム
  const coreMat = new THREE.MeshPhysicalMaterial({
    color: 0x070809,
    roughness: 0.22,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
    reflectivity: 0.5,
    envMapIntensity: 0.5,
    side: THREE.FrontSide,
  });

  return { renderer, scene, camera, shellMat, coreMat };
}
