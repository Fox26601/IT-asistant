import { config } from "../config.js";
import { getGemini, mimeFromFilename } from "../llm/gemini.js";

/** Describe an image for dialogue context (base64 or remote URL). */
export async function describePhoto(input: {
  url?: string;
  base64?: string;
  mimeType?: string;
}): Promise<string> {
  let base64 = input.base64;
  let mime = input.mimeType || "image/jpeg";

  if (!base64 && input.url) {
    const res = await fetch(input.url);
    if (!res.ok) {
      throw new Error(`Failed to download image: ${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    base64 = buf.toString("base64");
    const ct = res.headers.get("content-type");
    if (ct?.startsWith("image/")) mime = ct.split(";")[0].trim();
    else mime = mimeFromFilename(input.url);
  }

  if (!base64) return "(no image description)";

  const model = getGemini().getGenerativeModel({ model: config.geminiModel });
  const result = await model.generateContent([
    {
      text: "Describe this client-provided image briefly for a booking assistant: subject, mood, clothing/style, and any booking-relevant cues. Do not invent identity. Keep under 120 words.",
    },
    { inlineData: { mimeType: mime, data: base64 } },
  ]);

  return result.response.text()?.trim() || "(no image description)";
}
