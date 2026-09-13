// Vercel serverless function: GET /api/tts?lang=te&q=... -> MP3 audio.
// Stateless proxy to a free natural voice; nothing is logged or stored.
import { fetchTtsAudio } from "../lib/gtts.mjs";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const q = (req.query.q || "").toString();
  const lang = (req.query.lang || "te").toString();
  if (!q.trim() || q.length > 400) {
    res.status(400).json({ error: "Invalid text" });
    return;
  }
  try {
    const { buffer, contentType } = await fetchTtsAudio(q, lang);
    res.setHeader("Content-Type", contentType);
    res.status(200).send(buffer);
  } catch (err) {
    console.error("tts:", err.message);
    res.status(502).json({ error: "TTS unavailable" });
  }
}
