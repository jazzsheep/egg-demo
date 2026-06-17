# egg-demo

半透明のたまごの中で、黒いスライム状のかたまりが重力に従って流れ、ぷにぷにの膜を
変形させるインタラクティブ 3D デモ。PC はドラッグ、スマホは本体の傾きで重力の向きを
変えられます。

- **PC**: ドラッグで重力を傾ける
- **スマホ**: 本体を傾ける（iOS は初回タップでモーション許可）

## 動かし方

ビルド不要の静的サイトです。`index.html` を**HTTP(S) で配信**して開きます
（ES モジュールを使うため `file://` では動きません）。スマホの傾きには HTTPS が必要です。

ローカル確認用に [Taskfile.yml](Taskfile.yml) を用意しています（要 [Task](https://taskfile.dev) + [cloudflared](https://github.com/cloudflare/cloudflared)）:

```
task start   # 静的サーバ + HTTPS トンネルを起動しスマホ用URLを表示
task stop    # 停止
task status  # 稼働状況とURL
```

## 構成

```
index.html        マークアップ + three.js(CDN) + MarchingCubes + module エントリ
src/
  styles.css      見た目
  icosphere.js    純粋な幾何・物理ヘルパ（殻用。three.js 非依存）
  metaball.js     中身の粒子シミュレーション（three.js 非依存）
  scene.js        レンダラ / カメラ / ライト / マテリアル / 環境
  gravity.js      重力入力（ドラッグ + 端末傾き）
  main.js         シミュ本体（卵と中身の構築・物理ステップ・ループ）
  vendor/MarchingCubes.js  three.js r128 用 MarchingCubes（同梱）
  IMPLEMENTATION.md  実装の詳細解説（構造・物理モデル・調整パラメータ）
```

three.js (r128) は CDN から `window.THREE` として読み込み、各モジュールはそれを参照します
（バンドラ不要）。**殻**は固定メッシュ（Verlet + 位置ベース拘束）、**中身**は粒子を
物理シミュして毎フレーム `THREE.MarchingCubes` で滑らかな等値面（メタボール）に変換します。
固定メッシュではないので、流れて潰れても折り目（しわ）が出ません。
