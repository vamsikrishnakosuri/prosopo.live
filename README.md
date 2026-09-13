# PROSOPO.live — The Face of AI

A futuristic 3D talking face you can chat with. 100% free stack:

| Piece | Tech | Cost |
|---|---|---|
| 3D face | Custom android head generated with Meshy.ai, rigged in Blender (`assets/prosopo.glb`, shape keys: jawOpen/mouthPucker/mouthWide) | Free (Meshy credits) |
| Lip-sync | `js/customface.js` — three.js + audio analyser (volume → jaw, spectral centroid → pucker/wide) + UnrealBloom circuit glow. Add `?avatar=human` for the realistic [TalkingHead.js](https://github.com/met4citizen/TalkingHead) avatar | Free |
| AI brain | Hugging Face Inference API (`meta-llama/Llama-3.2-3B-Instruct` by default) via a serverless proxy | Free tier |
| Voice (HD) | [Kokoro-82M](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) running in the visitor's browser (WebGPU/WASM) | Free |
| Voice (fallback) | Browser Web Speech API | Free |
| Speech input | Browser SpeechRecognition (mic button, Chrome/Edge) | Free |
| Hosting | Vercel (static + `api/` functions) on the prosopo.live domain | Free |

## Run locally

```bash
npm run dev
```

Open http://localhost:3000. Without a token the AI answers in demo mode.

For real AI replies: copy `.env.example` to `.env.local` and paste a free
Hugging Face token (huggingface.co → Settings → Access Tokens → New token, type **Read**).

## Deploy (Vercel, free)

1. Push this folder to a GitHub repo.
2. Import the repo at vercel.com (framework preset: **Other**, no build step).
3. Add env var `HF_TOKEN` in Project Settings.
4. Point the `prosopo.live` domain at Vercel (Settings → Domains).

## Swapping in the custom PROSOPO face

The avatar is any GLB with **ARKit + Oculus viseme** morph targets (Ready
Player Me export format). To use a custom face made in Blender/Meshy:

1. The mesh needs the 15 Oculus viseme shape keys (`viseme_sil`, `viseme_PP`,
   `viseme_FF`, …) plus ARKit blendshapes for expressions, and a standard
   Mixamo/RPM skeleton.
2. Export as `.glb`, drop it in `assets/`, and change `DEFAULT_AVATAR_URL`
   in `js/avatar.js`.

## Project layout

```
index.html        UI shell (import maps pull three.js + TalkingHead from CDN)
css/style.css     futuristic HUD styling
js/main.js        orchestration (chat → LLM → TTS → lip-sync)
js/avatar.js      TalkingHead wrapper (expressions, moods, lip-sync)
js/tts.js         Kokoro in-browser TTS + timing estimation + fallback voice
js/chat.js        chat history + /api/chat client
api/chat.js       Vercel serverless function → HF Inference router
lib/hf.mjs        shared HF chat-completion logic
server.mjs        zero-dependency local dev server
```
