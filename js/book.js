// 3D 팝업북: 표지·책장 드래그, 종이 겹 팝업, 캐릭터 모션
import * as THREE from '../vendor/three.module.min.js';
import { makeBackdrop, makePageEdgeTexture, TONES } from './decor.js';
import { Ambience } from './ambience.js';

// 단위: 페이지 폭 = 1
const PW = 1.0, PD = 1.3, COVER_T = 0.025, BLOCK_T = 0.05, PT = COVER_T + BLOCK_T;
const CW = 1.04, CD = 1.36, GAP = 0.012;
// 제본 형태: board 'over'(판지가 책장보다 큼)|'flush'(같음), t 표지 두께, spine 모양, coils 스프링 고리
export const BINDINGS = {
  round: { board: 'over', t: COVER_T, spine: 'round' }, // 둥근 양장
  square: { board: 'over', t: COVER_T, spine: 'square' }, // 각진 양장
  paper: { board: 'flush', t: 0.007, spine: 'flat' }, // 무선 제본
  spiral: { board: 'over', t: 0.016, spine: 'none', coils: true }, // 스프링 제본
  exposed: { board: 'flush', t: 0.009, spine: 'exposed' }, // 노출 제본
};

const E = {
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t) => 1 - Math.pow(1 - t, 4),
  outBack: (t) => { const c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

export class PopupBook {
  constructor(container) {
    this.container = container;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true }));
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.prepend(r.domElement);
    this.canvas = r.domElement;
    this.maxAniso = r.capabilities.getMaxAnisotropy();

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.05, 50);
    this.view = { yaw: -0.2, pitch: 0.9, radius: 3.5, tx: 0, userYaw: 0, userPitch: 0, zoom: 1 };
    this.time = 0;
    this.clock = new THREE.Clock();
    this.tweens = [];
    this.parts = []; this.objParts = []; this.charParts = [];
    this.textures = new Set(); this.texCache = new Map(); this.gen = 0;
    this.listeners = {};
    this.state = 'closed';
    this.busy = false;
    this.openP = 0;
    this.motion = 'sway';
    this.nav = { index: 0, count: () => 1, get: () => null };

    this._stage();
    this._book();
    this.ambience = new Ambience(this.scene);
    this._pointer();
    this._resize();
    new ResizeObserver(() => { if (!this.capturing) this._resize(); }).observe(container);
    r.setAnimationLoop(() => this._tick());
  }

  on(name, fn) { (this.listeners[name] ||= []).push(fn); }
  emit(name, ...a) { (this.listeners[name] || []).forEach((fn) => fn(...a)); }

  // ── 무대
  _stage() {
    const s = this.scene;
    this.hemi = new THREE.HemisphereLight(0xffeee4, 0x3a2430, 0.8); s.add(this.hemi);
    const spot = (this.spot = new THREE.SpotLight(0xffe2c8, 32, 0, 0.5, 0.75, 1.15));
    spot.position.set(-1.6, 4.4, 2.4); spot.target.position.set(0.1, 0.2, -0.1);
    spot.castShadow = true; spot.shadow.mapSize.set(2048, 2048);
    spot.shadow.bias = -0.0004; spot.shadow.normalBias = 0.015;
    s.add(spot, spot.target);
    this.rim = new THREE.DirectionalLight(0xc98cff, 0.8); this.rim.position.set(2.5, 2.2, -3); s.add(this.rim);
    this.tableMat = new THREE.MeshStandardMaterial({ color: 0x1b2132, roughness: 0.95 });
    const table = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), this.tableMat);
    table.rotation.x = -Math.PI / 2; table.position.y = -0.001; table.receiveShadow = true; s.add(table);
    s.fog = new THREE.Fog(0x000000, 10, 22);
  }

  /** 표지 색 테마 톤 (무대 배경·바닥에 은은하게) */
  setTone(tone) { if (tone === this.tone) return; this.tone = tone; if (this.themeName) this.setTheme(this.themeName); }
  setTheme(theme) {
    const dark = theme === 'dark';
    this.themeName = theme;
    // 무대 배경: 톤매핑·조명·안개를 거치지 않는 판 (테마 색이 그대로 보이게)
    if (!this.bgMesh) {
      this.bgMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ toneMapped: false, fog: false, depthWrite: false, depthTest: false }));
      this.bgMesh.renderOrder = -10; this.bgMesh.frustumCulled = false; this.bgMesh.position.z = -45;
      this.camera.add(this.bgMesh); this.scene.add(this.camera);
    }
    this._dispose(this.bgMesh.material.map);
    this.bgMesh.material.map = this._tex(makeBackdrop(theme, this.tone)); this.bgMesh.material.needsUpdate = true;
    this._fitBg();
    this.tableMat.color.set((TONES[this.tone] || TONES.sunset).table[dark ? 1 : 0]);
    this.scene.fog.color.set(dark ? 0x120b18 : 0xfff6f1);
    this.hemi.intensity = dark ? 0.75 : 1.25;
    this.hemi.groundColor.set(dark ? 0x3a2430 : 0xdcc2b9);
    this.spot.intensity = dark ? 34 : 26;
    this.rim.intensity = dark ? 0.9 : 0.4;
    this.renderer.toneMappingExposure = dark ? 1.05 : 1.12;
    this.ambience.setTheme(theme);
  }

  _tex(canvas, flipX = false) {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = this.maxAniso;
    if (typeof ImageBitmap !== 'undefined' && canvas instanceof ImageBitmap) t.flipY = false; // 워커가 미리 뒤집어 보냄
    if (flipX) { t.wrapS = THREE.RepeatWrapping; t.repeat.x = -1; t.offset.x = 1; }
    this.textures.add(t); return t;
  }
  _dispose(t) { if (t) { t.dispose(); this.textures.delete(t); } }

  // ── 텍스처 캐시: 같은 그림은 한 번만 GPU에 올림 (앞뒤 장을 오가도 재업로드 없음)
  // gen: _build/warm 때마다 증가, 최근 3세대에 쓰이지 않은 것만 정리
  _ctex(img, flipX = false) {
    let e = this.texCache.get(img);
    if (!e) { e = { gen: this.gen }; this.texCache.set(img, e); }
    const k = flipX ? 'x' : 'n';
    if (!e[k]) e[k] = this._tex(img, flipX);
    e.gen = this.gen;
    return e[k];
  }
  _prune() {
    for (const [img, e] of this.texCache) {
      if (e.gen >= this.gen - 3) continue;
      this._dispose(e.n); this._dispose(e.x); this.texCache.delete(img);
    }
  }
  /** 다음·이전 장 텍스처를 미리 GPU에 올림 → 넘길 때 멈칫 없음 */
  warm(a) {
    if (!a) return;
    const up = (img, flip) => { if (img) this.renderer.initTexture(this._ctex(img, flip)); };
    for (const l of a.layers || []) { up(l.canvas); up(l.back, true); }
    for (const o of a.objects || []) { up(o.card.canvas); up(o.card.back, true); }
    for (const c of a.chars || []) { up(c.card.canvas); up(c.card.back, true); }
    up(a.pageL); up(a.pageL, true); up(a.pageR);
  }

  // ── 책 본체
  _book() {
    // 책 전체 = flipper(뒤집기 축) > root(제본 형태에 따른 높이 보정) > 각 부품
    this.flipper = new THREE.Group(); this.root = new THREE.Group(); this.flipper.add(this.root); this.scene.add(this.flipper);
    const edgeTex = new THREE.CanvasTexture(makePageEdgeTexture());
    const edgeMat = new THREE.MeshStandardMaterial({ map: edgeTex, roughness: 0.9 });
    const paperMat = new THREE.MeshStandardMaterial({ color: 0xf6f2e8, roughness: 0.95 });
    this.coverMat = new THREE.MeshStandardMaterial({ color: 0x5a2a55, roughness: 0.75 });
    const half = () => {
      const g = new THREE.Group();
      const cover = new THREE.Mesh(new THREE.BoxGeometry(CW, COVER_T, CD), this.coverMat);
      const block = new THREE.Mesh(new THREE.BoxGeometry(PW, BLOCK_T, PD), [edgeMat, edgeMat, paperMat, paperMat, edgeMat, edgeMat]);
      const pageMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 });
      const page = new THREE.Mesh(new THREE.PlaneGeometry(PW, PD).rotateX(-Math.PI / 2), pageMat);
      [cover, block, page].forEach((m) => { m.castShadow = m.receiveShadow = true; g.add(m); });
      return { g, cover, block, page, pageMat };
    };
    const R = (this.right = half());
    R.cover.position.set(CW / 2 + 0.005, COVER_T / 2, 0);
    R.block.position.set(PW / 2 + GAP, COVER_T + BLOCK_T / 2, 0);
    R.page.position.set(PW / 2 + GAP, PT + 0.0006, 0);
    this.root.add(R.g);
    const L = (this.left = half());
    const pivot = (this.pivot = new THREE.Group()); pivot.position.set(0, PT + 0.0012, 0);
    L.cover.position.set(-CW / 2 - 0.005, -PT + COVER_T / 2 - 0.0012, 0);
    L.block.position.set(-PW / 2 - GAP, -BLOCK_T / 2 - 0.0012, 0);
    L.page.position.set(-PW / 2 - GAP, 0.0003, 0);
    pivot.add(L.g); this.root.add(pivot);
    // 표지 그림 (닫힘 상태에서 위를 향함)
    this.coverArtMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
    const art = (this.coverArt = new THREE.Mesh(new THREE.PlaneGeometry(CW, CD).rotateX(Math.PI / 2).rotateY(Math.PI), this.coverArtMat));
    art.position.set(-CW / 2 - 0.005, -PT - 0.0018, 0); pivot.add(art);
    // 뒷표지 그림 (오른쪽 판지 바깥면, 아래를 향함)
    this.backArtMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 });
    const back = (this.backArt = new THREE.Mesh(new THREE.PlaneGeometry(CW, CD).rotateX(Math.PI / 2).rotateY(Math.PI), this.backArtMat)); // 뒤집었을 때 바로 보이게
    back.position.set(CW / 2 + 0.005, -0.0004, 0); this.root.add(back);
    this._spine();
    this._coils();

    this.diorama = new THREE.Group(); this.diorama.position.y = PT + 0.001; this.root.add(this.diorama);

    // 넘김용 낱장
    const geo = (this.leafGeo = new THREE.PlaneGeometry(PW, PD, 40, 1).rotateX(-Math.PI / 2).translate(PW / 2, 0, 0));
    this.leafU = Float32Array.from({ length: geo.attributes.position.count }, (_, i) => geo.attributes.position.getX(i) / PW);
    this.leafFront = new THREE.MeshStandardMaterial({ side: THREE.FrontSide, roughness: 0.92 });
    this.leafBack = new THREE.MeshStandardMaterial({ side: THREE.BackSide, roughness: 0.92 });
    const a = new THREE.Mesh(geo, this.leafFront), b = new THREE.Mesh(geo, this.leafBack);
    a.castShadow = a.receiveShadow = b.receiveShadow = true;
    this.leaf = new THREE.Group(); this.leaf.add(a, b);
    this.leaf.position.set(GAP, PT + 0.004, 0); this.leaf.visible = false;
    this.root.add(this.leaf);
    this.binding = 'round'; this._applyBinding();
    this._setOpen(0);
  }

  _setOpen(p) { this.openP = p; this.pivot.rotation.z = -Math.PI * (1 - p); this._bendSpine(); }

  // ── 책등
  _spine() {
    const N = 54, n = (N + 1) * 2;
    const mk = (count) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3)); return g; };
    // 바깥면 (책등 그림)
    const outer = mk(n), uv = new Float32Array(n * 2), idx = [];
    for (let i = 0; i <= N; i++) {
      uv.set([0, i / N, 1, i / N], i * 4); // u: 책 세로(z), v: 두께 방향
      if (i < N) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    outer.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); outer.setIndex(idx);
    // 안쪽면 + 위아래 마구리
    const inner = mk(n * 2), idx2 = [...idx];
    for (let i = 0; i < N; i++) for (const z of [0, 1]) { const o = i * 2 + z, q = n + i * 2 + z; idx2.push(o, o + 2, q, q, o + 2, q + 2); }
    for (let i = 0; i < N; i++) { const a = n + i * 2; idx2.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    inner.setIndex(idx2);
    this.spineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, side: THREE.DoubleSide });
    this.spineOuter = new THREE.Mesh(outer, this.spineMat);
    this.spineInner = new THREE.Mesh(inner, this.coverMat);
    this.coverMat.side = THREE.DoubleSide;
    [this.spineOuter, this.spineInner].forEach((m) => { m.castShadow = m.receiveShadow = true; this.root.add(m); });
    this.spineN = N;
  }
  _bendSpine() {
    if (!this.spineOuter) return;
    const N = this.spineN, th = 0.006, hz = (this.boardD || CD) / 2; // 책등 길이 = 판지 세로 (무선은 책장과 같은 크기)
    const ang = this.pivot.rotation.z, c = Math.cos(ang), si = Math.sin(ang), py = PT + 0.0012;
    const off = COVER_T - this.dims.t;                 // 얇은 표지면 바깥면이 위로
    const ax = 0.005, ay = off;                        // 오른쪽 판지 안쪽 끝 (바깥면)
    const lx = -0.005, ly = -PT - 0.0012 + off;        // 왼쪽 판지 안쪽 끝 (피벗 기준)
    const bx = c * lx - si * ly, by = si * lx + c * ly + py;
    const vx = bx - ax, vy = by - ay, len = Math.hypot(vx, vy) || 1e-6;
    const nx = -vy / len, ny = vx / len;
    const P = [];
    if (this.dims.spine === 'round') { // 둥근 책등: 바깥으로 볼록한 곡선
      const bulge = 0.42 * len, mx = (ax + bx) / 2 + nx * bulge, my = (ay + by) / 2 + ny * bulge;
      for (let i = 0; i <= N; i++) { const t = i / N, u = 1 - t; P.push([u * u * ax + 2 * u * t * mx + t * t * bx, u * u * ay + 2 * u * t * my + t * t * by]); }
    } else { // 각진 책등: 두 모서리를 가진 평평한 판 (덮였을 때 평평한 면)
      const d = this.dims.spine === 'square' ? 0.016 : this.dims.spine === 'exposed' ? 0.004 : 0.006;
      const pts = [[ax, ay], [ax + nx * d, ay + ny * d], [bx + nx * d, by + ny * d], [bx, by]];
      const seg = [Math.hypot(nx * d, ny * d), len, Math.hypot(nx * d, ny * d)], tot = seg[0] + seg[1] + seg[2];
      for (let i = 0; i <= N; i++) {
        let t = (i / N) * tot, k = 0; while (k < 2 && t > seg[k]) { t -= seg[k]; k++; }
        const f = seg[k] ? Math.min(1, t / seg[k]) : 0, A = pts[k], B = pts[k + 1];
        P.push([A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f]);
      }
    }
    if (this.dims.spine === 'exposed') { // 접장마다 살짝 볼록한 결
      for (let i = 1; i < N; i++) { const bump = 0.0026 * Math.abs(Math.sin((i / N) * Math.PI * 9)); P[i][0] += nx * bump; P[i][1] += ny * bump; }
    }
    for (const q of P) q[1] = Math.max(0.0004 + off, q[1]);
    const po = this.spineOuter.geometry.attributes.position, pi = this.spineInner.geometry.attributes.position, n = (N + 1) * 2;
    for (let i = 0; i <= N; i++) {
      const [x, y] = P[i], a = P[Math.max(0, i - 1)], b = P[Math.min(N, i + 1)];
      const tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty) || 1;
      const ox = -ty / tl, oy = tx / tl;                 // 바깥 방향
      po.setXYZ(i * 2, x, y, -hz); po.setXYZ(i * 2 + 1, x, y, hz);
      pi.setXYZ(i * 2, x, y, -hz); pi.setXYZ(i * 2 + 1, x, y, hz);
      pi.setXYZ(n + i * 2, x - ox * th, y - oy * th, -hz); pi.setXYZ(n + i * 2 + 1, x - ox * th, y - oy * th, hz);
    }
    po.needsUpdate = pi.needsUpdate = true;
    this.spineOuter.geometry.computeVertexNormals(); this.spineInner.geometry.computeVertexNormals();
    this.spineOuter.geometry.computeBoundingSphere(); this.spineInner.geometry.computeBoundingSphere();
  }

  // ── 제본 형태
  setBindingStyle(style) {
    if (!BINDINGS[style] || style === this.binding) return;
    this.binding = style; this._applyBinding(); this._bendSpine();
  }
  _applyBinding() {
    const d = (this.dims = BINDINGS[this.binding]);
    const bw = d.board === 'flush' ? PW + GAP + 0.004 : CW, bd = d.board === 'flush' ? PD + 0.004 : CD, t = d.t, off = COVER_T - t;
    const R = this.right.cover, L = this.left.cover;
    R.scale.set(bw / CW, t / COVER_T, bd / CD); R.position.set(bw / 2 + 0.005, COVER_T - t / 2, 0);
    L.scale.set(bw / CW, t / COVER_T, bd / CD); L.position.set(-bw / 2 - 0.005, -PT + COVER_T - t / 2 - 0.0012, 0);
    this.coverArt.scale.set(bw / CW, 1, bd / CD); this.coverArt.position.set(-bw / 2 - 0.005, -PT - 0.0018 + off, 0);
    this.backArt.scale.set(bw / CW, 1, bd / CD); this.backArt.position.set(bw / 2 + 0.005, -0.0004 + off, 0);
    this.spineOuter.visible = this.spineInner.visible = d.spine !== 'none';
    this.coilGroup.visible = !!d.coils;
    // 얇은 표지만큼 책 전체를 내려 바닥에 닿게
    this.root.position.set(-this.flipC.x, -this.flipC.y - off, 0);
    this.floorY = PT + 0.001 - off;
    this.bookW = bw; this.boardD = d.spine === 'exposed' ? PD : bd;
  }
  _coils() {
    // 스프링 고리: 펼쳐도 덮어도 모양 유지
    this.coilGroup = new THREE.Group();
    const r = PT + 0.016, geo = new THREE.TorusGeometry(r, 0.0042, 8, 40);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8f8f96, metalness: 0.8, roughness: 0.35 });
    for (let z = -PD / 2 + 0.05; z <= PD / 2 - 0.04; z += 0.06) {
      const m = new THREE.Mesh(geo, mat); m.position.set(0, PT + 0.0012, z); m.castShadow = true; this.coilGroup.add(m);
    }
    this.root.add(this.coilGroup);
    // 뒤집기 축: 덮인 책의 가운데
    this.flipC = { x: CW / 2 + 0.005, y: PT + 0.0012 };
    this.flipper.position.set(this.flipC.x, this.flipC.y, 0);
  }

  /** 즉시 앞/뒤 (녹화 시작용) */
  setBackShown(on) { this.backShown = !!on; this.flipper.rotation.z = on ? Math.PI : 0; this.flipper.position.y = this.flipC.y; }
  /** 덮인 책을 뒤집어 뒷표지 보기 */
  async showBack(on) {
    if (this.state !== 'closed' || this.busy || !!on === !!this.backShown) return;
    this.backShown = !!on; this.busy = true;
    const from = this.flipper.rotation.z, to = on ? Math.PI : 0, lift = 0.35;
    await this.animate(1.1, (t) => {
      this.flipper.rotation.z = lerp(from, to, t);
      this.flipper.position.y = this.flipC.y + Math.sin(t * Math.PI) * lift;
    }, E.inOut);
    this.busy = false;
  }

  /** 판지 색 + 책등·뒷표지 그림 (표지 색 테마에 맞춤) */
  setBinding({ color, spine, back }) {
    if (color) this.coverMat.color.set(color);
    if (spine) { this._dispose(this.spineMat.map); this.spineMat.map = this._tex(spine); this.spineMat.needsUpdate = true; }
    if (back) { this._dispose(this.backArtMat.map); this.backArtMat.map = this._tex(back); this.backArtMat.needsUpdate = true; }
  }

  _setLeaf(a) {
    this.leafA = a;
    const pos = this.leafGeo.attributes.position, n = 40, du = PW / n;
    const xs = new Float32Array(n + 1), ys = new Float32Array(n + 1);
    let x = 0, y = 0;
    for (let k = 0; k <= n; k++) {
      xs[k] = x; ys[k] = y;
      const th = a - 0.06 * (k / n) * Math.sin(a); // 팝업북 책장은 두꺼운 판지 → 거의 휘지 않음
      x += Math.cos(th) * du; y += Math.sin(th) * du;
    }
    for (let i = 0; i < pos.count; i++) { const k = Math.round(this.leafU[i] * n); pos.setX(i, xs[k]); pos.setY(i, ys[k] + 0.0005 * (k / n)); }
    pos.needsUpdate = true; this.leafGeo.computeVertexNormals();
  }

  setCover(canvas) { this._dispose(this.coverArtMat.map); this.coverArtMat.map = this._tex(canvas); this.coverArtMat.needsUpdate = true; }

  _setPages(L, R) {
    this.left.pageMat.map = this._ctex(L); this.right.pageMat.map = this._ctex(R);
    this.left.pageMat.needsUpdate = this.right.pageMat.needsUpdate = true;
  }

  // ── 디오라마
  // 한 장(spread)의 팝업 묶음 = set { group, parts, charParts, objParts, assets, DW }
  // 책장을 넘기는 동안에는 지금 장(닫히는 중)과 다음 장(열리는 중) 두 묶음이 동시에 존재
  _makeSet(assets) {
    const set = { group: new THREE.Group(), parts: [], charParts: [], objParts: [], assets };
    const L = assets.layers.length;
    let DW = 1.8;
    if (L && assets.layers[0].aspect * DW > 1.0) DW = 1.0 / assets.layers[0].aspect;
    set.DW = DW;
    assets.layers.forEach((ly, i) => {
      const z = L > 1 ? lerp(-0.5, 0.12, i / (L - 1)) : -0.5;
      const g = this._card(ly.canvas, ly.back, DW, DW * ly.aspect, 0.004);
      g.position.set(0, 0.0015 * (i + 1), z);
      set.group.add(g);
      set.parts.push({ group: g, card: g, kind: 'layer', i, n: L, rise: 1, h: DW * ly.aspect, z, src: ly });
    });
    // 캐릭터 여럿: 각자 받침대 + 위치
    (assets.chars || []).forEach(({ card: c, placement }, i) => {
      const h = 0.42, w = h / c.aspect;
      const g = this._card(c.canvas, c.back, w, h, 0.003);
      const stand = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.35, h * 0.32).translate(0, h * 0.16, 0),
        new THREE.MeshStandardMaterial({ color: 0xece4d0, roughness: 1, side: THREE.DoubleSide }));
      stand.rotation.x = -0.55; stand.position.z = -0.006; stand.castShadow = true; g.add(stand);
      const pivot = new THREE.Group(); pivot.add(g); set.group.add(pivot);
      const part = { group: pivot, inner: g, card: g, kind: 'char', idx: i, rise: 1, h, phase: i * 2.1, src: c };
      set.charParts.push(part); set.parts.push(part);
      this.setPlacement(i, placement, set);
    });
    // 배경에서 오려 낸 물체: 캐릭터처럼 세우고 옮길 수 있음
    (assets.objects || []).forEach((o, i) => {
      const h = o.h * DW, w = h / o.card.aspect;
      const g = this._card(o.card.canvas, o.card.back, w, h, 0.003);
      const pivot = new THREE.Group(); pivot.add(g); set.group.add(pivot);
      const part = { group: pivot, inner: g, card: g, kind: 'obj', idx: i, rise: 1, phase: i * 1.7, src: o.card };
      set.objParts.push(part); set.parts.push(part);
      this._placeObj(part, o.place, set);
    });
    this.diorama.add(set.group);
    return set;
  }
  _useSet(set) {
    this.cur = set;
    this.parts = set ? set.parts : []; this.charParts = set ? set.charParts : []; this.objParts = set ? set.objParts : [];
    if (set) { this.assets = set.assets; this.DW = set.DW; }
  }
  _disposeSet(set) {
    if (!set) return;
    set.group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); // 텍스처는 캐시가 관리
    this.diorama.remove(set.group);
  }
  _clear() {
    this._disposeSet(this.cur); this._useSet(null);
    if (this.next) { this._disposeSet(this.next); this.next = null; }
  }

  _card(canvas, back, w, h, thick) {
    const g = new THREE.Group(), geo = new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0);
    const f = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: this._ctex(canvas), alphaTest: 0.5, roughness: 0.88 }));
    const b = new THREE.Mesh(geo.clone(), new THREE.MeshStandardMaterial({ map: this._ctex(back, true), alphaTest: 0.5, roughness: 0.95 }));
    b.rotation.y = Math.PI; b.position.z = -thick;
    [f, b].forEach((m) => { m.castShadow = m.receiveShadow = true; g.add(m); });
    return g;
  }

  _build(assets) {
    this._clear();
    this.gen++;
    this._useSet(this._makeSet(assets));
    this.setMotion(assets.motion || 'sway');
    this._ctex(assets.pageL); this._ctex(assets.pageR); this._ctex(assets.pageL, true);
    this._prune();
  }

  setPlacement(i, pl, set = this.cur) {
    const part = set?.charParts[i];
    if (!part || !pl) return;
    part.place = { ...pl }; this._dropProxy(part);
    const g = part.group, DW = set.DW || 1.8;
    g.position.set(clamp(pl.x, -1, 1) * DW * 0.46, 0.012 + i * 0.0003, lerp(-0.42, 0.56, clamp(pl.d)));
    g.scale.setScalar((pl.h || 0.42) / part.h);
  }
  _placeObj(part, pl, set = this.cur) {
    const DW = set?.DW || this.DW || 1.8;
    part.place = { ...pl }; this._dropProxy(part);
    part.group.position.set(clamp(pl.x, -1, 1) * DW * 0.46, 0.006 + part.idx * 0.0004, lerp(-0.42, 0.56, clamp(pl.d)));
  }
  setMotion(m) { this.motion = m; for (const c of this.charParts) { c.inner.rotation.set(0, 0, 0); c.inner.position.set(0, 0, 0); c.inner.scale.set(1, 1, 1); } }
  setAmbience(a) { this.ambience.set(a); }

  // ── 진짜 팝업북처럼 접기
  // 각 장의 팝업은 양쪽 책장에 붙어 있고, 두 책장 사이 각도(D: π=활짝, 0=덮임)에 따라 접힘
  // · 가운데 접는 선(책 골) 기준 오른쪽 반은 오른쪽 책장을, 왼쪽 반은 왼쪽 책장을 따라 기울고
  // · 세로선(세운 방향)은 두 책장의 가운데 면을 따라 앞으로 눕는다
  // → 모든 조각이 같은 방향으로 접혀 서로 평행 (겹치지 않음), 두 책장 사이 쐐기 안에만 머묾 (책장을 뚫지 않음)
  // · 덮였을 때 책장 밖으로 나가지 않도록, 접히는 만큼 세로를 줄임
  _proxy(part, set) {
    if (part.proxy) return part.proxy;
    // 펼친 상태 기준 정점 위치 (움직임 초기화 후)
    const rot = part.group.rotation.x, sy = part.group.scale.y;
    part.group.rotation.x = 0; part.group.scale.y = part.kind === 'layer' ? 1 : part.group.scale.y;
    if (part.inner) { part.inner.rotation.set(0, 0, 0); part.inner.position.set(0, 0, 0); part.inner.scale.set(1, 1, 1); }
    set.group.updateMatrixWorld(true);
    const f = part.card.children[0], prm = f.geometry.parameters;
    const geo = new THREE.PlaneGeometry(prm.width, prm.height, 32, 2).translate(0, prm.height / 2, 0);
    const toSet = new THREE.Matrix4().copy(set.group.matrixWorld).invert().multiply(f.matrixWorld);
    geo.applyMatrix4(toSet);
    const rest = Float32Array.from(geo.attributes.position.array);
    part.group.rotation.x = rot; part.group.scale.y = sy;
    let zMin = Infinity, hMax = 0;
    for (let k = 0; k < rest.length; k += 3) { hMax = Math.max(hMax, rest[k + 1]); zMin = Math.min(zMin, rest[k + 2]); }
    const room = PD / 2 - 0.03 - zMin; // 앞쪽으로 눕힐 여유
    const front = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: this._ctex(part.src.canvas), alphaTest: 0.5, roughness: 0.88, side: THREE.FrontSide }));
    const back = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: this._ctex(part.src.back), alphaTest: 0.5, roughness: 0.95, side: THREE.BackSide }));
    const g = new THREE.Group(); g.add(front, back);
    [front, back].forEach((m) => { m.castShadow = m.receiveShadow = true; m.frustumCulled = false; });
    set.group.add(g);
    part.proxy = { g, geo, rest, fit: clamp(room / Math.max(hMax, 1e-3), 0.04, 1) };
    return part.proxy;
  }
  _dropProxy(part) {
    if (!part.proxy) return;
    const { g } = part.proxy;
    g.parent?.remove(g); g.children.forEach((m) => m.material.dispose()); part.proxy.geo.dispose();
    part.proxy = null;
  }
  /**
   * set을 각도 D로 접기. fixed: 바닥에 붙어 있는 쪽 책장 ('L'|'R'), px·py: 경첩 위치(디오라마 좌표)
   */
  _foldSet(set, D, fixed, px = 0, py = 0) {
    if (!set) return;
    if (D >= Math.PI - 1e-4) { // 활짝: 원래 카드로 (캐릭터 움직임 등 재개)
      for (const p of set.parts) { p.group.visible = true; p.folded = false; if (p.proxy) p.proxy.g.visible = false; }
      return;
    }
    const phi = (Math.PI - D) / 2, lam = phi, k = lam / (Math.PI / 2);
    const th = fixed === 'L' ? phi : -phi, ct = Math.cos(th), st = Math.sin(th);
    const cp = Math.cos(phi), sp = Math.sin(phi), cl = Math.cos(lam), sl = Math.sin(lam);
    for (const p of set.parts) {
      const pr = this._proxy(p, set);
      p.group.visible = false; p.folded = true; pr.g.visible = D > 0.004;
      const r = pr.rest, pos = pr.geo.attributes.position.array;
      // 세로 줄임: 덮였을 때 앞쪽 여유 & 기울어진 높이가 책장 바깥 끝을 넘지 않게 (각 책장 방향으로 투영한 길이 ≤ 책장 폭)
      let s = lerp(1, pr.fit, k);
      const lean = cl * sp; // 세로 1이 책장 방향으로 차지하는 길이
      if (lean > 1e-4) for (let j = 0; j < r.length; j += 3) {
        const v = r[j + 1]; if (v < 1e-3) continue;
        s = Math.min(s, Math.max(0.03, (PW - 0.04 - Math.abs(r[j] - px)) / (v * lean)));
      }
      for (let j = 0; j < r.length; j += 3) {
        const x = r[j] - px, v = r[j + 1] * s, ax = Math.abs(x), ex = x >= 0 ? cp : -cp;
        const qx = ax * ex, qy = ax * sp + v * cl, qz = r[j + 2] + v * sl;
        pos[j] = qx * ct - qy * st + px; pos[j + 1] = qx * st + qy * ct + py; pos[j + 2] = qz;
      }
      pr.geo.attributes.position.needsUpdate = true; pr.geo.computeVertexNormals(); pr.geo.computeBoundingSphere();
    }
  }

  // ── 트윈
  /** 책 시간 기준 대기 (녹화 속도·고정 간격과 함께 늘고 줄음) */
  wait(sec) { return this.animate(sec, () => {}); }
  animate(dur, fn, ease = E.inOut, delay = 0) {
    return new Promise((resolve) => this.tweens.push({ t0: this.time + delay, dur, fn, ease, resolve }));
  }

  // ── 상태 전환 (공개 API)
  showClosed() {
    this.tweens = []; this._clear(); this.leaf.visible = false;
    this.backShown = false; this.flipper.rotation.z = 0; this.flipper.position.y = this.flipC.y;
    this._setOpen(0); this.state = 'closed'; this.busy = false;
  }

  /** 버튼·영상용 자동 펼치기 */
  async open() {
    if (this.state !== 'closed' || this.busy) return;
    if (this.nav.ready && !this.nav.ready(this.nav.index)) { this.emit('wait', this.nav.index); return; }
    this._beginCover('open');
    await this._endCover(true, 1.8);
  }

  /** 영상용: 펼친 책 덮기 */
  async close() {
    if (this.state !== 'open' || this.busy) return;
    this._beginCover('close');
    await this._endCover(true, 1.6);
  }

  /** 버튼·키보드·영상용 자동 넘기기 */
  async flip(dir) {
    if (this.state !== 'open' || this.busy) return false;
    if (!this._beginLeaf(dir)) return false;
    await this._endLeaf(true, 1.6);
    return true;
  }

  update(assets) {
    if (this.state !== 'open') return;
    this._setPages(assets.pageL, assets.pageR);
    this._build(assets);
    this.setAmbience(assets.ambience || 'dust');
  }

  // 표지 드래그
  _beginCover(mode) {
    this.busy = true; this.coverMode = mode;
    if (mode === 'open') {
      const a = this.nav.get(this.nav.index);
      this._setPages(a.pageL, a.pageR);
      this._build(a);
      this.setAmbience(a.ambience || 'dust');
      this._camTo('open');
    }
  }
  // 표지(왼쪽 판)가 움직이고 오른쪽 책장이 바닥: 첫 장 팝업이 펼침 각도를 그대로 따라감
  _coverP(p) { this._setOpen(p); this._foldSet(this.cur, p * Math.PI, 'R', 0, 0.0002); }
  async _endCover(commit, dur) {
    const from = this.openP, target = (this.coverMode === 'open') === commit ? 1 : 0;
    const d = dur ?? 0.25 + 0.6 * Math.abs(target - from);
    await this.animate(d, (t) => this._coverP(lerp(from, target, t)), target ? E.out : E.inOut);
    if (target === 1) {
      this.state = 'open'; this._coverP(1);
      this.busy = false;
      if (this.coverMode === 'close') this._camTo('open');
      if (this.coverMode === 'open') { this.emit('open'); this.emit('chapter', this.nav.index); }
    } else {
      this._clear(); this.state = 'closed'; this.busy = false;
      this._camTo('closed');
      if (this.coverMode === 'close') this.emit('close');
    }
  }

  // 책장 드래그: dir 1 다음 / -1 이전
  _beginLeaf(dir) {
    const next = this.nav.index + dir;
    if (next < 0 || next >= this.nav.count()) { this.emit('edge', dir); return false; }
    if (this.nav.ready && !this.nav.ready(next)) { this.emit('wait', next); return false; }
    this.busy = true; this.leafDir = dir;
    const a = this.nav.get(next);
    this.leafAssets = a;
    this.oldPages = { L: this.left.pageMat.map, R: this.right.pageMat.map };
    if (dir > 0) {
      this.leafFront.map = this._ctex(this.oldPages.R.image);
      this.leafBack.map = this._ctex(a.pageL, true);
      this.right.pageMat.map = this._ctex(a.pageR);
    } else {
      this.leafFront.map = this._ctex(a.pageR);
      this.leafBack.map = this._ctex(this.oldPages.L.image, true);
      this.left.pageMat.map = this._ctex(a.pageL);
    }
    this.leafFront.needsUpdate = this.leafBack.needsUpdate = this.left.pageMat.needsUpdate = this.right.pageMat.needsUpdate = true;
    // 다음 장 팝업을 미리 만들어 덮인 상태로 둠 (낱장 반대편 쐐기에서 함께 펼쳐짐)
    this.gen++;
    this.next = this._makeSet(a);
    for (const c of this.charParts) { c.inner.rotation.set(0, 0, 0); c.inner.position.set(0, 0, 0); c.inner.scale.set(1, 1, 1); }
    this._leafAngle(dir > 0 ? 0 : Math.PI);
    this.leaf.visible = true;
    return true;
  }
  /**
   * 낱장 각도 a (0: 오른쪽에 누움 ~ π: 왼쪽에 누움)
   * 낱장 한쪽 면 = 지금 장의 한쪽, 다른 면 = 다음 장의 한쪽 → 두 장의 팝업이 낱장을 사이에 두고 동시에 접히고 펼쳐짐
   */
  _leafAngle(a) {
    this._setLeaf(a);
    const px = GAP, py = 0.003; // 낱장 경첩 (디오라마 좌표)
    if (this.leafDir > 0) {
      this._foldSet(this.cur, Math.PI - a, 'L', px, py);  // 지금 장: 왼쪽 책장 + 낱장 앞면 사이
      this._foldSet(this.next, a, 'R', px, py);           // 다음 장: 낱장 뒷면 + 오른쪽 책장 사이
    } else {
      this._foldSet(this.cur, a, 'R', px, py);
      this._foldSet(this.next, Math.PI - a, 'L', px, py);
    }
  }
  async _endLeaf(commit, dur) {
    const dir = this.leafDir, from = this.leafA;
    const done = commit ? (dir > 0 ? Math.PI : 0) : (dir > 0 ? 0 : Math.PI);
    const d = dur ?? 0.3 + 0.6 * Math.abs(done - from) / Math.PI;
    await this.animate(d, (t) => this._leafAngle(lerp(from, done, t)), dur ? E.inOut : E.out);
    this.leaf.visible = false;
    if (commit) {
      if (dir > 0) this.left.pageMat.map = this._ctex(this.leafAssets.pageL);
      else this.right.pageMat.map = this._ctex(this.leafAssets.pageR);
      this.left.pageMat.needsUpdate = this.right.pageMat.needsUpdate = true;
      this.nav.index += dir;
      this._disposeSet(this.cur); this._useSet(this.next); this.next = null;
      this._foldSet(this.cur, Math.PI);
      this.setMotion(this.leafAssets.motion || 'sway');
      this.setAmbience(this.leafAssets.ambience || 'dust');
      this._prune();
      this.emit('flip', this.nav.index);
      this.emit('chapter', this.nav.index);
    } else {
      // 원래 면 복구
      if (dir > 0) this.right.pageMat.map = this.oldPages.R;
      else this.left.pageMat.map = this.oldPages.L;
      this.left.pageMat.needsUpdate = this.right.pageMat.needsUpdate = true;
      this._disposeSet(this.next); this.next = null;
      this._foldSet(this.cur, Math.PI);
    }
    this._disposeLeaf();
    this.busy = false;
  }
  _disposeLeaf() { this.leafFront.map = this.leafBack.map = null; this.leafFront.needsUpdate = this.leafBack.needsUpdate = true; }

  _camTo(which) {
    const v = this.view, from = { tx: v.tx, pitch: v.pitch, yaw: v.yaw, radius: v.radius };
    const to = which === 'open' ? { tx: 0, pitch: 0.86, yaw: -0.2, radius: 4.1 } : { tx: 0.5, pitch: 1.08, yaw: -0.12, radius: 3.9 };
    this.animate(1.2, (t) => { for (const k in to) v[k] = lerp(from[k], to[k], t); }, E.inOut);
  }
  setClosedView() { Object.assign(this.view, { tx: 0.5, pitch: 1.08, yaw: -0.12, radius: 3.9 }); }

  // ── 포인터 라우팅: 캐릭터 이동 / 표지·책장 드래그 / 시점 회전
  _pointer() {
    const el = this.canvas, ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(PT + 0.001)), hit = new THREE.Vector3();
    let g = null; // 진행 중 제스처
    const setRay = (e) => { plane.constant = -this.floorY; const r = el.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, this.camera); };
    const floorX = () => { plane.constant = -this.floorY; return ray.ray.intersectPlane(plane, hit) ? hit.x : null; };
    const hitAny = (objs) => ray.intersectObjects(objs, true).length > 0;
    const pageObjs = (side) => [side === 'R' ? this.right.g : this.left.g, ...this.parts.map((p) => p.group)];

    const classify = (e) => {
      setRay(e);
      if (this.busy) return 'orbit';
      if (this.state === 'open') {
        const hc = ray.intersectObjects(this.charParts.filter((p) => !p.folded).map((p) => p.group), true);
        if (hc.length) { let o = hc[0].object; while (o && !this.charParts.some((p) => p.group === o)) o = o.parent; this._hitChar = this.charParts.find((p) => p.group === o); if (this._hitChar) return 'char'; }
      }
      if (this.state === 'open') {
        const hits = ray.intersectObjects(this.objParts.filter((p) => !p.folded).map((p) => p.group), true);
        if (hits.length) { let o = hits[0].object; while (o && !this.objParts.some((p) => p.group === o)) o = o.parent; this._hitObj = this.objParts.find((p) => p.group === o); if (this._hitObj) return 'obj'; }
      }
      if (this.state === 'closed') return !this.backShown && hitAny([this.pivot, this.right.g]) ? 'cover' : 'orbit';
      if (!hitAny([this.right.g, this.left.g, this.diorama])) return 'orbit';
      const x = floorX();
      if (x === null) return 'orbit';
      return x >= 0 ? 'pageR' : 'pageL';
    };

    el.addEventListener('pointerdown', (e) => {
      const kind = classify(e);
      g = { kind, sx: e.clientX, sy: e.clientY, started: false, x0: floorX(), t: performance.now(), vx: 0, lx: e.clientX, lt: performance.now(), yaw0: this.view.userYaw, pitch0: this.view.userPitch };
      el.setPointerCapture(e.pointerId);
      if (kind === 'char' || kind === 'obj') { g.started = true; g.obj = kind === 'char' ? this._hitChar : this._hitObj; el.style.cursor = 'grabbing'; }
    });

    el.addEventListener('pointermove', (e) => {
      if (!g) { // 호버 커서
        if (e.pointerType !== 'mouse') return;
        const k = classify(e);
        el.style.cursor = k === 'orbit' ? '' : 'grab';
        return;
      }
      const now = performance.now();
      g.vx = 0.7 * g.vx + 0.3 * ((e.clientX - g.lx) / Math.max(1, now - g.lt)); g.lx = e.clientX; g.lt = now;
      const dist = Math.hypot(e.clientX - g.sx, e.clientY - g.sy);
      if (!g.started) {
        if (dist < 6) return;
        g.started = true; el.style.cursor = g.kind === 'orbit' ? 'move' : 'grabbing';
        if (g.kind === 'cover') {
          if (this.nav.ready && !this.nav.ready(this.nav.index)) { this.emit('wait', this.nav.index); g.kind = 'none'; }
          else { this._beginCover('open'); g.p0 = 0; }
        }
        else if (g.kind === 'pageL' && this.nav.index === 0) { g.kind = 'close'; this._beginCover('close'); g.p0 = 1; }
        else if (g.kind === 'pageR' || g.kind === 'pageL') {
          if (!this._beginLeaf(g.kind === 'pageR' ? 1 : -1)) g.kind = 'none';
          else g.a0 = this.leafA;
        }
      }
      setRay(e);
      if (g.kind === 'orbit') {
        this.view.userYaw = clamp(g.yaw0 - (e.clientX - g.sx) * 0.005, -0.75, 0.75);
        this.view.userPitch = clamp(g.pitch0 + (e.clientY - g.sy) * 0.003, -0.35, 0.45);
      } else if (g.kind === 'char' && g.obj) {
        if (ray.ray.intersectPlane(plane, hit)) {
          const DW = this.DW || 1.8, i = g.obj.idx;
          const pl = { ...g.obj.place, x: clamp(hit.x / (DW * 0.46), -1, 1), d: clamp((hit.z + 0.42) / 0.98) };
          this.setPlacement(i, pl); this.emit('charMoved', i, pl);
        }
      } else if (g.kind === 'obj' && g.obj) {
        if (ray.ray.intersectPlane(plane, hit)) {
          const DW = this.DW || 1.8;
          const pl = { x: clamp(hit.x / (DW * 0.46), -1, 1), d: clamp((hit.z + 0.42) / 0.98) };
          this._placeObj(g.obj, pl); this.emit('objMoved', g.obj.idx, pl);
        }
      } else if (g.kind === 'cover' || g.kind === 'close' || g.kind === 'pageR' || g.kind === 'pageL') {
        const x = floorX(); if (x === null || g.x0 === null) return;
        const d = Math.acos(clamp(x - (g.kind.startsWith('page') ? GAP : 0), -1, 1)) - Math.acos(clamp(g.x0, -1, 1));
        if (g.kind === 'cover' || g.kind === 'close') this._coverP(clamp(g.p0 + d / Math.PI));
        else this._leafAngle(clamp(g.a0 + d, 0, Math.PI));
      }
    });

    const end = (e) => {
      if (!g) return;
      const k = g.kind, flick = g.vx; // px/ms (음수 = 왼쪽)
      el.style.cursor = '';
      if (!g.started) {
        // 탭: 표지 열기 / 페이지 가장자리 넘기기
        setRay(e); const x = floorX();
        if (k === 'cover') this.open();
        else if ((k === 'pageR' && x > 0.55) || (k === 'pageL' && x < -0.55 && this.nav.index > 0)) this.flip(k === 'pageR' ? 1 : -1);
      } else if (k === 'cover') this._endCover(this.openP > 0.45 || flick < -0.5);
      else if (k === 'close') this._endCover(this.openP < 0.55 || flick > 0.5);
      else if (k === 'pageR') this._endLeaf(this.leafA > Math.PI / 2 || flick < -0.5);
      else if (k === 'pageL') this._endLeaf(this.leafA < Math.PI / 2 || flick > 0.5);
      g = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.view.zoom = clamp(this.view.zoom * (1 + e.deltaY * 0.001), 0.65, 1.5); }, { passive: false });
  }

  /** 3D 기준점 → 무대 좌표(px) */
  anchor(name) {
    const v = new THREE.Vector3();
    if (name === 'cover') v.set(0.52, PT * 2 + 0.01, 0.05);
    else if (name === 'coverEdge') v.set(0.92, PT * 2, 0.15);
    else if (name === 'coverBottom') v.set(0.52, PT * 2, CD / 2 + 0.02);
    else if (name === 'pageR') v.set(0.88, PT, 0.3);
    else if (name === 'pageL') v.set(-0.88, PT, 0.3);
    else if (name === 'char' && this.charParts[0]) { const c = this.charParts[0]; c.group.getWorldPosition(v); v.y += 0.22 * c.group.scale.y; }
    else return null;
    if (name !== 'char') v.y -= COVER_T - this.dims.t; // 얇은 표지면 책 전체가 그만큼 낮음
    v.project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: (v.x + 1) / 2 * r.width, y: (1 - v.y) / 2 * r.height };
  }

  /** 배경 판을 화면 전체에 맞춤 (그림 비율 유지, 넘치는 쪽 잘림) */
  _fitBg() {
    if (!this.bgMesh) return;
    const d = 45, h = 2 * d * Math.tan((this.camera.fov * Math.PI) / 360), w = h * this.camera.aspect, ia = 1024 / 640;
    const s = Math.max(w / ia, h); this.bgMesh.scale.set(s * ia * 1.02, s * 1.02, 1);
  }
  _resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%'; this.canvas.style.height = '100%';
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this._fitBg();
    this.fit = Math.max(1, Math.pow(1.45 / this.camera.aspect, 0.72));
    this.vh = h * Math.min(2, window.devicePixelRatio || 1);
  }

  _tick() {
    this._frame(Math.min(0.1, this.clock.getDelta()));
  }

  // ── 녹화: 화면과 별개로 정해진 해상도·시간 간격으로 한 프레임씩 렌더 (프레임 누락 없음)
  /** W×H(+슈퍼샘플)로 렌더 시작, 실시간 루프 정지 */
  beginCapture(W, H, { stillCam = false } = {}) {
    this.capturing = true; this.stillCam = stillCam;
    this.renderer.setAnimationLoop(null);
    this.renderer.setPixelRatio(1); this.renderer.setSize(W, H, false);
    this.camera.aspect = W / H; this.camera.updateProjectionMatrix(); this._fitBg();
    this.fit = Math.max(1, Math.pow(1.45 / this.camera.aspect, 0.72));
    this.vh = H;
  }
  /** 책 시간을 dt만큼 진행하고 렌더 */
  step(dt) { this._frame(dt); }
  endCapture() {
    this.capturing = false; this.stillCam = false;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this._resize(); this.clock.getDelta();
    this.renderer.setAnimationLoop(() => this._tick());
  }

  _frame(dt) {
    this.time += dt;
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      if (this.time < tw.t0) continue;
      const p = Math.min(1, (this.time - tw.t0) / tw.dur);
      tw.fn(tw.ease(p));
      if (p >= 1) { this.tweens.splice(i, 1); tw.resolve(); }
    }
    const t = this.time;
    for (const p of this.parts) if (p.kind === 'layer' && !p.folded) p.group.rotation.x = Math.sin(t * 0.7 + p.i * 1.3) * 0.006;
    for (const o of this.objParts) if (!o.folded) { o.inner.rotation.z = Math.sin(t * 0.9 + o.phase) * 0.018; o.inner.rotation.x = Math.sin(t * 0.6 + o.phase) * 0.012; }
    for (const c of this.charParts) {
      if (c.folded) continue;
      const g = c.inner, u = t + c.phase;
      switch (this.motion) {
        case 'sway': g.rotation.z = Math.sin(u * 1.4) * 0.035; g.rotation.x = Math.sin(u * 0.9) * 0.025; break;
        case 'bounce': { const s = Math.abs(Math.sin(u * 3.2)); g.position.y = s * 0.06; g.scale.set(1 + (1 - s) * 0.04, 1 - (1 - s) * 0.05, 1); break; }
        case 'float': g.position.y = 0.035 + Math.sin(u * 1.3) * 0.03; g.rotation.z = Math.sin(u * 0.8) * 0.05; break;
        case 'spin': g.rotation.y = u * 1.1; break;
        default: break;
      }
    }
    this.ambience.update(t, this.vh);
    const v = this.view;
    const yaw = v.yaw + v.userYaw + (this.stillCam ? 0 : Math.sin(t * 0.25) * 0.025); // GIF 녹화 중엔 카메라 고정 → 변하지 않는 픽셀이 많아져 용량 감소
    const pitch = clamp(v.pitch + v.userPitch, 0.25, 1.4);
    const r = v.radius * v.zoom * this.fit;
    const tx = v.tx, ty = 0.36, tz = -0.02;
    this.camera.position.set(tx + Math.sin(yaw) * Math.cos(pitch) * r, ty + Math.sin(pitch) * r, tz + Math.cos(yaw) * Math.cos(pitch) * r);
    this.camera.lookAt(tx, ty, tz);
    this.renderer.render(this.scene, this.camera);
  }

  snapshot() {
    this.renderer.render(this.scene, this.camera);
    return new Promise((res) => this.canvas.toBlob(res, 'image/png'));
  }
}
