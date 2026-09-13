// CustomFace — renders the PROSOPO android head (assets/prosopo.glb).
//
// Lip-sync: the speech audio is analysed live — loudness drives jawOpen,
// spectral brightness picks mouthPucker ("oo") vs mouthWide ("ee"), and a
// fast-attack/slow-release envelope makes consonant closures feel natural.
//
// Emotions: presets combine face shape keys (smile/frown/eyeSquint/eyeWide),
// circuit glow colour, and head-motion patterns (laugh bounce, cry tremble…).
//
// Scene: the head floats in a glowing sci-fi grid room with fog + bloom.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

const MODEL_URL = "/assets/prosopo.glb";

export const EMOTIONS = {
  neutral:   { color: 0x00e5ff, morphs: {} },
  happy:     { color: 0x2bffc9, morphs: { smile: 0.7, eyeSquint: 0.25 } },
  laugh:     { color: 0xffd24a, morphs: { smile: 1.0, eyeSquint: 0.55, jawOpen: 0.22 }, motion: "laugh" },
  sad:       { color: 0x3f6cff, morphs: { frown: 0.7, eyeSquint: 0.15 }, motion: "sad" },
  cry:       { color: 0x4a7cff, morphs: { frown: 1.0, eyeSquint: 0.5 }, motion: "cry" },
  angry:     { color: 0xff4a3c, morphs: { frown: 0.55, eyeSquint: 0.6 }, motion: "angry" },
  surprised: { color: 0xbef8ff, morphs: { eyeWide: 1.0, jawOpen: 0.3 } },
  fear:      { color: 0xb48cff, morphs: { eyeWide: 0.8, mouthPucker: 0.2 }, motion: "tremble" },
  thinking:  { color: 0x7ad0ff, morphs: { eyeSquint: 0.2 }, motion: "think" },
};

const LIP_MORPHS = new Set(["jawOpen", "mouthPucker", "mouthWide"]);

export class CustomFace {
  constructor(container) {
    this.container = container;
    this.morphMeshes = [];
    this.emissiveMats = [];
    this.clock = new THREE.Clock();
    this.state = "idle"; // idle | thinking | talking

    // live lip-sync values
    this.jaw = 0; this.pucker = 0; this.wide = 0;
    this.jawTarget = 0; this.puckerTarget = 0; this.wideTarget = 0;

    // emotion state
    this.emotion = "neutral";
    this.emotionStart = 0;
    this.emotionColor = new THREE.Color(EMOTIONS.neutral.color);
    this.targetColor = new THREE.Color(EMOTIONS.neutral.color);
    this.expr = {};        // current expression morph values
    this.exprTarget = {};  // target expression morph values

    this.analyser = null;
    this.audioCtx = null;
    this.fakeTalk = false;
  }

  async init(onprogress) {
    const w = this.container.clientWidth, h = this.container.clientHeight;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x02040a);
    this.scene.fog = new THREE.FogExp2(0x02040a, 0.07);
    this.camera = new THREE.PerspectiveCamera(28, w / h, 0.05, 40);

    // Lights
    this.scene.add(new THREE.AmbientLight(0x8899aa, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(0.6, 1.2, 1.4);
    this.scene.add(key);
    this.rimLight = new THREE.DirectionalLight(0x00e5ff, 2.6);
    this.rimLight.position.set(-1.2, 0.4, -0.8);
    this.scene.add(this.rimLight);
    const fill = new THREE.DirectionalLight(0x3355ff, 0.7);
    fill.position.set(-0.8, -0.3, 1.0);
    this.scene.add(fill);

    this.buildGridRoom();

    const gltf = await new Promise((resolve, reject) => {
      new GLTFLoader().load(MODEL_URL, resolve, onprogress, reject);
    });

    this.headGroup = new THREE.Group();
    this.headGroup.add(gltf.scene);
    this.scene.add(this.headGroup);

    gltf.scene.traverse((node) => {
      if (node.isMesh) {
        if (node.morphTargetDictionary && "jawOpen" in node.morphTargetDictionary) {
          this.morphMeshes.push(node);
        }
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        for (const m of mats) {
          if (m && m.emissive) {
            m.emissiveIntensity = 1.6;
            this.emissiveMats.push(m);
          }
        }
      }
    });

    const box = new THREE.Box3().setFromObject(gltf.scene);
    const center = box.getCenter(new THREE.Vector3());
    const height = box.max.y - box.min.y;
    gltf.scene.position.sub(center);
    const faceY = height * 0.18;
    this.camera.position.set(0, faceY, height * 1.55);
    this.camera.lookAt(0, faceY * 0.8, 0);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.65, 0.7, 0.5);
    this.composer.addPass(this.bloom);

    window.addEventListener("resize", () => this.onResize());
    this.animate();
  }

  // Glowing wireframe room, like a holo-chamber
  buildGridRoom() {
    const room = new THREE.Group();
    const S = 6, DIV = 26;
    const mkGrid = (c1, c2, opacity) => {
      const g = new THREE.GridHelper(S, DIV, c1, c2);
      g.material.transparent = true;
      g.material.opacity = opacity;
      g.material.depthWrite = false;
      return g;
    };
    const floor = mkGrid(0x36f2ff, 0x0d5a78, 0.85);
    floor.position.y = -1.55;
    room.add(floor);

    const ceiling = mkGrid(0x36f2ff, 0x0d5a78, 0.5);
    ceiling.position.y = 2.4;
    room.add(ceiling);

    const back = mkGrid(0x36f2ff, 0x0d5a78, 0.8);
    back.rotation.x = Math.PI / 2;
    back.position.set(0, 0.4, -S / 2 + 1.2);
    room.add(back);

    const left = mkGrid(0x36f2ff, 0x0d5a78, 0.6);
    left.rotation.z = Math.PI / 2;
    left.position.set(-S / 2, 0.4, 0);
    room.add(left);

    const right = mkGrid(0x36f2ff, 0x0d5a78, 0.6);
    right.rotation.z = Math.PI / 2;
    right.position.set(S / 2, 0.4, 0);
    room.add(right);

    this.gridRoom = room;
    this.scene.add(room);
  }

  onResize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  setMorph(name, value) {
    for (const mesh of this.morphMeshes) {
      const idx = mesh.morphTargetDictionary[name];
      if (idx !== undefined) mesh.morphTargetInfluences[idx] = value;
    }
  }

  setEmotion(name) {
    if (!EMOTIONS[name]) name = "neutral";
    this.emotion = name;
    this.emotionStart = this.clock.getElapsedTime();
    this.targetColor.setHex(EMOTIONS[name].color);
    this.exprTarget = { smile: 0, frown: 0, eyeSquint: 0, eyeWide: 0, ...EMOTIONS[name].morphs };
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    const t = this.clock.getElapsedTime();
    const dt = Math.min(this.clock.getDelta() + 0.016, 0.05);
    const emo = EMOTIONS[this.emotion] || EMOTIONS.neutral;
    // Emotions soften after a while instead of freezing on the face
    const age = t - this.emotionStart;
    const strength = this.emotion === "neutral" ? 1 : Math.max(0.35, 1 - age / 12);

    // --- lip sync ---
    if (this.analyser) {
      const data = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.getByteFrequencyData(data);
      let sum = 0, weighted = 0;
      for (let i = 0; i < data.length; i++) { sum += data[i]; weighted += data[i] * i; }
      const level = sum / (data.length * 255);
      const centroid = sum > 0 ? weighted / sum / data.length : 0;
      this.jawTarget = Math.min(1, level * 3.4);
      this.puckerTarget = Math.max(0, (0.30 - centroid)) * 2.2 * (level > 0.03 ? 1 : 0);
      this.wideTarget = Math.max(0, (centroid - 0.34)) * 2.6 * (level > 0.03 ? 1 : 0);
    } else if (this.fakeTalk) {
      this.jawTarget = 0.25 + 0.55 * Math.abs(Math.sin(t * 9) * Math.sin(t * 5.3));
      this.wideTarget = 0.15 * Math.abs(Math.sin(t * 3.1));
      this.puckerTarget = 0;
    } else {
      this.jawTarget = 0; this.puckerTarget = 0; this.wideTarget = 0;
    }

    // fast attack, slower release => crisp consonants, natural decay
    const kUp = 1 - Math.exp(-dt * 32), kDown = 1 - Math.exp(-dt * 13);
    this.jaw += (this.jawTarget - this.jaw) * (this.jawTarget > this.jaw ? kUp : kDown);
    this.pucker += (this.puckerTarget - this.pucker) * kDown;
    this.wide += (this.wideTarget - this.wide) * kDown;

    // --- expression morphs blend with lip morphs ---
    const kE = 1 - Math.exp(-dt * 6);
    for (const name of ["smile", "frown", "eyeSquint", "eyeWide", "jawOpen", "mouthPucker", "mouthWide"]) {
      const emoVal = (this.exprTarget[name] || 0) * strength;
      if (LIP_MORPHS.has(name)) {
        const lip = name === "jawOpen" ? this.jaw : name === "mouthPucker" ? this.pucker : this.wide;
        this.setMorph(name, Math.min(1, lip + emoVal * (this.state === "talking" ? 0.3 : 1)));
      } else {
        this.expr[name] = (this.expr[name] || 0) + (emoVal - (this.expr[name] || 0)) * kE;
        this.setMorph(name, this.expr[name]);
      }
    }

    // --- head motion ---
    if (this.headGroup) {
      let rx = Math.sin(t * 0.23) * 0.025;
      let ry = Math.sin(t * 0.35) * 0.06;
      let py = Math.sin(t * 0.8) * 0.006;
      const motion = this.state === "thinking" ? "think" : emo.motion;
      switch (motion) {
        case "laugh":
          py += Math.abs(Math.sin(t * 11)) * 0.018 * strength;
          rx += Math.sin(t * 11) * 0.02 * strength;
          break;
        case "sad":
          rx += 0.10 * strength;
          ry *= 0.4;
          break;
        case "cry":
          rx += 0.16 * strength;
          ry += Math.sin(t * 18) * 0.004 * strength;
          py += Math.sin(t * 14) * 0.003 * strength;
          break;
        case "angry":
          rx -= 0.05 * strength;
          ry += Math.sin(t * 2.4) * 0.03 * strength;
          break;
        case "tremble":
          ry += Math.sin(t * 24) * 0.006 * strength;
          rx += Math.cos(t * 21) * 0.004 * strength;
          break;
        case "think":
          ry += Math.sin(t * 1.1) * 0.05 + 0.06;
          rx += 0.04;
          break;
      }
      this.headGroup.rotation.x = rx;
      this.headGroup.rotation.y = ry;
      this.headGroup.position.y = py;
    }

    // --- circuit glow: colour + pulse ---
    this.emotionColor.lerp(this.targetColor, 1 - Math.exp(-dt * 3));
    const basePulse = this.emotion === "sad" || this.emotion === "cry" ? 1.1 : 1.6;
    const pulse = basePulse + Math.sin(t * 2.2) * 0.35 +
      (this.state === "talking" ? this.jaw * 1.2 : 0) +
      (this.state === "thinking" ? 0.9 + Math.sin(t * 7) * 0.5 : 0) +
      (this.emotion === "angry" ? Math.abs(Math.sin(t * 6)) * 0.8 : 0);
    for (const m of this.emissiveMats) {
      m.emissive.copy(this.emotionColor);
      m.emissiveIntensity = pulse;
    }
    if (this.rimLight) this.rimLight.color.copy(this.emotionColor);
    if (this.gridRoom) {
      for (const g of this.gridRoom.children) {
        g.material.color.lerp(this.emotionColor, 0.02);
      }
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
      this.analyser.smoothingTimeConstant = 0.4;
      src.connect(this.analyser);
      this.analyser.connect(ctx.destination);
      this.state = "talking";
      src.onended = () => {
        this.analyser = null;
        this.state = "idle";
        resolve();
      };
      src.start();
    });
  }

  startFakeTalk() { this.fakeTalk = true; this.state = "talking"; }
  stopFakeTalk() { this.fakeTalk = false; this.state = "idle"; }
  startThinking() { this.state = "thinking"; }
  stopThinking() { if (this.state === "thinking") this.state = "idle"; }

  // kept for API compatibility; prefer setEmotion()
  setMood(mood) { this.setEmotion(mood); }
  moodFromText() { return "neutral"; }
}
