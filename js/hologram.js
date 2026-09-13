// HologramFace — PROSOPO v3.
//
// The face is a professionally-rigged female avatar (real eyeballs with
// irises, eyebrows, teeth, tongue, full ARKit + Oculus viseme rig) animated
// by the TalkingHead engine: film-grade lip-sync, blinking, eye saccades,
// natural head motion, moods.
//
// That realistic render happens on a hidden canvas; every frame it is fed
// through a halftone shader that rebuilds it as thousands of glowing dots —
// dot size follows the lighting, so eyes, nose, lips and brows emerge from
// the dot field exactly like a sci-fi hologram panel.

import * as THREE from "three";
import { TalkingHead } from "talkinghead";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

const AVATAR_URL = "/assets/avatar.glb";
const SRC_W = 640, SRC_H = 820; // hidden realistic render size

export const EMOTIONS = {
  neutral:   { color: 0xd6ecff, mood: "neutral" },
  happy:     { color: 0xa8ffe3, mood: "happy" },
  laugh:     { color: 0xffd24a, mood: "happy" },
  sad:       { color: 0x5c82ff, mood: "sad" },
  cry:       { color: 0x6a8cff, mood: "sad" },
  angry:     { color: 0xff5c4a, mood: "angry" },
  surprised: { color: 0xeaffff, mood: "neutral" },
  fear:      { color: 0xc2a0ff, mood: "fear" },
  thinking:  { color: 0x9ad4ff, mood: "neutral" },
};

const HALFTONE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const HALFTONE_FRAG = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uSrcSize;
  uniform float uPitch;   // dot grid pitch in source pixels
  uniform vec3 uTint;
  uniform float uTime;
  uniform float uBoost;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec2 srcPx = vUv * uSrcSize;
    vec2 cell = floor(srcPx / uPitch);
    vec2 center = (cell + 0.5) * uPitch;
    vec4 s = texture2D(tSrc, center / uSrcSize);
    float luma = dot(s.rgb, vec3(0.299, 0.587, 0.114)) * s.a;

    // dot radius grows with brightness but never merges with neighbours,
    // so the halftone structure survives in highlights
    float r = 0.46 * uPitch * sqrt(clamp(luma, 0.0, 1.0));
    float d = length(srcPx - center);
    float dotMask = 1.0 - smoothstep(r - 0.9, r + 0.6, d);

    // per-dot digital flicker
    float n = hash(cell);
    float flick = 0.86 + 0.28 * fract(n + uTime * (0.10 + 0.55 * n));

    // keep a hint of the source colour so irises and lips read through
    vec3 col = mix(uTint * luma, s.rgb * s.a, 0.34) * flick * uBoost;

    float alpha = dotMask * step(0.015, luma);
    gl_FragColor = vec4(col * dotMask, alpha);
  }
`;

export class HologramFace {
  constructor(container) {
    this.container = container;
    this.clock = new THREE.Clock();
    this.state = "idle";
    this.emotion = "neutral";
    this.emotionColor = new THREE.Color(EMOTIONS.neutral.color);
    this.targetColor = new THREE.Color(EMOTIONS.neutral.color);
    this.onPoke = null;
    this.pokeTime = -10;
    this.head = null;
    this.wakeT = null; // materialize animation start time (null = pre-wake)
  }

  // classy power-on: dots coalesce from a coarse scatter into the face
  wakeUp() {
    this.wakeT = this.clock.getElapsedTime();
  }

  async init(onprogress) {
    // ---- hidden realistic renderer (TalkingHead) ----
    this.hiddenDiv = document.createElement("div");
    Object.assign(this.hiddenDiv.style, {
      position: "fixed", left: "0", top: "0",
      width: SRC_W + "px", height: SRC_H + "px",
      opacity: "0", pointerEvents: "none", zIndex: "-1",
    });
    document.body.appendChild(this.hiddenDiv);

    this.head = new TalkingHead(this.hiddenDiv, {
      ttsEndpoint: "/api/tts-unused",
      lipsyncModules: ["en"],
      cameraView: "head",
      cameraRotateEnable: false,
      cameraZoomEnable: false,
      avatarMood: "neutral",
      lightAmbientIntensity: 1.7,
      lightDirectIntensity: 13,
      modelPixelRatio: 1,
    });

    await this.head.showAvatar(
      { url: AVATAR_URL, body: "F", avatarMood: "neutral", lipsyncLang: "en" },
      onprogress
    );

    // PROSOPO doesn't wear the avatar's glasses
    try {
      (this.head.armature || this.head.avatar)?.traverse((o) => {
        if (o.name === "Wolf3D_Glasses") o.visible = false;
      });
    } catch { /* cosmetic only */ }

    const srcCanvas = this.hiddenDiv.querySelector("canvas");
    this.srcTexture = new THREE.CanvasTexture(srcCanvas);
    this.srcTexture.minFilter = THREE.LinearFilter;
    this.srcTexture.generateMipmaps = false;
    this.srcCanvas = srcCanvas;

    // ---- visible hologram scene ----
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x02040a);
    this.scene.fog = new THREE.FogExp2(0x02040a, 0.06);
    this.camera = new THREE.PerspectiveCamera(30, w / h, 0.05, 40);
    this.camera.position.set(0, 0.1, 3.1);
    this.camera.lookAt(0, 0.05, 0);

    this.buildGridRoom();

    // billboard carrying the halftone face
    const planeH = 1.5, planeW = planeH * (SRC_W / SRC_H);
    this.faceMat = new THREE.ShaderMaterial({
      vertexShader: HALFTONE_VERT,
      fragmentShader: HALFTONE_FRAG,
      uniforms: {
        tSrc: { value: this.srcTexture },
        uSrcSize: { value: new THREE.Vector2(srcCanvas.width, srcCanvas.height) },
        uPitch: { value: 3.1 }, // denser, smaller dots — fewer gaps
        uTint: { value: new THREE.Color(EMOTIONS.neutral.color) },
        uTime: { value: 0 },
        uBoost: { value: 1.05 },
      },
      transparent: true,
      depthWrite: false,
    });
    this.facePlane = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeH), this.faceMat);
    this.facePlane.position.set(0, 0.12, 0);
    this.planeW = planeW;
    this.scene.add(this.facePlane);
    this.fitFace();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.5, 0.7, 0.35);
    this.composer.addPass(this.bloom);

    this.raycaster = new THREE.Raycaster();
    this.renderer.domElement.addEventListener("pointerdown", (e) => this.handlePointer(e));
    window.addEventListener("resize", () => this.onResize());
    window.PROSOPO_FACE = this;

    this.animate();
  }

  buildGridRoom() {
    const room = new THREE.Group();
    const S = 6;
    const mk = (op) => {
      const g = new THREE.GridHelper(S, 26, 0x36f2ff, 0x0d5a78);
      g.material.transparent = true;
      g.material.opacity = op;
      g.material.depthWrite = false;
      return g;
    };
    const floor = mk(0.8); floor.position.y = -1.55; room.add(floor);
    const ceil = mk(0.45); ceil.position.y = 2.2; room.add(ceil);
    const back = mk(0.7); back.rotation.x = Math.PI / 2; back.position.set(0, 0.3, -1.6); room.add(back);
    const left = mk(0.55); left.rotation.z = Math.PI / 2; left.position.set(-S / 2, 0.3, 0); room.add(left);
    const right = mk(0.55); right.rotation.z = Math.PI / 2; right.position.set(S / 2, 0.3, 0); room.add(right);
    this.gridRoom = room;
    this.scene.add(room);
  }

  handlePointer(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const p = new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1
    );
    this.raycaster.setFromCamera(p, this.camera);
    if (this.raycaster.intersectObject(this.facePlane, false).length) {
      this.pokeTime = this.clock.getElapsedTime();
      try { this.head.lookAtCamera(400); } catch { /* optional */ }
      this.onPoke?.();
    }
  }

  onResize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.fitFace();
  }

  // keep the whole face visible on narrow (mobile) screens
  fitFace() {
    if (!this.facePlane) return;
    const dist = this.camera.position.z - this.facePlane.position.z;
    const visH = 2 * dist * Math.tan((this.camera.fov * Math.PI) / 360);
    const visW = visH * this.camera.aspect;
    const fit = Math.min(1, (visW * 0.92) / this.planeW);
    this.facePlane.scale.setScalar(fit);
  }

  setEmotion(name) {
    const e = EMOTIONS[name] || EMOTIONS.neutral;
    this.emotion = EMOTIONS[name] ? name : "neutral";
    this.targetColor.setHex(e.color);
    try { this.head.setMood(e.mood); } catch { /* mood optional */ }
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    const t = this.clock.getElapsedTime();
    const dt = Math.min(this.clock.getDelta() + 0.016, 0.05);

    // pull the latest realistic frame into the dot shader
    if (this.srcTexture) this.srcTexture.needsUpdate = true;

    // manual lip animation while the browser voice speaks
    if (this.fakeTalk) {
      const v = Math.abs(Math.sin(t * 9.2) * Math.sin(t * 5.1));
      try {
        this.head.setFixedValue("viseme_aa", 0.15 + v * 0.6);
        this.head.setFixedValue("viseme_O", (1 - v) * 0.25);
      } catch { /* morphs optional */ }
    }

    const poke = Math.max(0, 1 - (t - this.pokeTime) / 1.0);
    this.emotionColor.lerp(this.targetColor, 1 - Math.exp(-dt * 3));
    this.faceMat.uniforms.uTime.value = t;
    this.faceMat.uniforms.uTint.value.copy(this.emotionColor);

    // materialization: before wake the face is a faint coarse scatter;
    // on wake the dots tighten and brighten into place over ~1.8s
    let wake = 1;
    if (this.wakeT === null) wake = 0;
    else wake = Math.min(1, (t - this.wakeT) / 1.8);
    const easeW = wake * wake * (3 - 2 * wake);
    this.faceMat.uniforms.uPitch.value = 3.1 + (1 - easeW) * 9.0;
    this.faceMat.uniforms.uBoost.value = (0.25 + 0.8 * easeW) +
      poke * 0.5 + (this.state === "thinking" ? Math.sin(t * 6) * 0.1 : 0);

    // gentle billboard float (TalkingHead moves the head inside the frame)
    this.facePlane.position.y = 0.12 + Math.sin(t * 0.8) * 0.008;
    this.facePlane.rotation.y = Math.sin(t * 0.3) * 0.02 - poke * 0.03;

    if (this.gridRoom) {
      for (const g of this.gridRoom.children) g.material.color.lerp(this.emotionColor, 0.015);
    }

    this.composer.render();
  }

  // speech: { audio: AudioBuffer, words, wtimes, wdurations }
  async speakAudio(speech) {
    try { await this.head.audioCtx?.resume?.(); } catch { /* fine */ }
    this.state = "talking";
    const durationMs = speech.audio.duration * 1000;
    this.head.speakAudio(speech, {});
    await new Promise((r) => setTimeout(r, durationMs + 400));
    this.state = "idle";
  }

  // During browser-voice speech there is no audio stream to lip-sync to,
  // so drive the avatar's viseme morphs directly.
  startFakeTalk() { this.state = "talking"; this.fakeTalk = true; }
  stopFakeTalk() {
    this.state = "idle";
    this.fakeTalk = false;
    try {
      this.head.setFixedValue("viseme_aa", null);
      this.head.setFixedValue("viseme_O", null);
    } catch { /* release best-effort */ }
  }
  startThinking() { this.state = "thinking"; try { this.head.lookAt(320, 200, 900); } catch { /* opt */ } }
  stopThinking() { if (this.state === "thinking") this.state = "idle"; }
  setMood(m) { this.setEmotion(m); }
}
