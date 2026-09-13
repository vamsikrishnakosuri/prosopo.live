// Vercel serverless function: POST /api/chat  { messages: [...] } -> { reply }
import { chatCompletion, validateMessages } from "../lib/hf.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  const messages = validateMessages(req.body);
  if (!messages) {
    res.status(400).json({ error: "Invalid messages" });
    return;
  }

  try {
    const result = await chatCompletion(messages);
    res.status(200).json(result);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Upstream model error" });
  }
}
