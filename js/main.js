// PROSOPO — main orchestration: avatar + chat + voice + emotions.

import { SpeechEngine } from "./tts.js";
import { ChatEngine } from "./chat.js";
import { CustomFace } from "./customface.js";

// ?avatar=human loads the realistic rigged avatar (TalkingHead) instead.
const USE_HUMAN = new URLSearchParams(location.search).get("avatar") === "human";

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
};

let avatar;
const speech = new SpeechEngine();
const chat = new ChatEngine();
let busy = false;

const GREETING = { text: "Hey, I'm PROSOPO. Ask me anything — I'm all ears.", emotion: "happy" };
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

// ---------- speaking (one consistent voice — Kokoro) ----------
async function speak(text) {
  // Wait for the HD voice instead of switching voices mid-conversation.
  if (!speech.ready) {
    setStatus("Voice warming up…", "booting");
    const ok = await speech.whenReady();
    if (!ok) { // Kokoro genuinely can't run on this device — silent fallback
      showSubtitle(text);
      if (avatar instanceof CustomFace) avatar.startFakeTalk();
      await speech.speakFallback(text);
      if (avatar instanceof CustomFace) avatar.stopFakeTalk();
      showSubtitle(null);
      return;
    }
  }
  setStatus("Speaking…", "ready");
  const data = await speech.synthesizeKokoro(text);
  showSubtitle(text);
  if (avatar instanceof CustomFace) {
    await avatar.speakAudio(data, speech.audioCtx);
  } else {
    await avatar.speakAudio(data);
  }
  showSubtitle(null);
}

// ---------- boot ----------
async function boot() {
  setStatus("Loading avatar…", "booting");
  try {
    if (USE_HUMAN) {
      const { Avatar } = await import("./avatar.js");
      avatar = new Avatar(el.avatar);
    } else {
      avatar = new CustomFace(el.avatar);
      avatar.onPoke = onPoke;
    }
    await avatar.init((ev) => {
      if (ev && ev.total) {
        const pct = Math.min(100, Math.round((ev.loaded / ev.total) * 100));
        setStatus(`Loading avatar… ${pct}%`, "booting");
      }
    });
  } catch (err) {
    console.error("Avatar failed to load:", err);
    setStatus("Avatar failed — check console", "error");
    return;
  }
  setStatus("Waiting to wake…", "booting");
  speech.loadKokoro((msg) => setStatus(msg, speech.ready ? "ready" : "booting"));
  voice.setup();
}

async function wake(withVoice) {
  el.wake.classList.add("hidden");
  speech.ensureAudioCtx(); // unlock audio inside the user gesture
  if (withVoice && voice.rec) voice.toggle(); // triggers mic permission prompt
  idleStatus();
  // greet once the voice is ready
  busy = true;
  voice.pause();
  if (avatar instanceof CustomFace) avatar.setEmotion(GREETING.emotion);
  addMsg(GREETING.text, "ai");
  try { await speak(GREETING.text); } catch (e) { console.warn(e); }
  busy = false;
  voice.resume();
  idleStatus();
}

el.wakeVoice.addEventListener("click", () => wake(true));
el.wakeText.addEventListener("click", () => {
  el.chatPanel.hidden = false;
  el.chatBtn.classList.add("active");
  wake(false);
});

// ---------- poke reaction ----------
async function onPoke() {
  if (busy) return;
  const now = Date.now();
  if (now - lastQuip < 8000 || !speech.ready) return; // visual reaction only
  lastQuip = now;
  const quip = POKE_QUIPS[(Math.random() * POKE_QUIPS.length) | 0];
  busy = true;
  voice.pause();
  try { await speak(quip); } catch (e) { console.warn(e); }
  busy = false;
  voice.resume();
  idleStatus();
}

// ---------- conversation ----------
async function handleUserText(text) {
  if (busy || !text.trim()) return;
  busy = true;
  el.send.disabled = true;
  voice.pause(); // don't listen to our own voice

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
  if (avatar instanceof CustomFace) avatar.setEmotion(reply.emotion);
  else avatar.setMood?.(reply.emotion === "laugh" ? "happy" : reply.emotion);

  try { await speak(reply.text); } catch (err) { console.warn("Speech failed:", err); }

  el.send.disabled = false;
  busy = false;
  voice.resume();
  idleStatus();
  if (!el.chatPanel.hidden) el.input.focus();
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
    this.rec.lang = "en-US";
    this.rec.continuous = true;
    this.rec.interimResults = false;

    this.rec.onresult = (e) => {
      const res = e.results[e.results.length - 1];
      if (res.isFinal) {
        const text = res[0].transcript.trim();
        if (text) handleUserText(text);
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
