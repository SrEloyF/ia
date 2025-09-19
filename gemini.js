import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import { get } from "https";
import path from "path";
import mime from "mime-types";
import cors from "cors";
dotenv.config();

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error("Falta GEMINI_API_KEY en .env");
  process.exit(1);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Obtener imagen desde URL y convertir a base64
async function getImageBase64FromUrl(imageUrl) {
  return new Promise((resolve, reject) => {
    get(imageUrl, (response) => {
      if (response.statusCode !== 200) {
        return reject(new Error(`Error al descargar imagen. Código HTTP: ${response.statusCode}`));
      }
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const buffer = Buffer.concat(chunks);
        resolve(buffer.toString("base64"));
      });
      response.on("error", reject);
    }).on("error", reject);
  });
}

function getMimeTypeFromUrl(url) {
  // intenta extraer extensión y resolver mime, si falla, "application/octet-stream"
  const ext = path.extname(url).toLowerCase();
  return mime.lookup(ext) || "application/octet-stream";
}

app.post("/chat", async (req, res) => {
  try {
    const { prompt, image_url } = req.body;

    if (!prompt) {
      return res.status(400).json({
        ok: false,
        message: "Se requiere el 'prompt' en el cuerpo de la solicitud.",
      });
    }

    // Si hay 'image_url', obtenemos la imagen en base64
    let contents = [
      {
        parts: [{ text: prompt }],
      },
    ];

    if (image_url) {
      // Obtener imagen base64
      const base64Image = await getImageBase64FromUrl(image_url);
      const mimeType = getMimeTypeFromUrl(image_url);

      // Añadir la imagen a 'contents'
      contents = [
        {
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: mimeType,
                data: base64Image,
              },
            },
          ],
        },
      ];
    }

    // --- Count tokens ---
    const countUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:countTokens?key=${GEMINI_API_KEY}`;
    const countTokensResponse = await axios.post(countUrl, { contents }, {
      headers: { "Content-Type": "application/json" },
    });
    console.log("Tokens (countTokens):", countTokensResponse.data?.totalTokens);

    // --- Generar contenido ---
    const generateUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const payload = {
      contents,
      generationConfig: {
        responseModalities: ["TEXT"], // solo texto
      },
    };

    const generateResponse = await axios.post(generateUrl, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 60_000,
    });

    // Obtener candidatos
    const candidates =
      generateResponse.data?.candidates ||
      generateResponse.data?.response?.candidates ||
      generateResponse.data?.response?.output?.candidates ||
      generateResponse.data?.output?.candidates ||
      [];

    if (!candidates || candidates.length === 0) {
      console.warn("No se obtuvieron candidatos. generateResponse.data:", generateResponse.data);
      return res.status(200).json({
        ok: true,
        message: "No se generó texto (no hay candidatos)",
        text: "",
        totalTokens: countTokensResponse.data?.totalTokens,
        debug: { generateResponse: generateResponse.data },
      });
    }

    // Extraer el texto generado
    const firstContentParts = candidates[0]?.content?.parts || [];
    const textParts = firstContentParts
      .filter((p) => p && (p.text !== undefined && p.text !== null))
      .map((p) => p.text.trim())
      .filter(Boolean);

    const generatedText = textParts.join("\n\n");

    res.status(200).json({
      ok: true,
      message: "Texto generado",
      text: generatedText,
      totalTokens: countTokensResponse.data?.totalTokens,
      debug: {
        candidateFinishReason: candidates[0]?.finishReason,
        candidateHasInlineData:
          firstContentParts.some((p) => p.inline_data !== undefined),
      },
    });
  } catch (err) {
    console.error("Error al procesar:", err?.message || err);
    if (err.response) {
      console.error("Status:", err.response.status);
      console.error("Data:", err.response.data);
    }
    res.status(500).json({
      ok: false,
      message: "Error interno al procesar la imagen",
      details: err.message,
      ...(err.response ? { apiResponse: err.response.data } : {}),
    });
  }
});


app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
