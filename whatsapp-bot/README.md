# Bot WhatsApp Grup Ogi Resto

Worker terpisah memakai Baileys untuk membaca foto dengan caption /bayar pada grup yang
diizinkan. Bot memakai perangkat tertaut, bukan nomor uji Meta atau access token Cloud API.
Integrasi ini bukan API resmi WhatsApp.

## Peran dan alur

Grup -> parser -> antrean lokal terenkripsi -> createPaymentHistory backend ->
RPC Supabase -> history_payments dan, bila cocok, waiting dipindah ke orders.
Frontend membaca status melalui API. Worker tidak bergantung pada URL frontend atau tunnel.

Foto tidak diunduh/disimpan aplikasi. Bukti tetap di WhatsApp. Laporan bukan pemeriksaan
mutasi bank, isi gambar, kepemilikan identitas, atau pelunasan kasbon bulanan otomatis.

## Persiapan

- Node.js 22.13+ dan npm.
- Nomor khusus yang aktif di WhatsApp HP dan menjadi anggota grup tujuan.
- SUPABASE_URL dan SUPABASE_KEY service_role/secret di backend/.env.
- Database dan migrasi 001-007; worker tidak menerapkan SQL otomatis.

Dari backend:

~~~powershell
npm.cmd --prefix whatsapp-bot ci
npm.cmd run bot:check
~~~

Dependensi worker terpisah dari API. Baileys dipatok 7.0.0-rc14 dan lockfile mengunci
dependency. bot:check tidak menghubungkan WhatsApp atau menulis pembayaran.

## Environment

~~~dotenv
WA_GROUP_BOT_ENABLED=true
WA_GROUP_BOT_ALLOWED_GROUPS=120363428750745836@g.us
WA_GROUP_BOT_SESSION_KEY=ISI_KUNCI_HEX_64_KARAKTER_ANDA
~~~

ID di atas adalah Ogi Resto III yang dipilih. Untuk instalasi lain, gunakan hasil
bot:groups. Beberapa ID dipisahkan koma; nama/tautan undangan bukan ID grup.

Buat kunci sekali untuk instalasi baru:

~~~powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
~~~

Simpan hasil hanya di .env. Kunci harus tetap sama agar state/antrean dapat dibuka saat restart.
Jangan membagikan key, QR, kode penautan atau data sesi.

## Tautkan nomor

~~~powershell
npm.cmd run bot:code
~~~

Masukkan nomor bot seperti 6281234567890. Di HP: WhatsApp -> Perangkat tertaut ->
Tautkan perangkat -> Tautkan dengan nomor telepon saja. Masukkan kode dari terminal.
Kode itu bukan OTP SMS.

Alternatif QR:

~~~powershell
npm.cmd run bot:groups
~~~

Buka URL pairing lokal pada komputer yang menjalankan bot dan pindai melalui Perangkat
tertaut. Halaman pairing hanya loopback; jangan ditunnel. QR pairing bukan QRIS pembayaran.
Nama perangkat Chrome/Mac OS dapat berasal dari identitas klien bot.

## Lihat grup dan jalankan

Hentikan worker sebelumnya dengan Ctrl+C. Hanya satu proses boleh memakai state yang sama.

~~~powershell
npm.cmd run bot:groups
~~~

Mode daftar berhenti setelah menampilkan nama/ID; tidak mencatat pembayaran.
Salin ID ke WA_GROUP_BOT_ALLOWED_GROUPS, lalu:

~~~powershell
npm.cmd run bot:wa
~~~

Tunggu WhatsApp terhubung dan grup terverifikasi. Biarkan terminal hidup.
Worker tidak perlu tunnel; frontend/API tetap dijalankan sendiri.
Jika logout/bad session, bot:pair mereset autentikasi lokal untuk penautan ulang,
bukan menghapus antrean pembayaran.

## Format laporan

Dari akun anggota lain, kirim satu foto dengan caption:

~~~text
/bayar
Budi Santoso
PT Contoh
Produksi
~~~

Tepat empat baris isi. Perusahaan tetap satu baris; pembungkusan visual WA tidak masalah.
Pesan dari nomor bot sendiri, chat pribadi, teks terpisah, foto sekali lihat, riwayat
lama yang disinkronkan, dan grup lain diabaikan. Bot tidak mengirim balasan chat.

## Penyimpanan dan konsistensi

- Waktu awal penerimaan worker dipakai untuk tanggal WIB dan retry antrean.
- Pesan ditulis ke antrean terenkripsi sebelum Supabase.
- ID berisi namespace Baileys dan hash grup/pengirim/ID untuk deduplikasi.
- Database gagal: item tetap antre dan dicoba lagi setiap lima detik.
- Identitas yang cocok hanya menyelesaikan waiting yang sudah dibuat sebelum waktu penerimaan.
- History, insert order, status dan penghapusan waiting berada dalam satu transaksi.
- Replay yang telah tercatat tidak menyelesaikan waiting berikutnya.
- Pesan tanpa waiting yang cocok dapat dicatat sebagai history saja.
- Soft delete history mempertahankan ID pesan unik.

Kasbon bulanan dikonfirmasi admin terpisah. Gunakan mutasi rekening untuk memverifikasi
pembayaran, bukan hanya keberadaan pesan/foto.

## Hubungan dengan editor order

Admin dapat mengganti menu order selesai dari website. Migrasi 007 menyediakan harga server,
revision, audit dan perlindungan kasbon lunas. Bot tidak mengedit order yang telah selesai.
Jika edit Cash mengubah total, admin mencocokkan selisih dengan pelanggan.

## Keamanan sesi

whatsapp-bot/.state berisi autentikasi, antrean terenkripsi dan lock; diabaikan Git.
Gunakan satu worker dan backup state/key secara privat. Jangan menghapus antrean saat database
gagal karena masih dapat memuat laporan yang belum tersimpan.

Perangkat tertaut memberi akses akun ke proses yang menjalankannya. Gunakan nomor khusus
dan host sendiri. Mencabut akses dilakukan lewat Perangkat tertaut pada HP.
Pembatasan grup adalah batas proses bisnis, bukan jaminan perangkat tidak bisa mengakses
bagian akun lain. Baileys dapat berubah kompatibilitas dan akun dapat dibatasi WhatsApp.

## Troubleshooting

| Gejala | Tindakan |
| --- | --- |
| Tidak ada data | Pastikan bot:wa masih berjalan, bukan mode daftar |
| Tidak ada balasan | Normal; bot tidak membalas chat |
| Pesan dilewati | Akun lain, grup benar, foto+caption empat baris dalam satu pesan |
| QR gagal | Gunakan bot:code |
| Database retry | Periksa koneksi, service key, migrasi dan log tanpa kredensial |
| Masih waiting | Periksa identitas dan waktu laporan; lihat log backend |
| Sesi logout | Tautkan ulang tanpa membagikan kode/QR |

## Pengujian

Dari backend:

~~~powershell
npm.cmd run test:bot
npm.cmd run test:waiting:postgres
~~~

Dari backend/whatsapp-bot:

~~~powershell
npm.cmd audit
~~~

Tes memakai pesan sintetis dan cluster PostgreSQL sementara, bukan pembayaran nyata.
Lihat [backend](../README.md) dan [panduan proyek](../../README.md).

## Jika frontend/API sudah di hosting

Frontend dapat berupa out statis di Netlify/Vercel; API HTTP dapat berada di Vercel dengan
Supabase. Worker ini tetap berjalan terpisah pada komputer/VPS/worker host yang terus hidup.

Worker memerlukan koneksi berkelanjutan, folder .state persisten, kunci sesi tetap, dan satu
proses untuk state tersebut. Jangan menjalankan bot melalui Vercel Functions, request API,
atau build frontend. Jika API sudah di Vercel, host bot tidak perlu menjalankan npm start:
cukup dependency backend/worker dan npm run bot:wa dengan environment Supabase yang sama.

Bot tidak membutuhkan URL publik/tunnel. Jika host bot mati, otomatisasi WA berhenti,
tetapi website/API dan input manual admin tetap dapat digunakan.

## Pencocokan identitas tanpa membedakan huruf besar-kecil

Nama, perusahaan dan divisi dicocokkan tanpa membedakan kapital, misalnya Hanan/hanan,
PT Contoh/pt contoh dan HR/hr. Penulisan asli tetap ditampilkan. Filter, akumulasi harian,
ringkasan, CSV, kasbon dan pencocokan laporan WA menggunakan aturan tersebut.
Perusahaan/divisi/tanggal yang berbeda tetap dipisahkan. Kunci pelunasan lama tidak diubah,
dan laporan pembayaran terpisah tidak dihapus atau digabung secara fisik.
