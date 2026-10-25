# Ogi Resto Backend

Express API untuk menu, checkout, waiting pembayaran, riwayat, kasbon, CSV, dan edit
item order. Supabase PostgreSQL menjadi penyimpanan utama. Browser tidak mengakses
tabel langsung; backend memakai service_role atau secret key.

## Instalasi

Gunakan Node.js 22.13+ dan npm. Salin .env.example ke .env, isi konfigurasi, lalu:

~~~powershell
npm.cmd ci
npm.cmd start
~~~

| Environment | Fungsi |
| --- | --- |
| PORT | Port, default 5000 |
| SUPABASE_URL | URL proyek Supabase |
| SUPABASE_KEY | service_role/secret key; bukan anon/publishable |
| ADMIN_USERNAME | Username admin |
| ADMIN_PASSWORD | Password admin |
| JWT_SECRET | Rahasia token; gunakan nilai acak panjang |
| WA_GROUP_BOT_ENABLED | Aktivasi worker grup |
| WA_GROUP_BOT_ALLOWED_GROUPS | ID grup yang diizinkan |
| WA_GROUP_BOT_SESSION_KEY | Kunci hex 64 karakter sesi/antrean bot |
| WHATSAPP_VERIFY_TOKEN | Token verifikasi webhook Meta opsional |
| WHATSAPP_APP_SECRET | Pemeriksaan signature Meta |
| WHATSAPP_PHONE_NUMBER_ID | ID nomor penerima Cloud API |
| WHATSAPP_ACCESS_TOKEN | Konfigurasi Meta; bukan sesi Baileys/token admin |

Ketiga variabel admin wajib; login tanpa konfigurasi gagal tertutup. Tidak ada kredensial
fallback. Token HMAC berlaku 24 jam dan diterima melalui header Bearer, bukan query URL.
Jangan menyimpan rahasia pada frontend, README, log publik atau Git.

## Struktur

| Lokasi | Tanggung jawab |
| --- | --- |
| src/server.js | Route, autentikasi, validasi HTTP dan CSV |
| src/db.js | Akses Supabase/RPC dan JSON development |
| src/orderEditing.js | Validasi item/revision, harga server, error edit |
| src/waitingPayments.js | Identitas pending, token hash, pemindahan lokal |
| src/paymentHistory.js | Caption, tanggal WIB dan filter riwayat |
| src/whatsappWebhook.js | Verifikasi/penerimaan Cloud API |
| src/kasbon.js | Identitas karyawan, periode dan ringkasan |
| src/orderGrouping.js | Gabungan per pemesan/tanggal |
| schema.sql | Instalasi baru lengkap dengan seed |
| migrations | Peningkatan struktur bertahap |
| whatsapp-bot | Worker terpisah; [panduan](whatsapp-bot/README.md) |
| tests | Unit, endpoint dan PostgreSQL terisolasi |

Supabase yang sudah dikonfigurasi tetapi gagal tidak dialihkan menjadi sukses JSON lokal.
JSON hanya untuk development tanpa konfigurasi cloud dan tidak mendukung multi-proses.

## Database dan migrasi

Instalasi baru menjalankan schema.sql. Database lama menjalankan migrasi yang belum
diterapkan secara berurutan. Jangan mengeksekusi ulang seed produksi untuk memperbarui kolom.

| Migrasi | Isi |
| --- | --- |
| [001](migrations/001_kasbon_payments.sql) | Kasbon bulanan |
| [002](migrations/002_history_payments.sql) | Riwayat pembayaran |
| [003](migrations/003_history_payments_whatsapp.sql) | ID pesan unik |
| [004](migrations/004_history_payments_management.sql) | Soft delete/metadata |
| [005](migrations/005_waiting_payments.sql) | Waiting, ledger privat, RPC settlement |
| [006](migrations/006_orders_payment_columns.sql) | Kolom orders lama |
| [007](migrations/007_order_item_editing.sql) | Revision, audit, edit item, lock kasbon, hardening menu |

Migrasi tidak dijalankan oleh npm start. Fitur Edit terbaru memerlukan 007 setelah 001-006.

FK: menu_schedules.menu_id -> menus.id; order_item_changes.order_id -> orders.id;
order_payment_status.order_id -> orders.id dan history_payment_id -> history_payments.id.
items JSONB adalah snapshot, bukan FK master menu. Waiting/status memakai order_number
secara logis; kasbon memakai employee_key dan period_month yang unik.

## Endpoint

Prefix /api. Seluruh route /admin memerlukan Authorization: Bearer.

| Method | Route | Fungsi |
| --- | --- | --- |
| POST | /auth/login atau /admin/login | Login |
| GET | /admin/session | Validasi sesi |
| GET | /days, /menu | Hari dan menu pelanggan |
| POST | /orders | Checkout dengan harga master |
| POST | /orders/payment-status | Nomor + token privat dalam body |
| GET | /admin/menus | Katalog/jadwal admin |
| POST/PUT/DELETE | /admin/menus dan turunannya | Kelola master dan jadwal |
| GET | /admin/orders | Order, ringkasan, groupedOrders |
| GET | /admin/orders/export-csv | CSV sesuai filter/mode |
| GET | /admin/orders/:orderNumber/edit | Snapshot dan katalog editor |
| PUT | /admin/orders/:orderNumber/items | Ganti item |
| GET | /admin/waiting-payments | Waiting, 50 baris/halaman |
| POST | /admin/waiting-payments/:orderNumber/pay | Konfirmasi waiting |
| DELETE | /admin/waiting-payments/:orderNumber | Batalkan waiting |
| GET/POST | /admin/history-payments | Daftar/tambah riwayat |
| PUT/DELETE | /admin/history-payments/:id | Koreksi/soft delete |
| GET | /admin/kasbon | Rekap bulanan |
| PUT | /admin/kasbon/payments | Status lunas |
| GET | /admin/kasbon/export-csv | CSV kasbon |
| GET/POST | /webhooks/whatsapp | Verifikasi/pesan Cloud API opsional |

## Harga dan edit pesanan

Checkout menggunakan katalog backend. ID diprioritaskan; nama lama hanya diterima jika
cocok dengan satu menu aktif. Payload nama/harga/total tidak menjadi sumber harga.
Jumlah 1-999, maksimum 50 menu berbeda, total maksimal INTEGER.

Contoh body PUT /admin/orders/ORD-.../items:

~~~json
{
  "revision": 1,
  "items": [
    { "id": "m-1", "qty": 2, "expectedPrice": 5000 }
  ]
}
~~~

expectedPrice hanya mendeteksi perubahan harga. Database menggunakan nama/harga master.
Semua item edit memakai harga terkini. Identitas, lokasi, jadwal, metode bayar, nomor
pesanan dan catatan tidak diterima sebagai perubahan; actor berasal dari sesi admin.

edit_order_items melakukan satu transaksi:
1. Validasi item, jumlah, duplikasi, actor dan revision.
2. Lock identitas/periode dan row order.
3. Tolak revision lama atau kasbon lunas.
4. Lock menu dalam urutan ID stabil, periksa harga pembanding.
5. Hitung subtotal/total dan tulis order_item_changes.
6. Update order; trigger menaikkan revision dan updated_at.
7. Commit bersama. Audit/update yang gagal membatalkan seluruh perubahan.

409 untuk revision/harga berubah atau kasbon lunas; 422 menu tidak tersedia;
400 payload salah; 503 migrasi/koneksi belum tersedia. Reload setelah konflik.
Retry revision lama tidak membuat edit kedua.

Audit menyimpan item/total sebelum/sesudah, order, admin, dan waktu.
Perubahan Cash tidak melakukan penagihan/refund otomatis; admin mencocokkan selisih.

## Settlement dan kasbon

Cash masuk waiting; Kasbon langsung orders. Tombol Bayar dan riwayat cocok menggunakan
RPC atomik untuk memindahkan waiting. Ledger hash/status tetap ada setelah waiting dihapus.
ID pesan unik dan waktu awal antrean melindungi retry yang sudah diterima bot dari
pemindahan order berikutnya. Soft delete mempertahankan ID pesan.

Migrasi 007 memberi lock periode bersama pada edit dan trigger kasbon_payments.
Trigger menghitung ulang kasbon_amount dari orders di bawah lock saat konfirmasi.
Kasbon lunas harus dibuka kembali sebelum item order dapat diedit.
Laporan /bayar tidak memeriksa mutasi bank atau melunasi kasbon bulanan otomatis.

## Filter dan CSV

Daftar/CSV pesanan menggunakan getOrders dengan parameter sama:
search, company, division, location, day, date, startDate, endDate, month, year.
groupBy=customer_day mengekspor ringkasan identitas + tanggal; default detail.
Tanggal menggunakan order_date. Rentang diutamakan daripada tanggal tunggal.
Bulan membutuhkan tahun; UI menyelaraskan pilihan tersebut.

Kasbon list/CSV menggunakan getKasbonOrders(month,year,company,division).
Waiting tidak termasuk CSV orders. CSV memakai BOM UTF-8, pemisah titik koma,
escaping tanda kutip dan proteksi formula spreadsheet. Riwayat pembayaran belum punya CSV.

## Keamanan dan operasi

- Tabel/RPC privat hanya untuk service_role/secret key.
- Setelah 007, policy publik master menu/jadwal lama dihapus.
- SECURITY DEFINER memakai search_path kosong, hak eksekusi publik dicabut.
- Token admin pada header; token pelanggan pada body POST/hash database. Editor/status no-store.
- Session/queue bot berada di proses terpisah dan terenkripsi.
- Rate limit/kontrol akses lapisan hosting, backup dan rotasi kredensial perlu dikelola.
- JSON lokal bukan pengganti transaksi PostgreSQL produksi.
- Pengujian dan audit dependency bukan jaminan tidak ada kerentanan lain.

## Pengujian

~~~powershell
npm.cmd test
npm.cmd run test:bot
npm.cmd run test:waiting:postgres
npm.cmd audit
~~~

Tes PostgreSQL membuat cluster sementara sendiri, bukan Supabase produksi.
Default bin: C:/Program Files/PostgreSQL/17/bin; override melalui OGI_POSTGRES_BIN.
Cakupan: harga palsu, auth, filter CSV, konflik edit, audit/rollback, harga berubah,
konfirmasi bersama, paid kasbon, race edit/pelunasan, serta akses anon/authenticated.
Lihat [VALIDATION.md](VALIDATION.md) untuk hasil verifikasi.

## Deployment Vercel dan stateless

vercel.json backend yang ada menggunakan src/server.js sebagai Express Function.
Ketika VERCEL aktif, modul mengekspor app tanpa app.listen. Deploy sebagai proyek terpisah
dari frontend, dengan environment Supabase dan ADMIN_USERNAME/ADMIN_PASSWORD/JWT_SECRET.

Data bisnis berada di Supabase dan session admin memakai token bertanda tangan, sehingga API
tidak memerlukan state lokal antar-request. Fallback JSON development sekarang ditolak di
Vercel. vercelignore mengecualikan environment, data lokal, worker dan fixture dari upload.

Periksa /api/health setelah deploy. Frontend statis memakai URL backend publik absolut
yang ditentukan sebelum build. Worker Baileys bukan bagian dari Function dan tidak perlu
dijalankan pada instance API; host di proses terus hidup dengan disk persisten.

Lihat [panduan deployment frontend/API/bot](../frontend/DEPLOYMENT.md).

## Pencocokan identitas tanpa membedakan huruf besar-kecil

Nama, perusahaan dan divisi dicocokkan tanpa membedakan kapital, misalnya Hanan/hanan,
PT Contoh/pt contoh dan HR/hr. Penulisan asli tetap ditampilkan. Filter, akumulasi harian,
ringkasan, CSV, kasbon dan pencocokan laporan WA menggunakan aturan tersebut.
Perusahaan/divisi/tanggal yang berbeda tetap dipisahkan. Kunci pelunasan lama tidak diubah,
dan laporan pembayaran terpisah tidak dihapus atau digabung secara fisik.

## Nama perusahaan PT BMT

Nama perusahaan standar adalah **PT BMT**. Penulisan `pt bmt`, nama lama `PT Bright Mobile Telecommunication`, serta ejaan `PT Bright Mobile Telecommuncation` dikenali tanpa membedakan huruf besar/kecil dan disimpan sebagai PT BMT. Form pelanggan dan caption WhatsApp menggunakan nama pendek ini. Parser pembayaran yang sama dipakai oleh bot grup, webhook Meta, dan input manual.

Jalankan migrasi `backend/migrations/008_company_bmt.sql` (pada folder backend: `migrations/008_company_bmt.sql`) setelah 001?007 untuk menyeragamkan data Supabase lama dan kunci rekap kasbon. Hentikan backend/bot sementara saat migrasi. Jika ada benturan identitas pesanan menunggu atau kunci kasbon, transaksi dibatalkan tanpa menghapus data; periksa benturan sebelum mencoba ulang. Setelah itu restart backend/bot dan build ulang frontend. Migrasi tidak mengubah menus/menu_schedules.
