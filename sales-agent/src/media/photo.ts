import OpenAI from "openai";
import { config } from "../config.js";

let client: OpenAI | null = null;

function getClient() {
  if (!client) {
    client = new OpenAI({
      apiKey: config.openaiApiKey,
      baseURL: config.openaiBaseUrl,
    });
  }
  return client;
}

/** Describe an image for dialogue context (base64 or remote URL). */
export async function describePhoto(input: {
  url?: string;
  base64?: string;
  mimeType?: string;
}): Promise<string> {
  const openai = getClient();
  const mime = input.mimeType || "image/jpeg";
  const imageUrl = input.url
    ? input.url
    : `data:${mime};base64,${input.base64}`;

  const res = await openai.chat.completions.create({
    model: config.openaiVisionModel,
    max_tokens: 400,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Describe this client-provided image briefly for a booking assistant: subject, mood, clothing/style, and any booking-relevant cues. Do not invent identity. Keep under 120 words.",
          },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
  });

  return res.choices[0]?.message?.content?.trim() || "(no image description)";
}
