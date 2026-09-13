// CustomFace — PROSOPO rendered as a holographic dot-matrix face (VIKI style):
// ~30k glowing points sampled from the rigged head mesh, animated by the same
// facial shape keys (jawOpen/smile/frown/eyeSquint/eyeWide/…), blended on CPU
// every frame so expressions and lip-sync stay perfectly smooth.
//
// Lip-sync = live audio analysis (loudness → jaw) + word-level vowel shaping
// (oo → pucker, ee → wide) from the TTS word timings. Mouth is hard-shut
// whenever nothing is being spoken.
//
// All head motion targets are low-pass filtered — no snapping between idle /
// thinking / talking states.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

const MODEL_URL = "/assets/prosopo.glb";
const TARGET_POINTS = 70000;
// key light for baked point shading (head front = +Z in glTF space)
const LIGHT_DIR = { x: 0.15, y: 0.35, z: 0.93 };

export const EMOTIONS = {
  neutral:   { color: 0xbfe4ff, morphs: {} }, // ice-white hologram
  happy:     { color: 0x2bffc9, morphs: { smile: 0.7, eyeSquint: 0.25 } },
  laugh:     { color: 0xffd24a, morphs: { smile: 1.0, eyeSquint: 0.55 }, motion: "laugh" },
  sad:       { color: 0x3f6cff, morphs: { frown: 0.7, eyeSquint: 0.15 }, motion: "sad" },
  cry:       { color: 0x4a7cff, morphs: { frown: 1.0, eyeSquint: 0.5 }, motion: "cry" },
  angry:     { color: 0xff4a3c, morphs: { frown: 0.55, eyeSquint: 0.6 }, motion: "angry" },
  surprised: { color: 0xbef8ff, morphs: { eyeWide: 1.0 } },
  fear:      { color: 0xb48cff, morphs: { eyeWide: 0.8 }, motion: "tremble" },
  thinking:  { color: 0x7ad0ff, morphs: { eyeSquint: 0.2 }, motion: "think" },
};

const EXPR_MORPHS = ["smile", "frown", "eyeSquint", "eyeWide"];
const ROUND_V = /[ouwOUW]|oo|ow|au/;
const WIDE_V = /[eiEI]|ee|ea|ay/;

function dotTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(255,255,255,0)";
  g.fillRect(0, 0, 32, 32);
  const grad = g.createRadialGradient(16, 16, 2, 16, 16, 14);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.7)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

export class CustomFace {
  constructor(container) {
    this.container = container;
    this.clock = new THREE.Clock();
    this.state = "idle"; // idle | thinking | talking

    this.jaw = 0; this.pucker = 0; this.wide = 0;
    this.jawTarget = 0; this.puckerTarget = 0; this.wideTarget = 0;

    this.emotion = "neutral";
    this.emotionStart = 0;
    this.emotionColor = new THREE.Color(EMOTIONS.neutral.color);
    this.targetColor = new THREE.Color(EMOTIONS.neutral.color);
    this.expr = {}; this.exprTarget = {};

    // smoothed head motion
    this.mot = { rx: 0, ry: 0, py: 0 };

    this.analyser = null;
    this.audioCtx = null;
    this.fakeTalk = false;
    this.currentSpeech = null; // { words, wtimes, wdurations, startTime }
    this.pokeTime = -10;
    this.onPoke = null; // callback set by main.js

    this.influences = {}; // morph name -> value (applied to the point cloud)
  }

  async init(onprogress) {
    const w = this.container.clientWidth, h = this.container.clientHeight;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x02040a);
    this.scene.fog = new THREE.FogExp2(0x02040a, 0.07);
    this.camera = new THREE.PerspectiveCamera(28, w / h, 0.05, 40);

    this.rimLight = new THREE.DirectionalLight(0x00e5ff, 1.2);
    this.rimLight.position.set(-1.2, 0.4, -0.8);
    this.scene.add(this.rimLight);
    this.scene.add(new THREE.AmbientLight(0x223344, 0.6));

    this.buildGridRoom();

    const gltf = await new Promise((resolve, reject) => {
      new GLTFLoader().load(MODEL_URL, resolve, onprogress, reject);
    });

    this.headGroup = new THREE.Group();
    this.headGroup.add(gltf.scene);
    this.scene.add(this.headGroup);

    // find the rigged mesh
    let mesh = null;
    gltf.scene.traverse((n) => {
      if (n.isMesh && n.morphTargetDictionary && "jawOpen" in n.morphTargetDictionary) mesh = n;
    });
    this.mesh = mesh;

    const box = new THREE.Box3().setFromObject(gltf.scene);
    const center = box.getCenter(new THREE.Vector3());
    const height = box.max.y - box.min.y;
    gltf.scene.position.sub(center);

    this.buildPointCloud(mesh);
    mesh.visible = false; // solid head hidden; kept for click raycasting

    const faceY = height * 0.18;
    this.camera.position.set(0, faceY, height * 1.55);
    this.camera.lookAt(0, faceY * 0.8, 0);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.95, 0.8, 0.3);
    this.composer.addPass(this.bloom);

    this.raycaster = new THREE.Raycaster();
    this.renderer.domElement.addEventListener("pointerdown", (e) => this.handlePointer(e));

    window.addEventListener("resize", () => this.onResize());
    window.PROSOPO_FACE = this; // debug handle
    this.animate();
  }

  // Sample TARGET_POINTS points across the mesh SURFACE (area-weighted, with
  // barycentric interpolation of positions, normals and morph deltas), and
  // bake Lambert shading into each point so the face reads like the VIKI
  // hologram: bright lit planes, dark eye sockets, visible lips.
  buildPointCloud(mesh) {
    const geo = mesh.geometry;
    const pos = geo.attributes.position.array;
    const nor = geo.attributes.normal.array;
    const idx = geo.index ? geo.index.array : null;
    const triCount = idx ? idx.length / 3 : pos.length / 9;

    const morphNames = Object.keys(mesh.morphTargetDictionary);
    const morphSrc = morphNames.map(
      (n) => geo.morphAttributes.position[mesh.morphTargetDictionary[n]].array
    );

    // total surface area
    const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3();
    const vert = (t, k) => (idx ? idx[t * 3 + k] : t * 3 + k);
    let totalArea = 0;
    const areas = new Float32Array(triCount);
    for (let t = 0; t < triCount; t++) {
      const a = vert(t, 0) * 3, b = vert(t, 1) * 3, c = vert(t, 2) * 3;
      vA.fromArray(pos, a); vB.fromArray(pos, b); vC.fromArray(pos, c);
      ab.subVectors(vB, vA); ac.subVectors(vC, vA);
      areas[t] = ab.cross(ac).length() * 0.5;
      totalArea += areas[t];
    }

    // allocate
    const m = TARGET_POINTS;
    this.base = new Float32Array(m * 3);
    this.shade = new Float32Array(m);
    this.shimmer = new Float32Array(m);
    this.mouthSeam = new Float32Array(m);
    this.morphDeltas = {};
    for (const n of morphNames) this.morphDeltas[n] = new Float32Array(m * 3);

    const L = LIGHT_DIR;
    let p = 0, acc = 0;
    const perPoint = totalArea / m;
    for (let t = 0; t < triCount && p < m; t++) {
      acc += areas[t];
      let n = Math.floor(acc / perPoint);
      acc -= n * perPoint;
      for (; n > 0 && p < m; n--) {
        // random barycentric coords
        let u = Math.random(), v = Math.random();
        if (u + v > 1) { u = 1 - u; v = 1 - v; }
        const w = 1 - u - v;
        const a = vert(t, 0) * 3, b = vert(t, 1) * 3, c = vert(t, 2) * 3;
        const px = pos[a] * w + pos[b] * u + pos[c] * v;
        const py = pos[a + 1] * w + pos[b + 1] * u + pos[c + 1] * v;
        const pz = pos[a + 2] * w + pos[b + 2] * u + pos[c + 2] * v;
        this.base[p * 3] = px; this.base[p * 3 + 1] = py; this.base[p * 3 + 2] = pz;

        // interpolated normal → baked Lambert shade
        const nx = nor[a] * w + nor[b] * u + nor[c] * v;
        const ny = nor[a + 1] * w + nor[b + 1] * u + nor[c + 1] * v;
        const nz = nor[a + 2] * w + nor[b + 2] * u + nor[c + 2] * v;
        const nl = Math.hypot(nx, ny, nz) || 1;
        const lam = Math.max(0, (nx * L.x + ny * L.y + nz * L.z) / nl);
        this.shade[p] = 0.06 + 1.05 * Math.pow(lam, 1.35);

        this.shimmer[p] = 0.9 + Math.random() * 0.2;

        // mouth seam mask (glTF space mouth line ≈ (0, 0.15, 0.54))
        const dm = Math.hypot(px * 0.9, (py - 0.145) * 1.9, (pz - 0.54) * 1.2);
        this.mouthSeam[p] = Math.max(0, 1 - dm / 0.24);

        // morph deltas interpolated with the same barycentric weights
        for (let k = 0; k < morphNames.length; k++) {
          const src = morphSrc[k], dst = this.morphDeltas[morphNames[k]];
          dst[p * 3] = src[a] * w + src[b] * u + src[c] * v;
          dst[p * 3 + 1] = src[a + 1] * w + src[b + 1] * u + src[c + 1] * v;
          dst[p * 3 + 2] = src[a + 2] * w + src[b + 2] * u + src[c + 2] * v;
        }
        p++;
      }
    }
    this.count = p;

    const pgeo = new THREE.BufferGeometry();
    this.livePos = new Float32Array(this.base);
    pgeo.setAttribute("position", new THREE.BufferAttribute(this.livePos, 3));
    const colors = new Float32Array(m * 3);
    this.colorsAttr = new THREE.BufferAttribute(colors, 3);
    pgeo.setAttribute("color", this.colorsAttr);

    const mat = new THREE.PointsMaterial({
      size: 0.016,
      map: dotTexture(),
      vertexColors: true,
      alphaTest: 0.05,       // depth-occluded dots (0.45 discards everything — Points alpha is subtle)
      depthWrite: true,
      sizeAttenuation: true,
    });
    this.pointsMat = mat;

    this.points = new THREE.Points(pgeo, mat);
    this.points.position.copy(mesh.position);
    this.points.quaternion.copy(mesh.quaternion);
    this.points.scale.copy(mesh.scale);
    mesh.parent.add(this.points);

    this.refreshColors();
  }

  // brightness = baked shade × subtle shimmer × mouth-opening darkness
  refreshColors() {
    const c = this.colorsAttr.array;
    // re-roll a small subset of shimmer values → gentle digital sparkle
    const rerolls = (this.count * 0.01) | 0;
    for (let k = 0; k < rerolls; k++) {
      const i = (Math.random() * this.count) | 0;
      this.shimmer[i] = 0.9 + Math.random() * 0.2;
    }
    const jawDark = Math.min(1, this.jaw * 1.6);
    for (let i = 0; i < this.count; i++) {
      const b = this.shade[i] * this.shimmer[i] * (1 - this.mouthSeam[i] * jawDark * 0.95);
      c[i * 3] = b; c[i * 3 + 1] = b; c[i * 3 + 2] = b;
    }
    this.colorsAttr.needsUpdate = true;
  }

  buildGridRoom() {
    const room = new THREE.Group();
    const S = 6, DIV = 26;
    const mk = (op) => {
      const g = new THREE.GridHelper(S, DIV, 0x36f2ff, 0x0d5a78);
      g.material.transparent = true;
      g.material.opacity = op;
      g.material.depthWrite = false;
      return g;
    };
    const floor = mk(0.85); floor.position.y = -1.55; room.add(floor);
    const ceil = mk(0.5); ceil.position.y = 2.4; room.add(ceil);
    const back = mk(0.8); back.rotation.x = Math.PI / 2; back.position.set(0, 0.4, -1.8); room.add(back);
    const left = mk(0.6); left.rotation.z = Math.PI / 2; left.position.set(-S / 2, 0.4, 0); room.add(left);
    const right = mk(0.6); right.rotation.z = Math.PI / 2; right.position.set(S / 2, 0.4, 0); room.add(right);
    this.gridRoom = room;
    this.scene.add(room);
  }

  handlePointer(e) {
    if (!this.mesh) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const p = new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1
    );
    this.raycaster.setFromCamera(p, this.camera);
    const hit = this.raycaster.intersectObject(this.mesh, false);
    if (hit.length) {
      this.pokeTime = this.clock.getElapsedTime();
      this.onPoke?.();
    }
  }

  onResize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  setEmotion(name) {
    if (!EMOTIONS[name]) name = "neutral";
    this.emotion = name;
    this.emotionStart = this.clock.getElapsedTime();
    this.targetColor.setHex(EMOTIONS[name].color);
    this.exprTarget = { smile: 0, frown: 0, eyeSquint: 0, eyeWide: 0, ...EMOTIONS[name].morphs };
  }

  // vowel-shaped mouth bias for the word being spoken right now
  currentWordBias() {
    const sp = this.currentSpeech;
    if (!sp || !this.audioCtx) return null;
    const tMs = (this.audioCtx.currentTime - sp.startTime) * 1000;
    for (let i = 0; i < sp.words.length; i++) {
      if (tMs >= sp.wtimes[i] && tMs <= sp.wtimes[i] + sp.wdurations[i] + 40) {
        const w = sp.words[i].toLowerCase();
        return { round: ROUND_V.test(w), wide: WIDE_V.test(w) };
      }
    }
    return null;
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    const t = this.clock.getElapsedTime();
    const dt = Math.min(this.clock.getDelta() + 0.016, 0.05);
    const emo = EMOTIONS[this.emotion] || EMOTIONS.neutral;
    const age = t - this.emotionStart;
    const strength = this.emotion === "neutral" ? 1 : Math.max(0.35, 1 - age / 12);

    // ---- lip sync (mouth stays SHUT unless actually speaking) ----
    if (this.analyser) {
      const data = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const level = sum / (data.length * 255);
      this.jawTarget = Math.min(1, level * 3.6);
      const bias = this.currentWordBias();
      if (bias && level > 0.03) {
        this.puckerTarget = bias.round ? 0.55 : 0;
        this.wideTarget = bias.wide && !bias.round ? 0.5 : 0;
      } else { this.puckerTarget = 0; this.wideTarget = 0; }
    } else if (this.fakeTalk) {
      this.jawTarget = 0.25 + 0.5 * Math.abs(Math.sin(t * 9) * Math.sin(t * 5.3));
      this.puckerTarget = 0; this.wideTarget = 0;
    } else {
      this.jawTarget = 0; this.puckerTarget = 0; this.wideTarget = 0;
    }

    const kUp = 1 - Math.exp(-dt * 34), kDown = 1 - Math.exp(-dt * 15);
    this.jaw += (this.jawTarget - this.jaw) * (this.jawTarget > this.jaw ? kUp : kDown);
    this.pucker += (this.puckerTarget - this.pucker) * kDown;
    this.wide += (this.wideTarget - this.wide) * kDown;
    if (this.state !== "talking" && this.jaw < 0.02) { this.jaw = 0; this.pucker = 0; this.wide = 0; }

    // ---- expressions (never open the mouth while idle) ----
    const kE = 1 - Math.exp(-dt * 6);
    const poke = Math.max(0, 1 - (t - this.pokeTime) / 1.1);
    for (const name of EXPR_MORPHS) {
      let target = (this.exprTarget[name] || 0) * strength;
      if (name === "eyeWide") target = Math.max(target, poke * 0.9); // eyebrow-raise on poke
      if (name === "eyeSquint" && poke > 0) target *= 0.2;
      this.expr[name] = (this.expr[name] || 0) + (target - (this.expr[name] || 0)) * kE;
      this.influences[name] = this.expr[name];
    }
    this.influences.jawOpen = this.jaw;
    this.influences.mouthPucker = this.pucker;
    this.influences.mouthWide = this.wide;

    // ---- blend point positions on CPU ----
    if (this.livePos) {
      this.livePos.set(this.base);
      for (const [name, v] of Object.entries(this.influences)) {
        if (Math.abs(v) < 0.004) continue;
        const d = this.morphDeltas[name];
        if (!d) continue;
        for (let i = 0; i < this.livePos.length; i++) this.livePos[i] += d[i] * v;
      }
      this.points.geometry.attributes.position.needsUpdate = true;
      this.refreshColors(); // baked shading + shimmer + dark mouth opening
    }

    // ---- head motion: compute targets, then low-pass (no snapping) ----
    let rx = Math.sin(t * 0.23) * 0.014;
    let ry = Math.sin(t * 0.35) * 0.035;
    let py = Math.sin(t * 0.8) * 0.004;
    const motion = this.state === "thinking" ? "think" : emo.motion;
    switch (motion) {
      case "laugh": py += Math.abs(Math.sin(t * 11)) * 0.014 * strength; rx += Math.sin(t * 11) * 0.015 * strength; break;
      case "sad": rx += 0.09 * strength; ry *= 0.4; break;
      case "cry": rx += 0.14 * strength; ry += Math.sin(t * 18) * 0.003 * strength; break;
      case "angry": rx -= 0.04 * strength; ry += Math.sin(t * 2.4) * 0.025 * strength; break;
      case "tremble": ry += Math.sin(t * 24) * 0.005 * strength; break;
      case "think": ry += Math.sin(t * 1.1) * 0.04 + 0.05; rx += 0.03; break;
    }
    rx -= poke * 0.07; // lean back when poked

    const kM = 1 - Math.exp(-dt * 3.2);
    this.mot.rx += (rx - this.mot.rx) * kM;
    this.mot.ry += (ry - this.mot.ry) * kM;
    this.mot.py += (py - this.mot.py) * kM;
    if (this.headGroup) {
      this.headGroup.rotation.x = this.mot.rx;
      this.headGroup.rotation.y = this.mot.ry;
      this.headGroup.position.y = this.mot.py;
    }

    // ---- colour: points + rim + grid follow emotion ----
    this.emotionColor.lerp(this.targetColor, 1 - Math.exp(-dt * 3));
    const flash = poke > 0 ? 1 + poke * 0.5 : 1;
    this.pointsMat.color.copy(this.emotionColor).multiplyScalar(flash);
    this.pointsMat.opacity = 0.85 + Math.sin(t * 2.2) * 0.08 +
      (this.state === "thinking" ? Math.sin(t * 7) * 0.06 : 0);
    this.rimLight.color.copy(this.emotionColor);
    if (this.gridRoom) {
      for (const g of this.gridRoom.children) g.material.color.lerp(this.emotionColor, 0.02);
    }

    if (this.composer) this.composer.render();
  }

  ensureAudioCtx(ctx) {
    this.audioCtx = ctx || this.audioCtx ||
      new (window.AudioContext || window.webkitAudioContext)();
    return this.audioCtx;
  }

  async speakAudio(speech, audioCtx) {
    const ctx = this.ensureAudioCtx(audioCtx);
    if (ctx.state === "suspended") await ctx.resume();
    return new Promise((resolve) => {
      const src = ctx.createBufferSource();
      src.buffer = speech.audio;
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.35;
      src.connect(this.analyser);
      this.analyser.connect(ctx.destination);
      this.state = "talking";
      this.currentSpeech = { ...speech, startTime: ctx.currentTime };
      src.onended = () => {
        this.analyser = null;
        this.currentSpeech = null;
        this.state = "idle";
        this.jawTarget = 0; this.puckerTarget = 0; this.wideTarget = 0;
        resolve();
      };
      src.start();
    });
  }

  startFakeTalk() { this.fakeTalk = true; this.state = "talking"; }
  stopFakeTalk() { this.fakeTalk = false; this.state = "idle"; }
  startThinking() { this.state = "thinking"; }
  stopThinking() { if (this.state === "thinking") this.state = "idle"; }
  setMood(mood) { this.setEmotion(mood); }
  moodFromText() { return "neutral"; }
}
