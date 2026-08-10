import axios from "axios";
import config from "../../config.js";
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
          } siapa penemu lampu*_`,
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
        messages: [{ role: "user", content: content }],
        temperature: 0.7,
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
        { text: "Maaf, tidak ada respons dari AI." },
        { quoted: message }
      );
    }

    return await sock.sendMessage(
      remoteJid,
      { text: jawaban },
      { quoted: message }
    );
  } catch (error) {
    console.error("Error AI:", error.response?.data || error.message);
    logCustom("info", content, `ERROR-COMMAND-${command}.txt`);

    const pesanError =
      error.response?.data?.error?.message ||
      error.message ||
      "Terjadi kesalahan";

    return await sock.sendMessage(
      remoteJid,
      { text: `_⚠️ Gagal AI:_\n${pesanError}` },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["ai"],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 1,
  OnlyAdmin: false,
  OnlyGroup: false,
  OnlyPrivate: false,
};