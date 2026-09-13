// TTS module — Kokoro-82M running fully in the browser (WebGPU when available,
// WASM otherwise), with the Web Speech API as instant fallback while Kokoro
// downloads or on devices that can't run it.

const KOKORO_CDN = "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm";
const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";

// kokoro-js ships English voices only; other languages use the browser's
// native speech voices (see speakFallback).
export const KOKORO_VOICES = { en: "af_heart" };
const FALLBACK_LOCALES = {
  en: "en-US", es: "es-ES", fr: "fr-FR", hi: "hi-IN",
  it: "it-IT", pt: "pt-BR", ja: "ja-JP", zh: "zh-CN",
};

export class SpeechEngine {
  constructor() {
    this.kokoro = null;
    this.kokoroState = "idle"; // idle | loading | ready | failed
    this.audioCtx = null;
  }

  get ready() { return this.kokoroState === "ready"; }

  // Resolves once Kokoro finished loading (true = ready, false = failed).
  whenReady() {
    if (this.kokoroState === "ready") return Promise.resolve(true);
    if (this.kokoroState === "failed") return Promise.resolve(false);
    return this.loadPromise ? this.loadPromise.then(() => this.kokoroState === "ready") : Promise.resolve(false);
  }

  // Begin loading Kokoro in the background. Never throws.
  async loadKokoro(onstatus) {
    if (this.kokoroState !== "idle") return this.loadPromise;
    this.loadPromise = this._loadKokoro(onstatus);
    return this.loadPromise;
  }

  async _loadKokoro(onstatus) {
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
            onstatus?.(`Loading HD voice… ${pct}%`, pct);
          }
        },
      });
      this.kokoroState = "ready";
      onstatus?.("HD voice ready", 100);
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
  async synthesizeKokoro(text, lang = "en") {
    const voice = KOKORO_VOICES[lang] || KOKORO_VOICES.en;
    const result = await this.kokoro.generate(text, { voice });
    const ctx = this.ensureAudioCtx();
    const samples = result.audio; // Float32Array
    const rate = result.sampling_rate;
    const buffer = ctx.createBuffer(1, samples.length, rate);
    buffer.getChannelData(0).set(samples);

    const durationMs = (samples.length / rate) * 1000;
    const { words, wtimes, wdurations } = estimateWordTimings(text, durationMs);
    return { audio: buffer, words, wtimes, wdurations };
  }

  // Native-quality voice for Telugu (and other Indic languages) via our
  // backend TTS proxy. The endpoint only speaks ~200 chars per request, so
  // long replies are split into sentence chunks, fetched in parallel and
  // stitched into one seamless AudioBuffer. Pseudo-syllable words keep the
  // avatar's lips animating (non-Latin text yields no visemes).
  async synthesizeRemote(text, lang) {
    const ctx = this.ensureAudioCtx();
    const chunks = splitTtsChunks(text, 170);
    const buffers = await Promise.all(chunks.map(async (chunk) => {
      const res = await fetch(`/api/tts?lang=${lang}&q=${encodeURIComponent(chunk)}`);
      if (!res.ok) throw new Error(`tts ${res.status}`);
      return ctx.decodeAudioData(await res.arrayBuffer());
    }));

    // concatenate with a small natural pause between chunks
    const rate = buffers[0].sampleRate;
    const gap = Math.round(rate * 0.18);
    const total = buffers.reduce((n, b) => n + b.length, 0) + gap * (buffers.length - 1);
    const merged = ctx.createBuffer(1, total, rate);
    const out = merged.getChannelData(0);
    let offset = 0;
    for (let i = 0; i < buffers.length; i++) {
      out.set(buffers[i].getChannelData(0), offset);
      offset += buffers[i].length + gap;
    }

    const durationMs = merged.duration * 1000;
    const { words, wtimes, wdurations } = estimateWordTimings(text, durationMs);
    const lipWords = words.map((w) => "la".repeat(Math.max(1, Math.round(w.length / 2))));
    return { audio: merged, words: lipWords, wtimes, wdurations };
  }

  // Browser speechSynthesis — used for non-English languages (and as a
  // last resort when Kokoro can't run). Picks a female voice for the
  // requested language when one exists.
  speakFallback(text, lang = "en") {
    return new Promise((resolve) => {
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.0;
        u.pitch = 1.05;
        u.lang = FALLBACK_LOCALES[lang] || lang;
        const voices = speechSynthesis.getVoices();
        const inLang = voices.filter((v) => v.lang.toLowerCase().startsWith(lang));
        const preferred =
          inLang.find((v) => /female|mujer|femme|donna|feminina|女|zira|aria|jenny|helena|paulina|amelie|elsa|kyoko|ting/i.test(v.name)) ||
          inLang.find((v) => /google/i.test(v.name)) ||
          inLang[0];
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

// Split long text into TTS-friendly chunks at sentence/phrase boundaries.
function splitTtsChunks(text, maxLen) {
  const parts = text.split(/(?<=[.!?।…])\s+|\n+/).filter(Boolean);
  const chunks = [];
  let cur = "";
  for (const part of parts) {
    if ((cur + " " + part).trim().length <= maxLen) {
      cur = (cur + " " + part).trim();
    } else {
      if (cur) chunks.push(cur);
      if (part.length <= maxLen) {
        cur = part;
      } else {
        // very long sentence: split on commas/spaces
        let rest = part;
        while (rest.length > maxLen) {
          let cut = rest.lastIndexOf(",", maxLen);
          if (cut < maxLen * 0.4) cut = rest.lastIndexOf(" ", maxLen);
          if (cut <= 0) cut = maxLen;
          chunks.push(rest.slice(0, cut).trim());
          rest = rest.slice(cut + 1).trim();
        }
        cur = rest;
      }
    }
  }
  if (cur) chunks.push(cur);
  return chunks.length ? chunks : [text.slice(0, maxLen)];
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
