// 純粋な幾何・物理ヘルパ（three.js 非依存）。
// 単位アイコスフィアの生成と、ソフトボディに使う基本演算をまとめる。

// アイコスフィア生成（頂点を溶接した連結メッシュ）。
//  中点をキャッシュして共有頂点の単位球を自前で作る。
//  返すのは半径1の方向ベクトル群・面・インデックス。
export function buildIcosphere(subdiv) {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  let faces = [
    [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
    [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
    [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
    [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1],
  ];
  for (let s = 0; s < subdiv; s++) {
    const mid = {};
    const nf = [];
    const midpoint = (a, b) => {
      const key = a < b ? a + "_" + b : b + "_" + a;
      if (mid[key] !== undefined) return mid[key];
      const va = verts[a], vb = verts[b];
      verts.push([(va[0]+vb[0])/2, (va[1]+vb[1])/2, (va[2]+vb[2])/2]);
      return (mid[key] = verts.length - 1);
    };
    for (const f of faces) {
      const a = midpoint(f[0], f[1]);
      const b = midpoint(f[1], f[2]);
      const c = midpoint(f[2], f[0]);
      nf.push([f[0],a,c],[f[1],b,a],[f[2],c,b],[a,b,c]);
    }
    faces = nf;
  }
  const dir = new Float32Array(verts.length * 3); // 正規化した方向
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i];
    const len = Math.hypot(v[0], v[1], v[2]) || 1;
    dir[i*3] = v[0]/len; dir[i*3+1] = v[1]/len; dir[i*3+2] = v[2]/len;
  }
  const index = new Uint16Array(faces.length * 3);
  for (let i = 0; i < faces.length; i++) {
    index[i*3] = faces[i][0]; index[i*3+1] = faces[i][1]; index[i*3+2] = faces[i][2];
  }
  return { dir, faces, index, count: verts.length };
}

// 与えた頂点配列から一意な辺（バネ）を rest 長付きで作る
export function buildEdges(pos, faces) {
  const set = new Set();
  const edges = [];
  const add = (a, b) => {
    const key = a < b ? a + "_" + b : b + "_" + a;
    if (set.has(key)) return;
    set.add(key);
    const dx = pos[b*3]-pos[a*3], dy = pos[b*3+1]-pos[a*3+1], dz = pos[b*3+2]-pos[a*3+2];
    edges.push({ a, b, rest: Math.hypot(dx, dy, dz) });
  };
  for (const f of faces) { add(f[0],f[1]); add(f[1],f[2]); add(f[2],f[0]); }
  return edges;
}

// 符号付き四面体の総和で閉曲面の体積
export function computeVolume(p, faces) {
  let v = 0;
  for (let i = 0; i < faces.length; i++) {
    const a = faces[i][0]*3, b = faces[i][1]*3, c = faces[i][2]*3;
    v += (p[a]*(p[b+1]*p[c+2] - p[b+2]*p[c+1])
        + p[a+1]*(p[b+2]*p[c] - p[b]*p[c+2])
        + p[a+2]*(p[b]*p[c+1] - p[b+1]*p[c]));
  }
  return v / 6;
}

// 内圧：各面を外向き法線方向（×面積）に押す
export function accumulatePressure(p, faces, frc, P) {
  for (let i = 0; i < faces.length; i++) {
    const ai = faces[i][0]*3, bi = faces[i][1]*3, ci = faces[i][2]*3;
    const e1x=p[bi]-p[ai], e1y=p[bi+1]-p[ai+1], e1z=p[bi+2]-p[ai+2];
    const e2x=p[ci]-p[ai], e2y=p[ci+1]-p[ai+1], e2z=p[ci+2]-p[ai+2];
    const nx = (e1y*e2z - e1z*e2y) * 0.5;
    const ny = (e1z*e2x - e1x*e2z) * 0.5;
    const nz = (e1x*e2y - e1y*e2x) * 0.5;
    const fx = nx*P, fy = ny*P, fz = nz*P;
    frc[ai]+=fx; frc[ai+1]+=fy; frc[ai+2]+=fz;
    frc[bi]+=fx; frc[bi+1]+=fy; frc[bi+2]+=fz;
    frc[ci]+=fx; frc[ci+1]+=fy; frc[ci+2]+=fz;
  }
}

// 頂点の隣接リスト（平滑化用）を辺から CSR 形式で作る
export function buildAdjacency(count, edges) {
  const deg = new Int32Array(count);
  for (const e of edges) { deg[e.a]++; deg[e.b]++; }
  const start = new Int32Array(count + 1);
  for (let i = 0; i < count; i++) start[i+1] = start[i] + deg[i];
  const list = new Int32Array(start[count]);
  const cur = start.slice(0, count);
  for (const e of edges) { list[cur[e.a]++] = e.b; list[cur[e.b]++] = e.a; }
  return { start, list };
}

// ラプラシアン平滑化を1回：各頂点を隣接平均へ lambda だけ寄せる（tmp は作業用）。
//  しわ（高周波の凹凸）を均す。lambda<0 で“膨らませ”、正負2回かける（タウバン）と
//  全体の形・体積をほぼ保ったまましわだけ取れる。
export function smoothLaplacian(pos, adj, lambda, tmp) {
  const { start, list } = adj;
  const n = start.length - 1;
  for (let i = 0; i < n; i++) {
    const s = start[i], e = start[i+1], cnt = e - s;
    if (cnt === 0) { tmp[i*3]=pos[i*3]; tmp[i*3+1]=pos[i*3+1]; tmp[i*3+2]=pos[i*3+2]; continue; }
    let ax=0, ay=0, az=0;
    for (let k = s; k < e; k++) { const j = list[k]*3; ax+=pos[j]; ay+=pos[j+1]; az+=pos[j+2]; }
    ax/=cnt; ay/=cnt; az/=cnt;
    tmp[i*3]   = pos[i*3]   + (ax - pos[i*3])   * lambda;
    tmp[i*3+1] = pos[i*3+1] + (ay - pos[i*3+1]) * lambda;
    tmp[i*3+2] = pos[i*3+2] + (az - pos[i*3+2]) * lambda;
  }
  pos.set(tmp);
}

// 辺（距離拘束）を反復で満たす
export function solveEdges(pos, edges, stiffness, iter) {
  for (let it = 0; it < iter; it++) {
    for (let k = 0; k < edges.length; k++) {
      const e = edges[k], a = e.a*3, b = e.b*3;
      const dx=pos[b]-pos[a], dy=pos[b+1]-pos[a+1], dz=pos[b+2]-pos[a+2];
      const d = Math.hypot(dx,dy,dz) || 1e-6;
      const diff = (d - e.rest) / d * 0.5 * stiffness;
      const ox=dx*diff, oy=dy*diff, oz=dz*diff;
      pos[a]+=ox; pos[a+1]+=oy; pos[a+2]+=oz;
      pos[b]-=ox; pos[b+1]-=oy; pos[b+2]-=oz;
    }
  }
}
