import { downloadQuotedMedia, downloadMedia } from "../../lib/utils.js";
import fs from "fs";
import path from "path";
import { Jimp } from "jimp";

async function handle(sock, messageInfo) {
  const { remoteJid, message, prefix, command, type, isQuoted } = messageInfo;

  try {
    const mediaType = isQuoted ? isQuoted.type : type;
    if (mediaType !== "image") {
      return await sock.sendMessage(
        remoteJid,
        {
          text: `⚠️ _Kirim/Balas gambar dengan caption *${prefix + command}*_`,
        },
        { quoted: message }
      );
    }

    await sock.sendMessage(remoteJid, {
      react: { text: "⏰", key: message.key },
    });

    const media = isQuoted
      ? await downloadQuotedMedia(message)
      : await downloadMedia(message);

    const mediaPath = path.join("tmp", media);
    if (!fs.existsSync(mediaPath)) {
      return await sock.sendMessage(
        remoteJid,
        { text: "❌ File gambar tidak ditemukan." },
        { quoted: message }
      );
    }

    const image = await Jimp.read(mediaPath);

    // Efek WASTED: gelap + kehijauan (bukan hitam total)
    image.scan(0, 0, image.bitmap.width, image.bitmap.height, function (x, y, idx) {
      const r = this.bitmap.data[idx + 0];
      const g = this.bitmap.data[idx + 1];
      const b = this.bitmap.data[idx + 2];

      // grayscale
      let gray = 0.3 * r + 0.59 * g + 0.11 * b;

      // sedikit gelap, tapi jangan sampai hitam
      gray = gray * 0.75;
      if (gray < 20) gray = 20;

      // tint hijau GTA-style
      let nr = gray * 0.85;
      let ng = gray * 1.05;
      let nb = gray * 0.85;
      if (nr > 255) nr = 255;
      if (ng > 255) ng = 255;
      if (nb > 255) nb = 255;

      this.bitmap.data[idx + 0] = nr;
      this.bitmap.data[idx + 1] = ng;
      this.bitmap.data[idx + 2] = nb;
    });

    const buffer = await image.getBuffer("image/jpeg");

    await sock.sendMessage(
      remoteJid,
      {
        image: buffer,
        caption: "💀 *WASTED*",
      },
      { quoted: message }
    );
  } catch (error) {
    console.error("Error Wasted:", error.message);
    return await sock.sendMessage(
      remoteJid,
      { text: `_⚠️ Gagal Wasted:_\n${error.message}` },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["wasted"],
  OnlyPremium: false,
  OnlyOwner: false,
};