// TTS module — Kokoro-82M running fully in the browser (WebGPU when available,
// WASM otherwise), with the Web Speech API as instant fallback while Kokoro
// downloads or on devices that can't run it.

const KOKORO_CDN = "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm";
const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const KOKORO_VOICE = "af_heart"; // natural female voice; see kokoro-js voice list

export class SpeechEngine {
  constructor() {
    this.kokoro = null;
    this.kokoroState = "idle"; // idle | loading | ready | failed
    this.audioCtx = null;
  }

  get ready() { return this.kokoroState === "ready"; }

  // Begin loading Kokoro in the background. Never throws.
  async loadKokoro(onstatus) {
    if (this.kokoroState !== "idle") return;
    this.kokoroState = "loading";
    try {
      onstatus?.("Loading HD voice…");
      const { KokoroTTS } = await import(/* @vite-ignore */ KOKORO_CDN);
      const device = (navigator.gpu ? "webgpu" : "wasm");
      this.kokoro = await KokoroTTS.from_pretrained(KOKORO_MODEL, {
        dtype: device === "webgpu" ? "fp32" : "q8",
        device,
        progress_callback: (p) => {
          if (p.status === "progress" && p.total) {
            const pct = Math.round((p.loaded / p.total) * 100);
            onstatus?.(`Loading HD voice… ${pct}%`);
          }
        },
      });
      this.kokoroState = "ready";
      onstatus?.("HD voice ready");
    } catch (err) {
      console.warn("Kokoro failed to load, using browser voice.", err);
      this.kokoroState = "failed";
      onstatus?.("Using basic voice");
    }
  }

  ensureAudioCtx() {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return this.audioCtx;
  }

  // Generate speech with Kokoro. Returns { audio: AudioBuffer, words, wtimes, wdurations }
  // suitable for TalkingHead.speakAudio(). Word timings are estimated by
  // distributing audio duration across words weighted by word length.
  async synthesizeKokoro(text) {
    const result = await this.kokoro.generate(text, { voice: KOKORO_VOICE });
    const ctx = this.ensureAudioCtx();
    const samples = result.audio; // Float32Array
    const rate = result.sampling_rate;
    const buffer = ctx.createBuffer(1, samples.length, rate);
    buffer.getChannelData(0).set(samples);

    const durationMs = (samples.length / rate) * 1000;
    const { words, wtimes, wdurations } = estimateWordTimings(text, durationMs);
    return { audio: buffer, words, wtimes, wdurations };
  }

  // Fallback: plain browser speechSynthesis (no lip-sync data).
  speakFallback(text) {
    return new Promise((resolve) => {
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.0;
        u.pitch = 1.0;
        const voices = speechSynthesis.getVoices();
        const preferred = voices.find((v) => /en[-_]/i.test(v.lang) && /female|zira|aria|jenny/i.test(v.name))
          || voices.find((v) => /en[-_]/i.test(v.lang));
        if (preferred) u.voice = preferred;
        u.onend = resolve;
        u.onerror = resolve;
        speechSynthesis.speak(u);
      } catch {
        resolve();
      }
    });
  }

  stop() {
    try { speechSynthesis.cancel(); } catch { /* ignore */ }
  }
}

// Split text into words and spread the total duration across them,
// weighted by character count, with a small gap between words.
function estimateWordTimings(text, durationMs) {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return { words: [], wtimes: [], wdurations: [] };

  // Leading/trailing silence guess
  const pad = Math.min(150, durationMs * 0.04);
  const speakable = durationMs - pad * 2;
  const totalChars = words.reduce((n, w) => n + w.length + 1, 0);

  const wtimes = [];
  const wdurations = [];
  let t = pad;
  for (const w of words) {
    const share = ((w.length + 1) / totalChars) * speakable;
    wtimes.push(t);
    wdurations.push(share * 0.9); // 10% inter-word gap
    t += share;
  }
  return { words, wtimes, wdurations };
}
