import axios from "axios";
import config from "../../config.js";
import { logCustom } from "../../lib/logger.js";

async function handle(sock, messageInfo) {
  const { remoteJid, message, content, prefix, command } = messageInfo;

  try {
    if (!content.trim()) {
      return await sock.sendMessage(
        remoteJid,
        {
          text: `_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ _*${
            prefix + command
          } siapa kamu*_`,
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

    const res = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content:
              "Kamu adalah Simi, chatbot WhatsApp yang santai, lucu, dan ramah. Jawab singkat dalam bahasa Indonesia sehari-hari. Jangan terlalu formal. Jangan bilang kamu AI kecuali ditanya.",
          },
          {
            role: "user",
            content: content,
          },
        ],
        temperature: 0.9,
        max_tokens: 300,
      },
      {
        headers: {
          Authorization: `Bearer ${config.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    const jawaban = res.data?.choices?.[0]?.message?.content;

    if (!jawaban) {
      return await sock.sendMessage(
        remoteJid,
        { text: "Maaf, tidak ada respons dari server." },
        { quoted: message }
      );
    }

    return await sock.sendMessage(
      remoteJid,
      { text: jawaban },
      { quoted: message }
    );
  } catch (error) {
    console.error("Error Simi:", error.response?.data || error.message);
    logCustom("info", content, `ERROR-COMMAND-${command}.txt`);

    const pesanError =
      error.response?.data?.error?.message ||
      error.message ||
      "Terjadi kesalahan";

    return await sock.sendMessage(
      remoteJid,
      { text: `_⚠️ Gagal Simi:_\n${pesanError}` },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["simi"],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 1,
};