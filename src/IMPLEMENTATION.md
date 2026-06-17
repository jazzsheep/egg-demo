# 実装解説

半透明のたまご（殻）の中で、謎のかたまり（中身＝slime）が重力に従って
流れるインタラクティブ 3D デモの内部実装メモ。
パラメータを触る人・挙動を直す人向けに、構造と物理モデルを細かく解説する。

---

## 全体像

- **ビルド不要の静的サイト**。`index.html` を HTTP(S) 配信して開くだけ。
  ES モジュールを使うので `file://` では動かない。
- **three.js (r128)** は `index.html` の classic script で読み込み、`window.THREE`
  として各モジュールが参照する（バンドラ・npm 依存なし）。
- **殻**は固定メッシュ（剛体。任意で柔体）。**中身**は粒子を物理シミュし、
  毎フレーム `THREE.MarchingCubes` で滑らかな等値面（メタボール）に変換して描画する。
  中身は固定トポロジのメッシュではないので、流れて潰れても**折り目（しわ）が原理的に出ず**、
  液体のように融合・分離する。

### モジュール構成と依存

```
index.html
  ├─ three.min.js (CDN)                ← window.THREE
  ├─ src/vendor/MarchingCubes.js       ← THREE.MarchingCubes を生やす（同梱）
  └─ src/main.js (module)              ← エントリ。構築・物理ステップ・ループ
       ├─ src/icosphere.js  ← 殻用の幾何/物理ヘルパ（three.js 非依存・純関数）
       ├─ src/metaball.js   ← 中身の粒子シミュレーション（three.js 非依存）
       ├─ src/scene.js      ← レンダラ/カメラ/ライト/材質/環境
       └─ src/gravity.js    ← 重力入力（ドラッグ + 端末傾き）→ gTarget
```

`icosphere.js` / `metaball.js` は数値計算だけの純関数で three.js に依存しない。
`scene.js` / `gravity.js` がブラウザ・three.js 依存を引き受け、`main.js` が束ねる。

---

## 座標系の約束

- three.js の右手系。カメラは +z 側から原点を見る（`scene.js`）。
- したがって **+x=右 / +y=上 / +z=手前（視点側） / -z=画面奥**。
- 重力ベクトル `gCur` もこの座標系。既定は `(0, -G, 0)`（真下）。
- 卵は原点中心。縦半径 `EGG_H = R*1.32`、横は高さ依存のテーパー形。

---

## 殻（`main.js` + `icosphere.js`）

### アイコスフィア生成 `buildIcosphere(subdiv)`

正二十面体を `subdiv` 回サブディビジョンし、中点を辞書でキャッシュして
**頂点を溶接した連結メッシュ**を作る。返り値は `dir`(正規化方向)・`faces`・
`index`・`count`。`detail:4` でおよそ 2562 頂点。

### たまご形への写像 `eggMap`

```
taper = 1 - 0.20 * uy      // 上(uy>0)ほど細く
x = ux * R * taper
y = uy * R * 1.32          // 縦に伸ばす
z = uz * R * taper
```

殻はこの形に固定（既定は剛体）。中身を閉じ込める `confine` も同じ式で
「その高さでの内側半径」を求めるので、下が太い卵形にちゃんと収まる。

### 殻の柔体オプション（`CONFIG.shell.softness > 0`）

既定は剛体（`softness:0`）で何もしない。0 より大きいと、殻メッシュを
Verlet + 内圧（`accumulatePressure`）+ 形状復元（rest へ戻す力）+ 距離拘束
（`solveEdges`）で柔らかく変形させる。`softness` が小さいほど剛体寄り。

---

## 中身＝メタボール（`metaball.js` + `THREE.MarchingCubes`）

中身は「少数の粒子で物理を解き、その粒子群から滑らかな等値面を作る」
**メタボール方式**。これが折り目の出ない液体っぽさの肝。

### 粒子の物理 `stepParticles(...)`（`metaball.js`）

`CONFIG.slime.count` 個の粒子（質点）を Verlet で動かす。1 ステップの処理:

1. **Verlet 積分**：`next = cur + (cur - prev) * damping + g * dt²`。
   `damping` が 1 に近いほど揺れが残る。
2. **反発**：粒子間が最小間隔 `separation` より近いと押し合う（PBD、`iters` 回）。
   これで適度に広がって**体積**を作り、潰れを防ぐ。
3. **まとまる力**：全粒子を重心へ少し寄せる（`cohesion`）。1 つの塊を保つ。
   小さいほどデロッと広がり、0 で完全にバラける（複数の液滴に分かれ得る）。
4. **閉じ込め**：各粒子を `confine` で卵の内側へ押し戻す。

`confine`（`main.js`）は `eggMap` と同じテーパー式で、その高さでの内側水平半径と
上下限へクランプする。等値面はボール半径ぶん外へ膨らむので、その分だけ内側
（`MARGIN_P`）に寄せて殻からはみ出さないようにしている。

> 粒子は「中身の塊そのもの」ではなく、**等値面を生むための制御点**。
> 重力で粒子が卵の底に溜まる → 反発で底に沿って広がる → その上に張られる
> 滑らかな等値面が「底に溜まったデロッとした塊」に見える。

### 等値面の生成 `buildField()`（`main.js`）

`THREE.MarchingCubes` は r128 の `ImmediateRenderObject`。毎フレーム
`effect.reset()` してから各粒子について `effect.addBall(nx, ny, nz, strength, subtract)`
を呼ぶだけでよい（**実際の三角形化は描画時に自動で走る**ので `update()` 不要）。

- `addBall` の座標 `nx,ny,nz` は**フィールド立方体内の正規化座標 [0,1]**。
  ワールド座標から `n = world / FIELD_SPAN + 0.5` で変換する。
- フィールド立方体は半サイズ `FIELD_HALF = 7.5`（卵を余裕をもって包む）。
  オブジェクトの `scale` をこの半サイズにし、フィールド `[-1,1]` をワールド
  `[-7.5, 7.5]` に対応させる。**ワールドの大きさは scale で決まり、等値面の
  トポロジ（太さ）には影響しない**。
- `isolation` は等値面のしきい値、`strength`/`subtract` は各ボールの場の強さ。
  単一ボールの等値面半径 ≈ `sqrt(strength / (isolation + subtract))`（正規化単位）。
  小さい `isolation`・大きい `strength` ほど太く膨らむ。
- 法線はフィールド勾配から生成されるので、ライティングは常に滑らか。

`resolution`（グリッド分割数）が大きいほど滑らかだが、描画ループは毎フレーム
`resolution³` を走査するので重くなる。`frustumCulled = false`（毎フレーム形が
変わるためカリングしない）。

---

## メインループ（`main.js` の `loop()`）

**固定タイムステップ + アキュムレータ**でフレームレート非依存にする。

```
DT = 1/120
acc += min(経過時間, 0.1)            // タブ復帰時の暴走防止に頭打ち
while (acc >= DT && steps < 8) { step(); acc -= DT; steps++; }
buildField()                         // 等値面の元データ（フィールド）を更新
renderer.render(scene, camera)       // ここで MarchingCubes が三角形化される
```

`step()` は重力追従（`gCur` を `gTarget` へ lerp 0.3）→ 殻（柔体時のみ）→
中身の粒子（`stepParticles`）の順。

### リサイズ（`resize()`）

縦長スマホでも卵が収まるよう、要求サイズとアスペクト比から必要なカメラ距離を
求めて `camera.position.z` を決める。`resize` と `screen.orientation` の `change` で再計算。

---

## 重力入力（`gravity.js`）

`createGravity(canvas, G)` は `gTarget`（目標重力ベクトル）と `update()` を返す。
入力は 2 系統で、**端末センサが有効になったらドラッグ計算は止まる**。

### PC：ドラッグで傾ける

ドラッグ量を `tiltX`（前後）/`tiltZ`（左右）に積み、`update()` で下向きベクトルを
回して `gTarget` を作る。前後ドラッグが z 成分を生むので PC でも奥行きが効く。

### スマホ：端末モーション `onMotion`（推奨）

`devicemotion` の `accelerationIncludingGravity`（端末座標 x=右/y=上/z=画面手前
での「重力込みの加速度」）から重力方向を直接得る:

```
重力下向き = -加速度ベクトル（正規化して G 倍）
g.x = -a.x * (G/9.81)
g.y = -a.y * (G/9.81)
g.z = -a.z * (G/9.81)
```

- **角度から三角関数で組み立てない**ので、端末を立ててもジンバルで符号が飛ばない
  ＝**左右が反転しない**。奥行き(z)も自然に得られる。
- 画面の向き（縦/横 = `screen.orientation.angle`）に応じて画面平面内の `g.x, g.y`
  のみ回転補正する（奥行き z は画面法線なので不変）。
- 端末や OS で軸の向きが逆な場合に備え、`gravity.js` 冒頭の `INV_X/INV_Y/INV_Z`
  を `-1` にすれば該当軸を反転できる。

### フォールバック `onOrientation`

`devicemotion` が重力を返さない端末向けに、`deviceorientation` の beta/gamma から
`cos(beta)` 込みの射影で重力方向を作る経路も残してある（devicemotion が来たら無効）。

### iOS のモーション許可

iOS Safari は `requestPermission()` を**ユーザー操作のハンドラ内で同期的に**呼ぶ
必要があるため、`pointerdown` / `click` / `touchend` で `enableMotion()` を走らせ、
`DeviceMotionEvent` と `DeviceOrientationEvent` の許可をまとめて要求する。

---

## 描画・材質（`scene.js`）

- **レンダラ**: antialias + alpha、ACESFilmic トーンマッピング、sRGB 出力。
- **環境マップ**: 反射に柄が出ないよう、4×4 単色を PMREM に通したフラットな環境。
- **ライト**: 1 灯のディレクショナルライト + 極小の環境光。
- **殻 `shellMat`**: 薄い透明ガラス。`opacity` は `CONFIG.shell.thickness`。
  `depthWrite:false` + `renderOrder` で中身が透けて見える。
- **中身 `coreMat`**: `MarchingCubes` の材質として使う。光沢を抑え（`clearcoat` 低め・
  `roughness` 高め）、ごく弱い自己発光 `emissive` を足して「謎の物体」感を出す。

---

## 調整パラメータ（`main.js` 冒頭 `CONFIG`）

### `CONFIG.shell`

| キー | 既定 | 意味 |
|---|---|---|
| `thickness` | 0.10 | 殻の不透明度（=見た目の厚み） |
| `softness`  | 0.0  | 0=剛体。上げると殻が柔らかく変形 |
| `detail`    | 4    | 殻の分割数。大きいほど滑らか |

### `CONFIG.slime`（メタボール）

| キー | 既定 | 意味 / 触り方 |
|---|---|---|
| `count`      | 18  | 粒子数。多いほど滑らか・連続的だが重い |
| `resolution` | 48  | マーチングキューブ解像度。大きいほど滑らかだが重い |
| `strength`   | 0.62| 各ボールの強さ。大きいほど太く融合する |
| `subtract`   | 12  | 影響の減衰。基本そのまま |
| `isolation`  | 80  | 等値面しきい値。小さいほど膨らむ |
| `separation` | 2.0 | 粒子の最小間隔。大きいほど広がって大きな塊に |
| `cohesion`   | 0.03| まとまる力。小さいほどデロッと広がる（0でバラける） |
| `damping`    | 0.99| 速度減衰。1 に近いほどよく揺れる |

### その他

| キー | 既定 | 意味 |
|---|---|---|
| `CONFIG.gravity` | 6 | 重力の強さ（流れの速さ・反応の速さ） |

### 味付けレシピ例

- **デロデロに広がって底に溜まる**: `cohesion` 0.01, `separation` 2.4, `isolation` 70
- **コロッとした 1 つの塊**: `cohesion` 0.08, `separation` 1.6
- **複数の液滴に分かれて流れる**: `cohesion` 0, `count` 24
- **より滑らか（重くなる）**: `resolution` 64, `count` 28
- **太く / 細く**: `strength` を上げる/下げる、または `isolation` を下げる/上げる

---

## 主要シンボル早見

| シンボル | 場所 | 役割 |
|---|---|---|
| `pPos / pPrev` | main.js | 中身の粒子の現在位置 / 前回位置（Verlet） |
| `effect` | main.js | `THREE.MarchingCubes` 本体（等値面の生成・描画） |
| `FIELD_HALF` | main.js | フィールド立方体の半サイズ（ワールド↔正規化の換算に使う） |
| `confine(pos,i)` | main.js | 粒子を卵内へ押し戻すクランプ |
| `sPos / sPrev` | main.js | 殻メッシュの現在位置 / 前回位置 |
| `gTarget` | gravity.js | 入力からの目標重力ベクトル |
| `gCur`    | main.js | 実際に使う（追従後の）重力ベクトル |

接頭辞 `s` は殻（shell）、`p` は中身の粒子（particle）に対応する。
