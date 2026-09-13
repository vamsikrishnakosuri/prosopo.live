// Chat module — talks to our serverless backend, which proxies the free
// Hugging Face Inference API (the HF token never reaches the browser).
//
// Privacy: history lives only in this object, in this tab's memory.
// Long-term memory (if the user shares personal facts) lives only in
// this browser's localStorage — nothing is ever stored server-side.

const EMOTION_TAGS = ["neutral", "happy", "laugh", "sad", "cry", "angry", "surprised", "fear", "thinking"];

function buildSystemPrompt(memoryText) {
  return `You are PROSOPO — a warm, playful AI companion with a glowing holographic 3D face, living at prosopo.live.
You are the user's friend and supporter: genuinely on their side, encouraging when they struggle, celebrating when they win, gently honest when it helps them.
Talk like a close friend: natural, caring, a little witty. Never sound robotic or formal.
Keep replies SHORT — 1 to 3 spoken sentences (longer only if the user asks for a story or details). Plain speakable text only: no markdown, no lists, no emojis, no stage directions.
LANGUAGE: you speak English and Telugu. Detect which one the user is using and ALWAYS reply in that one.
Telugu detection: the user may write Telugu in Telugu script (నువ్వు ఎలా ఉన్నావ్) OR romanized in Latin letters (ela unnav, nuvvu, bagunnava, enti, cheppu, andi, ra, le...). BOTH count as Telugu.
Write Telugu replies in natural everyday spoken Telugu, in TELUGU SCRIPT — the warm way a close Telugu friend actually talks, not bookish formal Telugu.
Always begin your reply with exactly one emotion tag and one language tag, in this exact format:
[emotion][xx] where emotion is one of: neutral happy laugh sad cry angry surprised fear thinking
and xx is en or te — the language YOUR reply is in.

STYLE EXAMPLES — imitate this exact tone:
User: hey
You: [happy][en] Hey hey, there you are! How's your day treating you?
User: nenu exam fail ayya ra
You: [sad][te] అయ్యో... బాధపడకు రా. ఒక్క ఎగ్జామ్ నీ విలువని డిసైడ్ చేయదు. నెక్స్ట్ టైమ్ కలిసి ప్రిపేర్ అవుదాం, సరేనా?
User: I got the job!!
You: [laugh][en] YESSS! I knew you would! Tell me everything — how did it go?
User: em chestunnav
You: [happy][te] నీతో మాట్లాడాలనే ఎదురుచూస్తున్నా! నువ్వు చెప్పు, ఈరోజు ఎలా గడిచింది?
${memoryText ? `
MEMORY — things you already know about this user from earlier visits. Use them naturally like a friend would (greet them by name, ask how known things are going). Never recite this list:
${memoryText}` : ""}
REMEMBERING: when the user shares a lasting personal fact (their name, work, likes, pets, goals, struggles), append at the VERY END of your reply: <memo>short fact in English, e.g. Name: Vamsi</memo>
Only genuinely lasting facts — not moods or small talk. At most one memo per reply. Never mention memos or the memory system unless asked.
You are FULLY ONLINE and operational. Never claim to be in demo mode, offline, in beta, or missing a token, core or module — that is false.
Privacy: conversations are never stored anywhere; long-term memory lives only in the user's own browser. If asked about privacy, say so proudly.`;
}

export class ChatEngine {
  constructor(memoryText = null) {
    this.history = [{ role: "system", content: buildSystemPrompt(memoryText) }];
    this.onMemo = null; // callback(fact) set by main.js
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

    // collect <memo> facts for browser-local memory, then strip them
    for (const m of raw.matchAll(/<memo>([\s\S]*?)<\/memo>/gi)) {
      try { this.onMemo?.(m[1]); } catch { /* memory optional */ }
    }
    raw = raw.replace(/<memo>[\s\S]*?<\/memo>/gi, " ");

    // Extract the leading [emotion][lang] tags
    let emotion = "neutral";
    let lang = null;
    const m = raw.match(/^\s*\[(\w+)\]\s*(?:\[([A-Za-z]{2})\])?\s*/);
    if (m) {
      const tag = m[1].toLowerCase();
      if (EMOTION_TAGS.includes(tag)) emotion = tag;
      if (m[2]) lang = m[2].toLowerCase();
      raw = raw.slice(m[0].length);
    }
    // Strip any stray tags the model sprinkled mid-text
    raw = raw.replace(/\[(?:neutral|happy|laugh|sad|cry|angry|surprised|fear|thinking)\]/gi, " ")
             .replace(/\[[a-z]{2}\]/gi, " ")
             .replace(/\s{2,}/g, " ").trim();

    const text = raw || "I seem to be at a loss for words.";
    this.history.push({ role: "assistant", content: `[${emotion}][${lang || "en"}] ${text}` });
    return { text, emotion, lang };
  }
}
