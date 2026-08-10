import axios from "axios";
import { logCustom } from "../../lib/logger.js";

async function handle(sock, messageInfo) {
  const { remoteJid, message, content, prefix, command } = messageInfo;

  try {
    if (!content.trim()) {
      return await sock.sendMessage(
        remoteJid,
        {
          text: `_⚠️ Format:_ *${prefix + command} kucing lucu di luar angkasa*`,
        },
        { quoted: message }
      );
    }

    await sock.sendMessage(remoteJid, {
      react: { text: "⏰", key: message.key },
    });

    const prompt = encodeURIComponent(content.trim());
    // Pollinations gratis, tanpa API key
    const imageUrl = `https://image.pollinations.ai/prompt/${prompt}?width=1024&height=1024&nologo=true`;

    // Download dulu biar WA stabil
    const res = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      timeout: 60000,
    });

    await sock.sendMessage(
      remoteJid,
      {
        image: Buffer.from(res.data),
        caption: `🎨 *AI Image*\n📝 ${content.trim()}`,
      },
      { quoted: message }
    );
  } catch (error) {
    console.error("Error AIIMG:", error.message);
    logCustom("info", content, `ERROR-COMMAND-${command}.txt`);

    return await sock.sendMessage(
      remoteJid,
      { text: `_⚠️ Gagal generate gambar:_\n${error.message}` },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["aiimg", "img", "gambarai"],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 1,
};