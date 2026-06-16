// レンダラ / シーン / カメラ / 環境 / ライト / マテリアルのセットアップ。
// three.js は index.html の classic script で読み込まれた window.THREE を使う。
const THREE = window.THREE;

// 半透明の屈折・反射に色を与える為の簡易グラデ環境マップ
function makeEnvTexture() {
  const c = document.createElement("canvas");
  c.width = 16; c.height = 256;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.0, "#4a597e");
  g.addColorStop(0.45, "#222838");
  g.addColorStop(1.0, "#0a0c12");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

// シーン一式を構築して返す。
export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0c12, 0.01);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  camera.position.set(0, 0.4, 19);
  camera.lookAt(0, 0, 0);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(makeEnvTexture()).texture;

  // ライティング：環境光＋斜め前からのキー＋青いリムで膜の張りを出す
  scene.add(new THREE.HemisphereLight(0xbcd0ff, 0x141414, 0.5));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
  keyLight.position.set(8, 13, 11); scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x88aaff, 0.7);
  rimLight.position.set(-11, -3, -9); scene.add(rimLight);
  // 黒い中身にも動くハイライトを乗せる為の淡い点光源（塊に追従）
  const coreLight = new THREE.PointLight(0xcfe0ff, 0.0, 36, 2);
  scene.add(coreLight);

  // 薄く肉厚なビニール膜（半透明・クリアコート光沢）。
  //  depthWrite を切って中身が透けて見えるようにする。
  const shellMat = new THREE.MeshPhysicalMaterial({
    color: 0xdce8ff,
    roughness: 0.12,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.18,
    reflectivity: 0.6,
    envMapIntensity: 1.1,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  // 中のかたまり：濡れたような黒いスライム（粘度低めでムニッと流れる）
  const coreMat = new THREE.MeshPhysicalMaterial({
    color: 0x050608,
    roughness: 0.28,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.14,
    reflectivity: 0.5,
    envMapIntensity: 0.85,
    side: THREE.FrontSide,
  });

  return { renderer, scene, camera, coreLight, shellMat, coreMat };
}
