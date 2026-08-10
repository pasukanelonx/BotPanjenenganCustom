import fs from "fs/promises";
import path from "path";
import { textToAudio } from "../../lib/features.js";
import { logCustom } from "../../lib/logger.js";
import {
  convertAudioToOpus,
  generateUniqueFilename,
} from "../../lib/utils.js";

async function handle(sock, messageInfo) {
  const { remoteJid, message, content, prefix, command, isQuoted } =
    messageInfo;

  const text =
    content && content.trim() !== "" ? content : isQuoted?.text ?? null;

  try {
    if (!text || text.trim().length < 1) {
      return await sock.sendMessage(
        remoteJid,
        {
          text: `_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ _*${
            prefix + command
          } halo google*_`,
        },
        { quoted: message }
      );
    }

    await sock.sendMessage(remoteJid, {
      react: { text: "⏰", key: message.key },
    });

    // TTS gratis (Google Translate)
    const bufferOriginal = await textToAudio(text);

    if (!bufferOriginal) {
      return await sock.sendMessage(
        remoteJid,
        { text: "_⚠️ Gagal membuat suara. Coba teks lebih pendek._" },
        { quoted: message }
      );
    }

    const inputPath = path.join(process.cwd(), generateUniqueFilename());
    await fs.writeFile(inputPath, bufferOriginal);

    let bufferFinal = bufferOriginal;

    try {
      const convertedPath = await convertAudioToOpus(inputPath);
      bufferFinal = await fs.readFile(convertedPath);
    } catch (err) {
      console.warn("[VN] Konversi opus gagal, pakai audio asli:", err.message);
    }

    await sock.sendMessage(
      remoteJid,
      {
        audio: bufferFinal,
        mimetype: "audio/mp4",
        ptt: true,
      },
      { quoted: message }
    );
  } catch (error) {
    console.error("Error VN:", error.message);
    logCustom("error", text, `ERROR-COMMAND-${command}.txt`);

    return await sock.sendMessage(
      remoteJid,
      { text: `_⚠️ Gagal VN:_\n${error.message}` },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["vn"],
  OnlyPremium: false,
  OnlyOwner: false,
};