// Chat module — talks to our serverless backend, which proxies the free
// Hugging Face Inference API (the HF token never reaches the browser).

const SYSTEM_PROMPT = `You are PROSOPO, a futuristic AI with a holographic 3D face, live at prosopo.live.
You speak with warmth, curiosity and a hint of sci-fi wonder.
Keep replies SHORT and conversational — 1 to 3 sentences — because they are spoken aloud.
Never use markdown, bullet lists, emojis or code blocks: plain speakable sentences only.`;

export class ChatEngine {
  constructor() {
    this.history = [{ role: "system", content: SYSTEM_PROMPT }];
  }

  async send(userText) {
    this.history.push({ role: "user", content: userText });
    // Keep context small: system + last 12 turns
    const messages = [this.history[0], ...this.history.slice(1).slice(-12)];

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Chat backend error ${res.status}: ${detail}`);
    }

    const data = await res.json();
    let reply = (data.reply || "").trim();
    reply = reply.replace(/^["'“”]+|["'“”]+$/g, "").trim() || "I seem to be at a loss for words.";
    this.history.push({ role: "assistant", content: reply });
    return reply;
  }
}
