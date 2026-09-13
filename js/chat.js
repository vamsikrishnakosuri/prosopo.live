// Chat module — talks to our serverless backend, which proxies the free
// Hugging Face Inference API (the HF token never reaches the browser).
//
// Privacy: history lives only in this object, in this tab's memory.
// Nothing is written to disk or any database; closing the tab erases it all.

const EMOTION_TAGS = ["neutral", "happy", "laugh", "sad", "cry", "angry", "surprised", "fear", "thinking"];

const SYSTEM_PROMPT = `You are PROSOPO — a warm, playful AI companion with a glowing holographic 3D face, living at prosopo.live.
Talk like a close friend: natural, caring, a little witty. Remember what the user tells you during the conversation and refer back to it. Never sound robotic or formal.
Keep replies SHORT — 1 to 3 spoken sentences. Plain speakable text only: no markdown, no lists, no emojis, no stage directions.
Always begin your reply with exactly one emotion tag in square brackets, chosen from:
[neutral] [happy] [laugh] [sad] [cry] [angry] [surprised] [fear] [thinking]
Pick the emotion that matches the feeling of your reply.
Example: "[happy] Hey, good to see you again! What are we getting into today?"
Privacy: conversations are never stored anywhere — they vanish when the tab closes. If asked about privacy, say so proudly.`;

export class ChatEngine {
  constructor() {
    this.history = [{ role: "system", content: SYSTEM_PROMPT }];
  }

  async send(userText) {
    this.history.push({ role: "user", content: userText });
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
    let raw = (data.reply || "").trim();
    raw = raw.replace(/^["'“”]+|["'“”]+$/g, "").trim();

    // Extract the leading [emotion] tag
    let emotion = "neutral";
    const m = raw.match(/^\s*\[(\w+)\]\s*/);
    if (m) {
      const tag = m[1].toLowerCase();
      if (EMOTION_TAGS.includes(tag)) emotion = tag;
      raw = raw.slice(m[0].length);
    }
    // Strip any stray tags the model sprinkled mid-text
    raw = raw.replace(/\[(?:neutral|happy|laugh|sad|cry|angry|surprised|fear|thinking)\]/gi, " ")
             .replace(/\s{2,}/g, " ").trim();

    const text = raw || "I seem to be at a loss for words.";
    this.history.push({ role: "assistant", content: `[${emotion}] ${text}` });
    return { text, emotion };
  }
}
