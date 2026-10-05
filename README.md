# Add-on Member Guard untuk BotPanjenenganCustom

Hanya **menambah file baru**, tidak ada file bot yang diubah:

```
lib/memberGuard.js              jembatan ke API member-guard
handle/memberGuard.js           sesi pendaftaran di chat pribadi + pengirim laporan ke grup admin
plugins/AKUN X/akunx.js         perintah member
plugins/AKUN X/akunx-admin.js   perintah admin
```

Bot WA tidak perlu berada di VPS yang sama. Add-on menghubungi **API member-guard** lewat internet (port `API_PORT`, dijaga `API_KEY`).

## Pasang

1. Di VPS member-guard: isi `API_PORT=8787` dan `API_KEY=` (buat dengan `openssl rand -hex 24`) di `.env`, buka port di firewall (`ufw allow 8787/tcp` kalau pakai ufw), lalu `pm2 restart guard-tg`.
2. Salin keempat file ke folder bot WA dengan struktur yang sama.
3. Di Railway → service bot → **Variables**, tambahkan:
   - `MEMBER_GUARD_URL` = `http://IP_VPS:8787`
   - `MEMBER_GUARD_KEY` = isi `API_KEY` yang sama
   Jangan tulis kunci di file, karena repo bot bersifat publik.
4. Commit & push file add-on ke GitHub, Railway akan deploy ulang.
5. Di grup member, kirim `.mgidgrup` (owner / admin grup), salin JID-nya ke `WA_GROUP_JID` di `.env` member-guard, lalu `pm2 restart guard-tg`.
6. Pastikan bot adalah **admin di grup member**. Laporan kick dikirim ke `GROUP_LAPORAN` di `config.js` bot (atau `WA_ADMIN_GROUP_JID`).

## Perintah member (chat pribadi ke bot)

| Perintah | Fungsi |
|---|---|
| `.daftar` | bot meminta username; balas langsung (tanpa titik), boleh beberapa sekaligus |
| `.daftar akun1 akun2` | daftar langsung |
| `.akunku` | lihat akun & statusnya |
| `.hapusakun akun` | hapus akun sendiri |

Hanya anggota grup member yang bisa mendaftar. Akun yang sudah diklaim orang lain ditolak dan admin diberi tahu.

## Perintah admin

Admin = owner bot, anggota grup admin (`GROUP_LAPORAN`), admin grup member, atau nomor di `WA_ADMIN_NUMBERS`.

| Perintah | Fungsi |
|---|---|
| `.mg` | daftar perintah |
| `.mgstatus` | ringkasan |
| `.mgcek` | scan grup DM X sekarang (dijalankan guard-tg) |
| `.mglaporan [id]` | tampilkan laporan |
| `.mgkick ID` / `.mgkick ID -2 -5` / `.mgkick ID paksa` | eksekusi kick |
| `.mgbatal ID` | batalkan laporan |
| `.mgbelum` / `.mgkickbelum` | member yang belum mendaftar / buat laporan kick-nya |
| `.mgpemilik akun` | pemilik akun X |
| `.mgtambah @member akun1 akun2` | daftarkan atas nama member |
| `.mglepas akun` | lepas akun dari pemiliknya |
| `.mgidgrup` | JID grup tempat perintah dikirim |
