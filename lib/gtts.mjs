// Fetches natural TTS audio (MP3) from Google Translate's public TTS
// endpoint — free, native-quality voices for Indian languages.

const LANGS = new Set(["te", "en", "hi", "ta", "kn", "ml"]);

export async function fetchTtsAudio(text, lang) {
  if (!LANGS.has(lang)) throw new Error("unsupported lang");
  const q = String(text).slice(0, 380);
  const url =
    "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob" +
    `&tl=${lang}&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Referer: "https://translate.google.com/",
    },
  });
  if (!res.ok) throw new Error(`gtts ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 200) throw new Error("gtts empty audio");
  return { buffer, contentType: "audio/mpeg" };
}
