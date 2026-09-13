// Shared chat-completion logic: calls the Hugging Face Inference router
// (OpenAI-compatible) with the server-side HF token.

const HF_ROUTER = "https://router.huggingface.co/v1/chat/completions";
// Qwen3-235B: fastest of the free router models AND the most natural Telugu
const DEFAULT_MODEL = "Qwen/Qwen3-235B-A22B-Instruct-2507";

// Friendly canned replies when no HF_TOKEN is configured yet, so the app is
// demoable before any account setup.
const DEMO_REPLIES = [
  "I'm running in demo mode right now — my neural core isn't connected yet. Add a Hugging Face token and I'll truly come alive.",
  "Demo mode here! I can move my lips, but my thoughts are canned until you plug in the Hugging Face token.",
  "You look great today. That's a guess — I'm in demo mode until my language core is connected.",
];
let demoIndex = 0;

export async function chatCompletion(messages) {
  const token = process.env.HF_TOKEN;
  const model = process.env.HF_MODEL || DEFAULT_MODEL;

  // Optional: Google Gemini free tier (best-in-class Telugu). Used
  // automatically when GEMINI_API_KEY is configured.
  if (process.env.GEMINI_API_KEY) {
    try {
      return await geminiCompletion(messages);
    } catch (err) {
      console.error("Gemini failed, falling back to HF:", err.message);
    }
  }

  if (!token) {
    const reply = DEMO_REPLIES[demoIndex++ % DEMO_REPLIES.length];
    return { reply, demo: true };
  }

  const res = await fetch(HF_ROUTER, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      // Telugu script uses ~3x more tokens per word than English — a small
      // cap truncates replies mid-sentence
      max_tokens: 560,
      temperature: 0.8,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`HF router ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content ?? "";
  return { reply, demo: false };
}

async function geminiCompletion(messages) {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const system = messages.find((m) => m.role === "system");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents,
        systemInstruction: system ? { parts: [{ text: system.content }] } : undefined,
        generationConfig: { maxOutputTokens: 700, temperature: 0.8, thinkingConfig: { thinkingBudget: 0 } },
      }),
    }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  const reply = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
  if (!reply) throw new Error("Gemini returned empty reply");
  return { reply, demo: false };
}

export function validateMessages(body) {
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 40) return null;
  for (const m of messages) {
    if (!m || typeof m.content !== "string" || m.content.length > 4000) return null;
    if (!["system", "user", "assistant"].includes(m.role)) return null;
  }
  return messages;
}
