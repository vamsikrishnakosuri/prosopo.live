// Avatar module — wraps TalkingHead (met4citizen) for lip-sync + expressions.
// The avatar is swappable: any Ready Player Me style GLB with ARKit + Oculus
// viseme morph targets works (see README for how to plug in a custom face).

import { TalkingHead } from "talkinghead";

// Placeholder avatar until the custom PROSOPO face is rigged.
// Any GLB with ARKit + Oculus viseme morph targets can replace this file.
const DEFAULT_AVATAR_URL = "/assets/avatar.glb";

export class Avatar {
  constructor(container) {
    this.container = container;
    this.head = null;
  }

  async init(onprogress) {
    this.head = new TalkingHead(this.container, {
      ttsEndpoint: "/api/tts-unused", // required by lib; we feed audio ourselves
      lipsyncModules: ["en"],
      cameraView: "head",
      cameraRotateEnable: true,
      cameraPanEnable: false,
      cameraZoomEnable: true,
      avatarMood: "neutral",
      lightAmbientIntensity: 2,
      lightDirectIntensity: 22,
    });

    await this.head.showAvatar(
      {
        url: DEFAULT_AVATAR_URL,
        body: "F",
        avatarMood: "neutral",
        lipsyncLang: "en",
      },
      onprogress
    );
  }

  // Speak pre-generated audio with word timings (Kokoro path).
  // speech: { audio: AudioBuffer, words: string[], wtimes: number[], wdurations: number[] }
  async speakAudio(speech, onsubtitle) {
    return this.head.speakAudio(speech, {}, onsubtitle);
  }

  setMood(mood) {
    try { this.head.setMood(mood); } catch { /* unknown mood — ignore */ }
  }

  // Rough emotion from reply text so the face isn't frozen.
  moodFromText(text) {
    const t = text.toLowerCase();
    if (/\b(sorry|sad|unfortunate|regret)\b/.test(t)) return "sad";
    if (/\b(great|awesome|happy|glad|love|amazing|haha|:\))\b/.test(t)) return "happy";
    if (/\b(wow|incredible|really\?|surprising)\b/.test(t)) return "surprise";
    return "neutral";
  }

  startThinking() {
    try {
      this.head.lookAtCamera(500);
      this.head.playGesture("thinking", 3, false, 800);
    } catch { /* gesture optional */ }
  }

  stopThinking() {
    try { this.head.stopGesture(); } catch { /* ignore */ }
  }
}
