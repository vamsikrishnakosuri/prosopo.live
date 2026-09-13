// PROSOPO — main orchestration: avatar + chat + voice.

import { SpeechEngine } from "./tts.js";
import { ChatEngine } from "./chat.js";
import { CustomFace } from "./customface.js";

// ?avatar=human loads the realistic rigged avatar (TalkingHead) instead of
// the PROSOPO android head.
const USE_HUMAN = new URLSearchParams(location.search).get("avatar") === "human";

const el = {
  avatar: document.getElementById("avatar"),
  statusDot: document.getElementById("status-dot"),
  statusText: document.getElementById("status-text"),
  subtitle: document.getElementById("subtitle"),
  chatLog: document.getElementById("chat-log"),
  form: document.getElementById("chat-form"),
  input: document.getElementById("chat-input"),
  send: document.getElementById("send-btn"),
  mic: document.getElementById("mic-btn"),
  hint: document.getElementById("hint"),
};

let avatar;
const speech = new SpeechEngine();
const chat = new ChatEngine();
let busy = false;

function setStatus(text, state = "ready") {
  el.statusText.textContent = text;
  el.statusDot.className = `status-dot ${state}`;
}

function addMsg(text, who) {
  el.chatLog.hidden = false;
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

async function boot() {
  setStatus("Loading avatar…", "booting");
  try {
    if (USE_HUMAN) {
      const { Avatar } = await import("./avatar.js");
      avatar = new Avatar(el.avatar);
    } else {
      avatar = new CustomFace(el.avatar);
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

  setStatus("Online", "ready");

  // Load the HD voice in the background.
  speech.loadKokoro((msg) => { el.hint.textContent = msg; });

  setupMic();
}

async function handleUserText(text) {
  if (busy || !text.trim()) return;
  busy = true;
  el.send.disabled = true;

  addMsg(text, "user");
  el.input.value = "";
  const thinkingMsg = addMsg("…", "ai thinking");
  setStatus("Thinking…", "booting");
  avatar.startThinking();

  let reply;
  try {
    reply = await chat.send(text.trim());
  } catch (err) {
    console.error(err);
    reply = "My connection to the neural core failed. Try again in a moment.";
  }

  avatar.stopThinking();
  thinkingMsg.classList.remove("thinking");
  thinkingMsg.textContent = reply;
  avatar.setMood(avatar.moodFromText(reply));

  setStatus("Speaking…", "ready");
  try {
    if (speech.ready) {
      const speechData = await speech.synthesizeKokoro(reply);
      showSubtitle(reply);
      if (avatar instanceof CustomFace) {
        await avatar.speakAudio(speechData, speech.audioCtx);
      } else {
        await avatar.speakAudio(speechData);
      }
    } else {
      showSubtitle(reply);
      if (avatar instanceof CustomFace) avatar.startFakeTalk();
      await speech.speakFallback(reply);
      if (avatar instanceof CustomFace) avatar.stopFakeTalk();
    }
  } catch (err) {
    console.warn("Speech failed:", err);
  }

  showSubtitle(null);
  setStatus("Online", "ready");
  el.send.disabled = false;
  busy = false;
  el.input.focus();
}

el.form.addEventListener("submit", (e) => {
  e.preventDefault();
  handleUserText(el.input.value);
});

// Optional voice input (Chrome/Edge)
function setupMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  el.mic.hidden = false;
  const rec = new SR();
  rec.lang = "en-US";
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  let listening = false;

  rec.onresult = (e) => {
    const text = e.results[0][0].transcript;
    handleUserText(text);
  };
  rec.onend = () => {
    listening = false;
    el.mic.classList.remove("listening");
  };
  rec.onerror = rec.onend;

  el.mic.addEventListener("click", () => {
    if (listening) { rec.stop(); return; }
    try {
      rec.start();
      listening = true;
      el.mic.classList.add("listening");
    } catch { /* already started */ }
  });
}

boot();
