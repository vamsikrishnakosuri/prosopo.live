// CustomFace — renders the PROSOPO android head (assets/prosopo.glb) and
// lip-syncs it by analysing the speech audio in real time:
//   volume  -> jawOpen
//   spectral centroid -> mouthPucker (low/oo) vs mouthWide (high/ee)
// Also gives the head idle life: micro head motion, breathing, circuit pulse.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

const MODEL_URL = "/assets/prosopo.glb";

export class CustomFace {
  constructor(container) {
    this.container = container;
    this.morphMeshes = [];
    this.emissiveMats = [];
    this.clock = new THREE.Clock();
    this.state = "idle"; // idle | thinking | talking
    this.jaw = 0; this.pucker = 0; this.wide = 0;
    this.jawTarget = 0; this.puckerTarget = 0; this.wideTarget = 0;
    this.moodWide = 0; this.moodJaw = 0;
    this.analyser = null;
    this.audioCtx = null;
    this.fakeTalk = false;
  }

  async init(onprogress) {
    const w = this.container.clientWidth, h = this.container.clientHeight;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, w / h, 0.05, 20);

    // Lights: cool key, cyan rim, soft fill
    this.scene.add(new THREE.AmbientLight(0x8899aa, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(0.6, 1.2, 1.4);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x00e5ff, 2.6);
    rim.position.set(-1.2, 0.4, -0.8);
    this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0x3355ff, 0.7);
    fill.position.set(-0.8, -0.3, 1.0);
    this.scene.add(fill);

    // Load model
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

    // Frame the face: model is a bust ~1.9 units tall, face in upper half
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const center = box.getCenter(new THREE.Vector3());
    const height = box.max.y - box.min.y;
    gltf.scene.position.sub(center); // center at origin
    const faceY = height * 0.18;     // eyes/mouth zone above center
    this.camera.position.set(0, faceY, height * 1.55);
    this.camera.lookAt(0, faceY * 0.8, 0);

    // Bloom for the circuit glow
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.65, 0.7, 0.55);
    this.composer.addPass(this.bloom);

    window.addEventListener("resize", () => this.onResize());
    this.animate();
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

  animate() {
    requestAnimationFrame(() => this.animate());
    const t = this.clock.getElapsedTime();
    const dt = Math.min(this.clock.getDelta() + 0.016, 0.05);

    // --- lip sync targets ---
    if (this.analyser) {
      const data = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.getByteFrequencyData(data);
      let sum = 0, weighted = 0;
      for (let i = 0; i < data.length; i++) { sum += data[i]; weighted += data[i] * i; }
      const level = sum / (data.length * 255);            // 0..1 loudness
      const centroid = sum > 0 ? weighted / sum / data.length : 0; // 0..1 brightness
      this.jawTarget = Math.min(1, level * 3.4);
      this.puckerTarget = Math.max(0, (0.30 - centroid)) * 2.2 * (level > 0.03 ? 1 : 0);
      this.wideTarget = Math.max(0, (centroid - 0.34)) * 2.6 * (level > 0.03 ? 1 : 0);
    } else if (this.fakeTalk) {
      this.jawTarget = 0.25 + 0.55 * Math.abs(Math.sin(t * 9) * Math.sin(t * 5.3));
      this.wideTarget = 0.15 * Math.abs(Math.sin(t * 3.1));
      this.puckerTarget = 0;
    } else {
      this.jawTarget = this.moodJaw;
      this.puckerTarget = 0;
      this.wideTarget = this.moodWide;
    }

    // smooth
    const k = 1 - Math.exp(-dt * 18);
    this.jaw += (this.jawTarget - this.jaw) * k;
    this.pucker += (this.puckerTarget - this.pucker) * k * 0.6;
    this.wide += (this.wideTarget - this.wide) * k * 0.6;
    this.setMorph("jawOpen", this.jaw);
    this.setMorph("mouthPucker", this.pucker);
    this.setMorph("mouthWide", this.wide + this.moodWide * 0.5);

    // --- idle life ---
    if (this.headGroup) {
      const think = this.state === "thinking" ? 1 : 0;
      this.headGroup.rotation.y = Math.sin(t * 0.35) * 0.06 + think * Math.sin(t * 1.1) * 0.05;
      this.headGroup.rotation.x = Math.sin(t * 0.23) * 0.025 + think * 0.04;
      this.headGroup.position.y = Math.sin(t * 0.8) * 0.006; // breathing
    }
    const pulse = 1.6 + Math.sin(t * 2.2) * 0.35 +
      (this.state === "talking" ? this.jaw * 1.2 : 0) +
      (this.state === "thinking" ? 0.9 + Math.sin(t * 7) * 0.5 : 0);
    for (const m of this.emissiveMats) m.emissiveIntensity = pulse;

    if (this.composer) this.composer.render();
  }

  ensureAudioCtx(ctx) {
    this.audioCtx = ctx || this.audioCtx ||
      new (window.AudioContext || window.webkitAudioContext)();
    return this.audioCtx;
  }

  // Play an AudioBuffer and lip-sync to it. Resolves when playback ends.
  async speakAudio(speech, audioCtx) {
    const ctx = this.ensureAudioCtx(audioCtx);
    if (ctx.state === "suspended") await ctx.resume();
    return new Promise((resolve) => {
      const src = ctx.createBufferSource();
      src.buffer = speech.audio;
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.5;
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

  // For Web Speech fallback (no audio stream available)
  startFakeTalk() { this.fakeTalk = true; this.state = "talking"; }
  stopFakeTalk() { this.fakeTalk = false; this.state = "idle"; }

  startThinking() { this.state = "thinking"; }
  stopThinking() { if (this.state === "thinking") this.state = "idle"; }

  setMood(mood) {
    this.moodWide = mood === "happy" ? 0.35 : 0;
    this.moodJaw = mood === "surprise" ? 0.18 : 0;
  }

  moodFromText(text) {
    const t = text.toLowerCase();
    if (/\b(sorry|sad|unfortunate|regret)\b/.test(t)) return "sad";
    if (/\b(great|awesome|happy|glad|love|amazing|haha)\b/.test(t)) return "happy";
    if (/\b(wow|incredible|surprising)\b/.test(t)) return "surprise";
    return "neutral";
  }
}
