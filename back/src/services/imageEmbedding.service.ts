import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";

import { env } from "../config/env.js";

const MODEL = "gemini-embedding-2";
const EMBEDDING_DIMENSIONS = 768;

export async function embedImage(bytes: Buffer, mimeType: string): Promise<number[]> {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY n'est pas configurée.");
  }

  if (!mimeType.startsWith("image/")) {
    throw new Error("Le fichier transmis n'est pas une image.");
  }
  const analysisImage = await sharp(bytes, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();

  const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const response = await client.models.embedContent({
    model: MODEL,
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: analysisImage.toString("base64"),
            },
          },
        ],
      },
    ],
    config: { outputDimensionality: EMBEDDING_DIMENSIONS },
  });

  const vector = response.embeddings?.[0]?.values;
  if (
    !vector ||
    vector.length !== EMBEDDING_DIMENSIONS ||
    vector.some((value) => typeof value !== "number" || !Number.isFinite(value))
  ) {
    throw new Error("Gemini a renvoyé une empreinte visuelle invalide.");
  }
  return vector;
}
