import axios from "axios";
import config from "../../config.js";
import { textToAudio } from "../../lib/features.js";
import { logCustom } from "../../lib/logger.js";

async function handle(sock, messageInfo) {
  const { remoteJid, message, prefix, command, content } = messageInfo;

  try {
    if (!content.trim()) {
      return await sock.sendMessage(
        remoteJid,
        {
          text: `_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ _*${
            prefix + command
          } penemu facebook*_`,
        },
        { quoted: message }
      );
    }

    if (!config.GROQ_API_KEY) {
      return await sock.sendMessage(
        remoteJid,
        { text: "_⚠️ GROQ_API_KEY belum diisi di config.js_" },
        { quoted: message }
      );
    }

    await sock.sendMessage(remoteJid, {
      react: { text: "⏰", key: message.key },
    });

    // 1) Jawab singkat pakai Groq
    const res = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content:
              "Jawab pertanyaan user dalam bahasa Indonesia, sangat singkat (maksimal 2 kalimat). Jangan pakai markdown.",
          },
          {
            role: "user",
            content: content,
          },
        ],
        temperature: 0.7,
        max_tokens: 150,
      },
      {
        headers: {
          Authorization: `Bearer ${config.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    const jawaban = res.data?.choices?.[0]?.message?.content?.trim();
    if (!jawaban) {
      return await sock.sendMessage(
        remoteJid,
        { text: "Maaf, tidak ada respons dari AI." },
        { quoted: message }
      );
    }

    // 2) Ubah jawaban jadi suara (TTS gratis)
    const bufferAudio = await textToAudio(jawaban);
    if (!bufferAudio) {
      // Kalau TTS gagal, kirim teks saja
      return await sock.sendMessage(
        remoteJid,
        { text: jawaban },
        { quoted: message }
      );
    }

    return await sock.sendMessage(
      remoteJid,
      { audio: bufferAudio, mimetype: "audio/mp4" },
      { quoted: message }
    );
  } catch (error) {
    console.error("Error VoiceAI:", error.response?.data || error.message);
    logCustom("info", content, `ERROR-COMMAND-${command}.txt`);

    const pesanError =
      error.response?.data?.error?.message ||
      error.message ||
      "Terjadi kesalahan";

    return await sock.sendMessage(
      remoteJid,
      { text: `_⚠️ Gagal VoiceAI:_\n${pesanError}` },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["voiceai"],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 1,
};