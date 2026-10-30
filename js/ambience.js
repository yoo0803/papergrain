// 분위기 입자: dust / fireflies / petals / snow (단일 셰이더)
import * as THREE from '../vendor/three.module.min.js';

const MODES = { dust: 0, fireflies: 1, petals: 2, snow: 3 };
const N = 180;

const vert = /* glsl */`
  uniform float uTime, uScale, uMode;
  attribute vec4 aSeed;
  varying float vAlpha, vAngle;
  varying vec3 vColor;
  uniform vec3 uColA, uColB;
  void main() {
    vec3 p = position;
    float t = uTime, s = aSeed.x, ph = aSeed.y * 6.2831;
    float H = 2.0;
    vAlpha = 1.0; vAngle = 0.0;
    if (uMode < 0.5) {                       // 먼지: 천천히 상승
      p.y = mod(p.y + t * (0.03 + 0.05 * s), H);
      p.x += sin(t * 0.4 + ph) * 0.05;
      vAlpha = 0.35 + 0.5 * s;
    } else if (uMode < 1.5) {                // 반딧불: 배회 + 깜빡임
      p.y = 0.15 + p.y * 0.55;
      p += vec3(sin(t * (0.3 + s * 0.4) + ph), sin(t * (0.5 + s * 0.3) + ph * 1.7) * 0.6, cos(t * (0.35 + s * 0.3) + ph)) * 0.16;
      vAlpha = smoothstep(-0.2, 1.0, sin(t * (1.2 + s * 1.6) + ph));
    } else if (uMode < 2.5) {                // 꽃잎: 낙하 + 흔들림 + 회전
      p.y = H - mod(t * (0.12 + 0.1 * s) + aSeed.z * H, H);
      p.x += sin(t * 0.9 + ph) * 0.18;
      p.z += cos(t * 0.6 + ph) * 0.08;
      vAngle = t * (1.0 + s * 2.0) + ph;
      vAlpha = smoothstep(0.0, 0.15, p.y) * 0.95;
    } else {                                 // 눈: 느린 낙하
      p.y = H - mod(t * (0.06 + 0.06 * s) + aSeed.z * H, H);
      p.x += sin(t * 0.5 + ph) * 0.07;
      vAlpha = smoothstep(0.0, 0.12, p.y) * (0.6 + 0.4 * s);
    }
    vColor = mix(uColA, uColB, aSeed.w);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float size = uMode > 1.5 && uMode < 2.5 ? 0.05 : (uMode > 2.5 ? 0.03 : (uMode > 0.5 ? 0.045 : 0.022));
    gl_PointSize = size * (0.6 + aSeed.z * 0.8) * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;

const frag = /* glsl */`
  uniform float uMode, uOpacity;
  varying float vAlpha, vAngle;
  varying vec3 vColor;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float a;
    if (uMode > 1.5 && uMode < 2.5) {        // 꽃잎 모양
      float c = cos(vAngle), s = sin(vAngle);
      vec2 q = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);
      q.x *= 1.9;
      float d = length(q) + 0.18 * abs(q.y) / (0.2 + abs(q.x));
      a = smoothstep(0.42, 0.34, d);
    } else {
      float d = length(uv);
      a = smoothstep(0.5, 0.0, d);
      a = uMode > 0.5 && uMode < 1.5 ? pow(a, 1.6) : a;
    }
    gl_FragColor = vec4(vColor, a * vAlpha * uOpacity);
    if (gl_FragColor.a < 0.01) discard;
    #include <colorspace_fragment>
  }`;

// 효과 고유색 (조명·테마 색에 물들지 않음). 라이트 모드는 밝은 배경에서 보이도록 조금 진하게
const PALETTE = {
  dark: { dust: ['#fff4e2', '#e9e4ff'], fireflies: ['#fff59a', '#c6ff8a'], petals: ['#ffc2d4', '#ffe4ec'], snow: ['#ffffff', '#e4ecff'] },
  light: { dust: ['#b8a789', '#a8a29a'], fireflies: ['#b9c400', '#7fb52e'], petals: ['#f08aac', '#f5adc4'], snow: ['#c9d7ea', '#b6c7de'] },
};

export class Ambience {
  constructor(scene) {
    const pos = new Float32Array(N * 3), seed = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 2.4; pos[i * 3 + 1] = Math.random() * 2; pos[i * 3 + 2] = (Math.random() - 0.5) * 1.5;
      seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uScale: { value: 600 }, uMode: { value: 0 }, uOpacity: { value: 1 }, uColA: { value: new THREE.Color() }, uColB: { value: new THREE.Color() } },
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.theme = 'light'; this.mode = 'dust';
    this.set('dust');
  }
  set(mode) {
    this.mode = mode;
    this.points.visible = mode in MODES;
    if (!this.points.visible) return;
    this.mat.uniforms.uMode.value = MODES[mode];
    const [a, b] = PALETTE[this.theme][mode];
    this.mat.uniforms.uColA.value.set(a); this.mat.uniforms.uColB.value.set(b);
    const additive = this.theme === 'dark' && (mode === 'dust' || mode === 'fireflies');
    this.mat.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.mat.uniforms.uOpacity.value = this.theme === 'light' ? ({ dust: 0.5, fireflies: 0.75 }[mode] ?? 0.9) : 0.9;
    this.mat.needsUpdate = true;
  }
  setTheme(theme) { this.theme = theme; this.set(this.mode); }
  update(t, viewportH) { this.mat.uniforms.uTime.value = t; this.mat.uniforms.uScale.value = viewportH * 0.9; }
}
