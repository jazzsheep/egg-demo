// メタボール（中身＝slime）の粒子シミュレーション。three.js 非依存の純粋計算。
//  数個〜十数個の粒子を Verlet で動かし、反発でほどよく広がって体積を作り、
//  まとまる力で1つの塊を保つ。描画側（main.js）はこの粒子群から等値面を作る。
//  固定メッシュではないので、流れて潰れても折り目（しわ）が原理的に出ない。

// 粒子位置を小さな球内にランダム配置して返す（Float32Array(count*3)）。
export function initParticles(count, radius) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    let x, y, z, d2;
    do {
      x = Math.random() * 2 - 1; y = Math.random() * 2 - 1; z = Math.random() * 2 - 1;
      d2 = x*x + y*y + z*z;
    } while (d2 > 1);
    pos[i*3] = x * radius; pos[i*3+1] = y * radius; pos[i*3+2] = z * radius;
  }
  return pos;
}

// 1ステップ進める。
//  pos/prev : Float32Array(n*3)   現在位置 / 前回位置（Verlet）
//  g        : 重力ベクトル {x,y,z}
//  dt2      : DT*DT
//  p        : { damping, separation, cohesion, iters }
//  confine(pos, i) : 粒子 i を容器（卵）内へ押し戻すコールバック
export function stepParticles(pos, prev, n, dt2, g, p, confine) {
  // --- Verlet 積分（重力＋減衰）---
  for (let i = 0; i < n; i++) {
    const k = i*3;
    let cur;
    cur = pos[k];   pos[k]   = cur + (cur - prev[k])   * p.damping + g.x * dt2; prev[k]   = cur;
    cur = pos[k+1]; pos[k+1] = cur + (cur - prev[k+1]) * p.damping + g.y * dt2; prev[k+1] = cur;
    cur = pos[k+2]; pos[k+2] = cur + (cur - prev[k+2]) * p.damping + g.z * dt2; prev[k+2] = cur;
  }

  // --- 反発：最小間隔 separation を保ってほどよく広がる（＝体積になる・つぶれ防止）---
  const sep = p.separation, sep2 = sep * sep;
  for (let it = 0; it < p.iters; it++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = i*3, b = j*3;
        let dx = pos[b]-pos[a], dy = pos[b+1]-pos[a+1], dz = pos[b+2]-pos[a+2];
        const d2 = dx*dx + dy*dy + dz*dz;
        if (d2 >= sep2 || d2 < 1e-9) continue;
        const d = Math.sqrt(d2);
        const corr = (sep - d) / d * 0.5;
        dx *= corr; dy *= corr; dz *= corr;
        pos[a]-=dx; pos[a+1]-=dy; pos[a+2]-=dz;
        pos[b]+=dx; pos[b+1]+=dy; pos[b+2]+=dz;
      }
    }
  }

  // --- まとまる力：重心へ少し寄せて1つの塊を保つ（小さいほどデロッと広がる）---
  if (p.cohesion > 0) {
    let mx = 0, my = 0, mz = 0;
    for (let i = 0; i < n; i++) { mx += pos[i*3]; my += pos[i*3+1]; mz += pos[i*3+2]; }
    mx /= n; my /= n; mz /= n;
    for (let i = 0; i < n; i++) {
      pos[i*3]   += (mx - pos[i*3])   * p.cohesion;
      pos[i*3+1] += (my - pos[i*3+1]) * p.cohesion;
      pos[i*3+2] += (mz - pos[i*3+2]) * p.cohesion;
    }
  }

  // --- 容器（卵）内へ閉じ込め ---
  for (let i = 0; i < n; i++) confine(pos, i);
}
