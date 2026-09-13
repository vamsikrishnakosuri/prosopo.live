// PROSOPO — main orchestration: avatar + chat + voice + emotions.

import { SpeechEngine } from "./tts.js";
import { ChatEngine } from "./chat.js";
import { HologramFace } from "./hologram.js";

// default: halftone hologram of the rigged human avatar.
// ?avatar=dots  -> legacy geometric dot cloud
// ?avatar=human -> plain realistic avatar, no hologram effect
const AVATAR_MODE = new URLSearchParams(location.search).get("avatar") || "hologram";

const el = {
  avatar: document.getElementById("avatar"),
  statusDot: document.getElementById("status-dot"),
  statusText: document.getElementById("status-text"),
  subtitle: document.getElementById("subtitle"),
  chatPanel: document.getElementById("chat-panel"),
  chatLog: document.getElementById("chat-log"),
  form: document.getElementById("chat-form"),
  input: document.getElementById("chat-input"),
  send: document.getElementById("send-btn"),
  mic: document.getElementById("mic-btn"),
  chatBtn: document.getElementById("chat-btn"),
  hint: document.getElementById("hint"),
  wake: document.getElementById("wake"),
  wakeVoice: document.getElementById("wake-voice"),
  wakeText: document.getElementById("wake-text"),
  wakeLoader: document.getElementById("wake-loader"),
  wakeLoaderText: document.getElementById("wake-loader-text"),
  wakeLoaderBar: document.getElementById("wake-loader-bar"),
  loader: document.getElementById("loader"),
  loaderText: document.getElementById("loader-text"),
};

const statusPill = document.getElementById("status");
function showLoader(text) {
  el.loaderText.textContent = text;
  el.loader.hidden = false;
  statusPill.classList.add("suppressed"); // center loader replaces the corner pill
}
function hideLoader() {
  el.loader.hidden = true;
  statusPill.classList.remove("suppressed");
}

let avatar;
const speech = new SpeechEngine();
const chat = new ChatEngine();
let busy = false;

// language support: auto-detected from the browser, then from what the user says
const REC_LANGS = { en: "en-US", es: "es-ES", fr: "fr-FR", hi: "hi-IN", it: "it-IT", pt: "pt-BR", ja: "ja-JP", zh: "zh-CN" };
const GREETINGS = {
  en: "Hey, I'm PROSOPO. Ask me anything — I'm all ears.",
  es: "Hola, soy PROSOPO. Pregúntame lo que quieras.",
  fr: "Salut, je suis PROSOPO. Demande-moi ce que tu veux.",
  hi: "नमस्ते, मैं PROSOPO हूँ। मुझसे कुछ भी पूछो।",
  it: "Ciao, sono PROSOPO. Chiedimi quello che vuoi.",
  pt: "Oi, eu sou PROSOPO. Pode me perguntar qualquer coisa.",
  ja: "こんにちは、PROSOPOです。なんでも聞いてください。",
  zh: "你好，我是PROSOPO。有什么想问的都可以。",
};
let currentLang = (navigator.language || "en").slice(0, 2).toLowerCase();
if (!REC_LANGS[currentLang]) currentLang = "en";

const POKE_QUIPS = [
  "Hey! Easy with the clicking, friend.",
  "I felt that, you know.",
  "Poking the hologram. Classic.",
  "Yes? Can I help you with something?",
  "Careful — I'm made of very sensitive photons.",
];
let lastQuip = 0;

// ---------- UI helpers ----------
function setStatus(text, state = "ready") {
  el.statusText.textContent = text;
  el.statusDot.className = `status-dot ${state}`;
}

function addMsg(text, who) {
  const div = document.createElement("div");
  div.className = `msg ${who}`;
  div.textContent = text;
  el.chatLog.appendChild(div);
  el.chatLog.scrollTop = el.chatLog.scrollHeight;
  return div;
}

function showSubtitle(text) {
  if (!text) { el.subtitle.hidden = true; return; }
  el.subtitle.textContent = text;
  el.subtitle.hidden = false;
}

function idleStatus() {
  setStatus(voice.mode ? "Listening…" : "Online", "ready");
}

// ---------- speaking ----------
// English: Kokoro HD voice with full audio lip-sync.
// Other languages: the browser's native voice for that language, with
// animated lips driven directly on the avatar.
async function speak(text, lang = currentLang) {
  const useKokoro = lang === "en";
  if (useKokoro && !speech.ready) {
    setStatus("Voice warming up…", "booting");
    showLoader("ESTABLISHING VOICE LINK…");
    const ok = await speech.whenReady();
    hideLoader();
    if (!ok) return speakViaBrowser(text, lang);
  }
  setStatus("Speaking…", "ready");
  if (!useKokoro) return speakViaBrowser(text, lang);
  const data = await speech.synthesizeKokoro(text, lang);
  showSubtitle(text);
  await avatar.speakAudio(data, speech.audioCtx);
  showSubtitle(null);
}

async function speakViaBrowser(text, lang) {
  setStatus("Speaking…", "ready");
  showSubtitle(text);
  avatar.startFakeTalk?.();
  await speech.speakFallback(text, lang);
  avatar.stopFakeTalk?.();
  showSubtitle(null);
}

// ---------- boot ----------
function setWakeLoading(text, pct) {
  el.wakeLoaderText.textContent = text;
  if (pct != null) el.wakeLoaderBar.style.width = `${pct}%`;
}

async function boot() {
  el.wakeVoice.disabled = true;
  el.wakeText.disabled = true;
  setStatus("Materializing…", "booting");
  setWakeLoading("MATERIALIZING FACE…", 4);
  try {
    if (AVATAR_MODE === "human") {
      const { Avatar } = await import("./avatar.js");
      avatar = new Avatar(el.avatar);
    } else if (AVATAR_MODE === "dots") {
      const { CustomFace } = await import("./customface.js");
      avatar = new CustomFace(el.avatar);
      avatar.onPoke = onPoke;
    } else {
      avatar = new HologramFace(el.avatar);
      avatar.onPoke = onPoke;
    }
    await avatar.init((ev) => {
      if (ev && ev.total) {
        const pct = Math.min(100, Math.round((ev.loaded / ev.total) * 100));
        setWakeLoading(`MATERIALIZING FACE… ${pct}%`, 4 + pct * 0.7);
        setStatus(`Loading… ${pct}%`, "booting");
      }
    });
  } catch (err) {
    console.error("Avatar failed to load:", err);
    setStatus("Avatar failed — check console", "error");
    setWakeLoading("MATERIALIZATION FAILED — RELOAD THE PAGE", 100);
    return;
  }
  setWakeLoading("READY", 100);
  el.wakeLoader.classList.add("done");
  el.wakeVoice.disabled = false;
  el.wakeText.disabled = false;
  setStatus("Waiting to wake…", "booting");
  speech.loadKokoro((msg) => {
    setStatus(msg, speech.ready ? "ready" : "booting");
    if (!el.loader.hidden) el.loaderText.textContent = msg.toUpperCase();
  });
  voice.setup();
}

async function wake(withVoice) {
  el.wake.classList.add("hidden");
  avatar.wakeUp?.(); // dots materialize into the face
  speech.ensureAudioCtx(); // unlock audio inside the user gesture
  if (withVoice && voice.rec) voice.toggle(); // triggers mic permission prompt
  idleStatus();
  // greet once the voice is ready, in the user's own language
  busy = true;
  voice.pause();
  const greeting = GREETINGS[currentLang] || GREETINGS.en;
  addMsg(greeting, "ai");
  await new Promise((r) => setTimeout(r, 1400)); // let the materialization play
  try { await speak(greeting, currentLang); } catch (e) { console.warn(e); }
  busy = false;
  voice.resume();
  idleStatus();
  voice.drainPending();
}

el.wakeVoice.addEventListener("click", () => wake(true));
el.wakeText.addEventListener("click", () => {
  el.chatPanel.hidden = false;
  el.chatBtn.classList.add("active");
  wake(false);
});

// ---------- poke reaction ----------
async function onPoke() {
  // always show a visible startled reaction
  const before = avatar.emotion || "neutral";
  avatar.setEmotion?.("surprised");
  setTimeout(() => { if ((avatar.emotion || "neutral") === "surprised") avatar.setEmotion?.(before); }, 1400);

  if (busy) return;
  const now = Date.now();
  if (now - lastQuip < 5000 || !speech.ready) return;
  lastQuip = now;
  const quip = POKE_QUIPS[(Math.random() * POKE_QUIPS.length) | 0];
  busy = true;
  voice.pause();
  try { await speak(quip, "en"); } catch (e) { console.warn(e); }
  busy = false;
  voice.resume();
  idleStatus();
}

// ---------- conversation ----------
async function handleUserText(text) {
  if (!text.trim()) return;
  if (busy) { voice.pending = text; return; } // never silently drop what the user said
  busy = true;
  el.send.disabled = true;
  voice.pause(); // don't listen to our own voice

  // watchdog: whatever happens, PROSOPO must never hang unresponsive
  const watchdog = setTimeout(() => {
    console.warn("Watchdog: conversation step took too long — recovering.");
    busy = false;
    el.send.disabled = false;
    avatar.stopThinking?.();
    avatar.stopFakeTalk?.();
    voice.resume();
    setStatus("Recovered — ask me again", "error");
  }, 60000);

  addMsg(text, "user");
  el.input.value = "";
  const thinkingMsg = addMsg("…", "ai thinking");
  setStatus("Thinking…", "booting");
  avatar.startThinking?.();

  let reply;
  try {
    reply = await chat.send(text.trim());
  } catch (err) {
    console.error(err);
    reply = { text: "Hmm, I lost my train of thought. Ask me again?", emotion: "sad" };
  }

  avatar.stopThinking?.();
  thinkingMsg.classList.remove("thinking");
  thinkingMsg.textContent = reply.text;
  avatar.setEmotion?.(reply.emotion);

  // follow the user's language: reply tag switches voice + mic language
  if (reply.lang && REC_LANGS[reply.lang] && reply.lang !== currentLang) {
    currentLang = reply.lang;
    voice.setLang(currentLang);
  }

  try { await speak(reply.text, reply.lang || currentLang); } catch (err) { console.warn("Speech failed:", err); }

  clearTimeout(watchdog);
  el.send.disabled = false;
  busy = false;
  voice.resume();
  idleStatus();
  if (!el.chatPanel.hidden) el.input.focus();
  voice.drainPending();
}

el.form.addEventListener("submit", (e) => {
  e.preventDefault();
  handleUserText(el.input.value);
});

// ---------- chat panel toggle ----------
el.chatBtn.addEventListener("click", () => {
  el.chatPanel.hidden = !el.chatPanel.hidden;
  el.chatBtn.classList.toggle("active", !el.chatPanel.hidden);
  if (!el.chatPanel.hidden) el.input.focus();
});

// ---------- hands-free voice conversation ----------
const voice = {
  mode: false,
  rec: null,
  paused: false,
  pending: null,

  // switch the microphone language (applies on next listening restart)
  setLang(lang) {
    if (!this.rec) return;
    this.rec.lang = REC_LANGS[lang] || "en-US";
    if (this.mode && !this.paused) {
      try { this.rec.abort(); } catch { /* onend restarts with new lang */ }
    }
  },

  // speak anything the user said while PROSOPO was busy
  drainPending() {
    if (this.pending && !busy) {
      const t = this.pending;
      this.pending = null;
      handleUserText(t);
    }
  },

  setup() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      el.wakeVoice.hidden = true; // no voice support in this browser
      el.chatPanel.hidden = false;
      el.chatBtn.classList.add("active");
      return;
    }
    el.mic.hidden = false;

    this.rec = new SR();
    this.rec.lang = REC_LANGS[currentLang] || "en-US";
    this.rec.continuous = true;
    this.rec.interimResults = true; // live "heard you" feedback

    this.rec.onresult = (e) => {
      const res = e.results[e.results.length - 1];
      const text = res[0].transcript.trim();
      if (res.isFinal) {
        if (text) handleUserText(text);
      } else if (text && !busy) {
        // show what is being heard so listening is never a mystery
        setStatus(`Hearing: ${text.slice(-42)}`, "ready");
      }
    };
    this.rec.onend = () => {
      if (this.mode && !this.paused) {
        setTimeout(() => { try { this.rec.start(); } catch { /* already running */ } }, 250);
      }
    };
    this.rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        this.mode = false;
        this.updateButton();
        setStatus("Mic blocked — allow microphone access", "error");
        el.chatPanel.hidden = false;
        el.chatBtn.classList.add("active");
      }
    };

    el.mic.addEventListener("click", () => this.toggle());
  },

  toggle() {
    this.mode = !this.mode;
    if (this.mode) {
      this.paused = false;
      try { this.rec.start(); } catch { /* already running */ }
    } else {
      try { this.rec.stop(); } catch { /* not running */ }
    }
    this.updateButton();
    idleStatus();
  },

  pause() {
    if (!this.mode) return;
    this.paused = true;
    try { this.rec.abort(); } catch { /* not running */ }
  },

  resume() {
    if (!this.mode) return;
    this.paused = false;
    setTimeout(() => { try { this.rec.start(); } catch { /* already running */ } }, 300);
  },

  updateButton() {
    el.mic.classList.toggle("active", this.mode);
    el.mic.classList.toggle("listening", this.mode);
    el.mic.querySelector(".dock-label").textContent = this.mode ? "Listening" : "Voice";
  },
};

boot();
