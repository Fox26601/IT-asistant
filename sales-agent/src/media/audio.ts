import { config } from "../config.js";
import { getGemini, mimeFromFilename } from "../llm/gemini.js";

/** Transcribe voice/audio bytes with Gemini multimodal. */
export async function transcribeAudio(
  buffer: Buffer,
  filename = "voice.ogg"
): Promise<string> {
  const mime = mimeFromFilename(filename);
  const model = getGemini().getGenerativeModel({ model: config.geminiModel });
  const result = await model.generateContent([
    {
      text: "Transcribe this voice message verbatim. Return only the transcript text, no commentary. If unclear, return the best-effort transcript.",
    },
    {
      inlineData: {
        mimeType: mime.startsWith("audio/") ? mime : "audio/ogg",
        data: buffer.toString("base64"),
      },
    },
  ]);

  return result.response.text()?.trim() || "(empty transcript)";
}
