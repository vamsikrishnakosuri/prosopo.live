// Shared chat-completion logic: calls the Hugging Face Inference router
// (OpenAI-compatible) with the server-side HF token.

const HF_ROUTER = "https://router.huggingface.co/v1/chat/completions";
const DEFAULT_MODEL = "meta-llama/Llama-3.1-8B-Instruct";

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
      max_tokens: 200,
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

export function validateMessages(body) {
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 40) return null;
  for (const m of messages) {
    if (!m || typeof m.content !== "string" || m.content.length > 4000) return null;
    if (!["system", "user", "assistant"].includes(m.role)) return null;
  }
  return messages;
}
