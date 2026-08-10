/**
 * Custom API wrapper - pengganti api-autoresbot
 * Interface sama: get(), getBuffer(), tmpUpload()
 */
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import config from '../config.js';
import yts from 'yt-search';

class CustomApi {
  constructor(apiKey = null) {
    // apiKey diabaikan, kita pakai key dari config
    this.geminiKey = config.GEMINI_API_KEY || '';
    this.groqKey = config.GROQ_API_KEY || '';
    this.removebgKey = config.REMOVEBG_API_KEY || '';
  }

  /**
   * GET JSON - pengganti api.get()
   */
  async get(endpoint, params = {}) {
    // Routing berdasarkan endpoint
    if (endpoint.includes('/gemini') || endpoint.includes('/ai')) {
      return this.handleGemini(params);
    }
    if (endpoint.includes('/simi')) {
      return this.handleSimi(params);
    }
    if (endpoint.includes('/ytplay') || endpoint.includes('/ytmp3') || endpoint.includes('/downloader/yt')) {
      return this.handleYtDownload(params);
    }
    if (endpoint.includes('/tiktok')) {
      return this.handleTiktok(params);
    }
    if (endpoint.includes('/instagram') || endpoint.includes('/ig')) {
      return this.handleInstagram(params);
    }
    if (endpoint.includes('/pinterest')) {
      return this.handlePinterest(params);
    }
    if (endpoint.includes('/spotify')) {
      return this.handleSpotify(params);
    }
    if (endpoint.includes('/facebook') || endpoint.includes('/fb')) {
      return this.handleFacebook(params);
    }

    // Default: error yang jelas
    throw new Error(`Endpoint belum diimplementasikan: ${endpoint}. Silakan tambahkan handler di lib/customApi.js`);
  }

  /**
   * GET BUFFER (gambar/audio/video) - pengganti api.getBuffer()
   */
  async getBuffer(endpoint, params = {}) {
    if (endpoint.includes('/wanted') || endpoint.includes('/wasted') || endpoint.includes('/maker/')) {
      return this.handleMakerBuffer(endpoint, params);
    }
    if (endpoint.includes('/removebg') || endpoint.includes('/remini')) {
      return this.handleImageProcess(endpoint, params);
    }
    if (endpoint.includes('/attp') || endpoint.includes('/ttp')) {
      return this.handleTextSticker(endpoint, params);
    }

    throw new Error(`Endpoint buffer belum diimplementasikan: ${endpoint}`);
  }

  /**
   * Upload file sementara - pengganti api.tmpUpload()
   * Alternatif: pakai catbox.moe / uguu.se (gratis)
   */
  async tmpUpload(filePath) {
    try {
      const form = new FormData();
      form.append('reqtype', 'fileupload');
      form.append('fileToUpload', fs.createReadStream(filePath));

      const res = await axios.post('https://catbox.moe/user/api.php', form, {
        headers: form.getHeaders(),
        timeout: 60000,
      });

      // catbox return plain text URL
      if (typeof res.data === 'string' && res.data.startsWith('http')) {
        return { status: true, url: res.data.trim() };
      }
      throw new Error('Upload gagal');
    } catch (err) {
      // Fallback uguu.se
      const form2 = new FormData();
      form2.append('files[]', fs.createReadStream(filePath));
      const res2 = await axios.post('https://uguu.se/upload.php', form2, {
        headers: form2.getHeaders(),
        timeout: 60000,
      });
      const url = res2.data?.files?.[0]?.url;
      if (url) return { status: true, url };
      throw err;
    }
  }

  // ========== HANDLER PER FITUR ==========

  async handleGemini(params) {
    const text = params.text || params.q || '';
    if (!this.geminiKey) {
      return { status: false, message: 'GEMINI_API_KEY belum diisi di config.js' };
    }
    try {
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.geminiKey}`,
        {
          contents: [{ parts: [{ text }] }],
        },
        { timeout: 30000 }
      );
      const reply =
        res.data?.candidates?.[0]?.content?.parts?.[0]?.text ||
        'Tidak ada jawaban';
      return { status: true, data: { result: reply, text: reply } };
    } catch (e) {
      return { status: false, message: e.response?.data?.error?.message || e.message };
    }
  }

  async handleSimi(params) {
    // Simi alternatif gratis (bisa diganti)
    const text = params.text || params.q || '';
    try {
      // Contoh pakai Gemini sebagai pengganti Simi
      const gemini = await this.handleGemini({ text: `Jawab singkat dan santai seperti chatbot: ${text}` });
      if (gemini.status) {
        return { status: true, result: gemini.data.result, data: { result: gemini.data.result } };
      }
      return { status: false, message: 'Simi gagal' };
    } catch (e) {
      return { status: false, message: e.message };
    }
  }

  async handleYtDownload(params) {
    // Catatan: ytdl sering broken. Untuk production, pertimbangkan service lain.
    // Di sini return struktur mirip autoresbot agar plugin lama tetap jalan.
    const url = params.url || '';
    const format = params.format || 'm4a';

    // Sementara: return error jelas + instruksi
    // Kamu bisa integrasikan @distube/ytdl-core atau library lain di sini
    return {
      status: false,
      message: 'YT Download: implementasikan dengan library ytdl di customApi.js (lihat panduan)',
      data: { url: null },
    };
  }

  async handleTiktok(params) {
    // Banyak plugin TikTok sudah pakai lib/scrape/tiktok.js
    // Kalau ada yang masih lewat API, arahkan ke scrape lokal
    throw new Error('Gunakan lib/scrape/tiktok.js untuk TikTok (sudah ada di project)');
  }

  async handleInstagram(params) {
    return { status: false, message: 'Instagram: tambahkan scraper di customApi.js' };
  }

  async handlePinterest(params) {
    return { status: false, message: 'Pinterest: tambahkan handler di customApi.js' };
  }

  async handleSpotify(params) {
    return { status: false, message: 'Spotify: tambahkan handler di customApi.js' };
  }

  async handleFacebook(params) {
    return { status: false, message: 'Facebook: tambahkan handler di customApi.js' };
  }

  async handleMakerBuffer(endpoint, params) {
    // Wanted / Wasted dll bisa diganti dengan canvas + jimp lokal
    // Untuk sementara throw agar jelas
    throw new Error(`Maker ${endpoint}: implementasikan dengan canvas/jimp lokal`);
  }

  async handleImageProcess(endpoint, params) {
    if (endpoint.includes('removebg') && this.removebgKey) {
      const url = params.url;
      const form = new FormData();
      form.append('image_url', url);
      form.append('size', 'auto');
      const res = await axios.post('https://api.remove.bg/v1.0/removebg', form, {
        headers: {
          ...form.getHeaders(),
          'X-Api-Key': this.removebgKey,
        },
        responseType: 'arraybuffer',
        timeout: 60000,
      });
      return Buffer.from(res.data);
    }
    throw new Error('RemoveBG key belum diisi atau endpoint belum didukung');
  }

  async handleTextSticker(endpoint, params) {
    throw new Error('ATTP/TTP: gunakan library lokal wa-sticker-formatter / canvas');
  }
}

export default CustomApi;