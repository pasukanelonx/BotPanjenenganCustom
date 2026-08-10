import { textToAudio } from "../../lib/features.js";
import { logCustom } from "../../lib/logger.js";

async function handle(sock, messageInfo) {
  const { remoteJid, message, content, prefix, command, isQuoted } =
    messageInfo;

  const text = content?.trim() || isQuoted?.text?.trim() || null;

  if (!text || text.length < 1) {
    return sock.sendMessage(
      remoteJid,
      {
        text: `_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ _*${prefix}${command} halo google*_`,
      },
      { quoted: message }
    );
  }

  try {
    await sock.sendMessage(remoteJid, {
      react: { text: "⏰", key: message.key },
    });

    // TTS gratis (pengganti /api/sound/textanime)
    const audioBuffer = await textToAudio(text);

    if (!audioBuffer) {
      return await sock.sendMessage(
        remoteJid,
        { text: "_⚠️ Gagal membuat suara. Coba teks lebih pendek._" },
        { quoted: message }
      );
    }

    await sock.sendMessage(
      remoteJid,
      {
        audio: audioBuffer,
        mimetype: "audio/mp4",
        ptt: true,
      },
      { quoted: message }
    );
  } catch (error) {
    logCustom("error", text, `ERROR-COMMAND-${command}.txt`);
    console.error("Error VNAnime:", error.message);

    return await sock.sendMessage(
      remoteJid,
      { text: `_⚠️ Gagal VNAnime:_\n${error.message}` },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["vnanime"],
  OnlyPremium: false,
  OnlyOwner: false,
};