import OpenAI from "openai";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

/** Transcribe voice/audio bytes with Whisper. */
export async function transcribeAudio(
  buffer: Buffer,
  filename = "voice.ogg"
): Promise<string> {
  const openai = getClient();
  const dir = mkdtempSync(join(tmpdir(), "sales-agent-audio-"));
  const path = join(dir, filename);
  writeFileSync(path, buffer);
  try {
    const file = await OpenAI.toFile(buffer, filename);
    const res = await openai.audio.transcriptions.create({
      file,
      model: config.openaiTranscribeModel,
    });
    return (res.text || "").trim() || "(empty transcript)";
  } finally {
    try {
      unlinkSync(path);
    } catch {
      /* ignore */
    }
  }
}
