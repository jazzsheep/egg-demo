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
index.html        マークアップ + three.js(CDN) + module エントリ
src/
  styles.css      見た目
  icosphere.js    純粋な幾何・物理ヘルパ（three.js 非依存）
  scene.js        レンダラ / カメラ / ライト / マテリアル / 環境
  gravity.js      重力入力（ドラッグ + 端末傾き）
  main.js         シミュ本体（卵と中身の構築・物理ステップ・ループ）
```

three.js (r128) は CDN から `window.THREE` として読み込み、各モジュールはそれを参照します
（バンドラ不要）。物理は Verlet 積分 + 位置ベース拘束（内圧・距離拘束・形状復元・接触）。
