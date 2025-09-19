// server.js
import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import path from "path";
import mime from "mime-types";
import cors from "cors";
import { fileURLToPath } from "url";
import fs from "fs";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 4000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// util: obtener imagen base64 (axios)
async function getImageBase64FromUrl(imageUrl) {
  if (!imageUrl) return null;
  try {
    const resp = await axios.get(imageUrl, { responseType: "arraybuffer", timeout: 30000 });
    const base64 = Buffer.from(resp.data, "binary").toString("base64");
    return base64;
  } catch (err) {
    throw new Error(`No se pudo descargar la imagen: ${err.message}`);
  }
}

function getMimeTypeFromUrl(url) {
  try {
    const ext = path.extname(url).toLowerCase();
    return mime.lookup(ext) || "application/octet-stream";
  } catch {
    return "application/octet-stream";
  }
}

/* ---------------------------
   Handlers por modelo
   --------------------------- */

// GEMINI (usa Google Generative Language v1beta como en tu código)
async function callGemini(prompt, image_url) {
  if (!GEMINI_API_KEY) {
    return { ok: false, error: "Falta GEMINI_API_KEY en .env" };
  }

  const contents = [];
  try {
    if (image_url) {
      const base64 = await getImageBase64FromUrl(image_url);
      const mimeType = getMimeTypeFromUrl(image_url);
      contents.push({
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64,
            },
          },
        ],
      });
    } else {
      contents.push({ parts: [{ text: prompt }] });
    }

    const generateUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const payload = {
      contents,
      generationConfig: { responseModalities: ["TEXT"] },
    };

    const resp = await axios.post(generateUrl, payload, { headers: { "Content-Type": "application/json" }, timeout: 60000 });
    const candidates = resp.data?.candidates || resp.data?.response?.candidates || [];
    if (!candidates || candidates.length === 0) {
      return { ok: true, text: "", debug: resp.data, note: "No candidates" };
    }
    const parts = candidates[0]?.content?.parts || [];
    const texts = parts.filter(p => p && p.text !== undefined && p.text !== null).map(p => p.text.trim()).filter(Boolean);
    const generatedText = texts.join("\n\n");
    return { ok: true, text: generatedText, meta: { finishReason: candidates[0]?.finishReason } };
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    return { ok: false, error: "Gemini error: " + detail };
    }
}

// DEEPSEEK (OpenRouter)
async function callDeepseek(prompt) {
  if (!OPENROUTER_API_KEY) {
    return { ok: false, error: "Falta OPENROUTER_API_KEY en .env" };
  }
  try {
    const body = {
      model: "deepseek/deepseek-chat-v3.1:free",
      messages: [{ role: "user", content: prompt }],
    };
    const resp = await axios.post("https://openrouter.ai/api/v1/chat/completions", body, {
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      timeout: 60000,
    });
    const text = resp.data?.choices?.[0]?.message?.content || JSON.stringify(resp.data).slice(0, 2000);
    return { ok: true, text, meta: resp.data?.usage ?? null };
  } catch (err) {
    const detail = err.response?.data || err.message;
    return { ok: false, error: "Deepseek error", detail };
  }
}

// CHATGPT simulado (por ahora no hace llamada externa, devuelve respuesta simulada)
// Simulamos latencia variable para que el cliente vea mensajes a tiempos distintos.
async function callChatGPT(prompt, image_url) {
  try {
    const wait = Math.floor(Math.random() * 2500) + 300; // 300ms - 2800ms
    await new Promise((r) => setTimeout(r, wait));
    let text = `Simulated ChatGPT response to: "${prompt}"`;
    if (image_url) text += `\n[Simulación detectó una imagen en: ${image_url}]`;
    text += `\n\n(Nota: esta es una respuesta simulada porque aún no tienes la API real conectada.)`;
    return { ok: true, text, simulated: true, latencyMs: wait };
  } catch (err) {
    return { ok: false, error: "ChatGPT simulation error", detail: err.message };
  }
}

/* ---------------------------
   Ruta única: POST /
   Body esperado:
     { prompt?: string, image_url?: string, model?: 'g'|'c'|'d' }
   Si model omitido -> intenta los 3 (esperará por los 3).
   Si model es 'g'|'c'|'d' -> solo ejecuta ese modelo (recomendado para no bloquear)
   --------------------------- */

app.post("/", async (req, res) => {
  const incomingPrompt = (req.body?.prompt || "").toString().trim();
  const image_url = req.body?.image_url || "";
  const model = req.body?.model; // 'g','c','d' o undefined

  const prompt = incomingPrompt || "Can you solve this?";

  // Map codes a nombres
  const mapName = { g: "GEMINI", c: "CHATGPT", d: "DEEPSEEK" };

  // Si se solicita un modelo específico -> llamar solo a ese
  if (model && typeof model === "string") {
    try {
      if (model === "g") {
        const out = await callGemini(prompt, image_url);
        return res.json({ model: "g", name: mapName.g, request: { prompt, image_url }, ...out });
      } else if (model === "d") {
        const out = await callDeepseek(prompt);
        return res.json({ model: "d", name: mapName.d, request: { prompt }, ...out });
      } else if (model === "c") {
        const out = await callChatGPT(prompt, image_url);
        return res.json({ model: "c", name: mapName.c, request: { prompt, image_url }, ...out });
      } else {
        return res.status(400).json({ ok: false, error: "Modelo no soportado. Usa 'g','c' o 'd'." });
      }
    } catch (err) {
      return res.status(500).json({ ok: false, error: "Error interno", detail: err.message || err });
    }
  }

  // Si no se indica modelo: ejecutar los 3 en paralelo y devolver objeto con los 3 resultados.
  try {
    const [geminiRes, chatRes, deepseekRes] = await Promise.allSettled([
      callGemini(prompt, image_url),
      callChatGPT(prompt, image_url),
      callDeepseek(prompt),
    ]);
    const normalize = (r) => (r.status === "fulfilled" ? r.value : { ok: false, error: "Request failed", detail: r.reason });
    return res.json({
      ok: true,
      request: { prompt, image_url, model: "all" },
      results: {
        g: normalize(geminiRes),
        c: normalize(chatRes),
        d: normalize(deepseekRes),
      },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Error en ejecución múltiple", detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor unificado corriendo en http://localhost:${PORT}`);
  console.log("RUTA única: POST http://localhost:" + PORT + "  (body JSON: { prompt, image_url, model })");
});
