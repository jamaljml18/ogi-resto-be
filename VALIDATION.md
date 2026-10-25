# Validasi terbaru: edit item order dan keamanan (25 Oktober 2026)

Bagian ini menggantikan kesimpulan lama yang menyebut harga checkout masih dipercaya dari
browser, kredensial admin fallback, token URL, policy menu publik, atau build Next.js
terblokir versi rentan. Catatan lama di bawah dipertahankan sebagai riwayat pemeriksaan.

## Perubahan yang diverifikasi

- Edit satu order melalui route admin dengan revision, ID menu, qty dan expectedPrice.
- Harga/nama/subtotal/total ditentukan master backend/database; checkout juga tidak lagi
  mempercayai harga atau total payload.
- SQL edit mengunci order dan menu, menolak revision/harga lama, menulis audit dan total
  secara atomik. Audit gagal membatalkan edit bersama.
- Kasbon lunas diblokir untuk edit. Lock periode bersama dengan kasbon_payments menghitung
  ulang nominal saat pelunasan yang bersamaan dengan edit.
- Policy lama menus/menu_schedules dicabut melalui 007. Role anon/authenticated tidak bisa
  mengubah menu, membaca audit, atau menjalankan fungsi edit.
- Admin login wajib memiliki environment; tidak ada kredensial fallback atau token URL.
- Next.js/eslint-config-next diperbarui ke 16.4.3, body-parser dan Zod mendapat patch.
- Environment dan state bot tidak dilacak Git; pemindaian pola kredensial pada file kode/
  dokumentasi yang dilacak tidak menemukan kandidat token Meta/service secret.
- Seluruh empat README diperbarui: arsitektur, relasi, setup, migrasi, editor, CSV dan bot.

## Hasil

| Pemeriksaan | Hasil |
| --- | --- |
| Backend unit/endpoint | 70 lulus |
| Frontend model/presenter | 32 lulus |
| Bot | 19 lulus |
| PostgreSQL terisolasi | 18 lulus |
| Frontend lint | Lulus |
| Build produksi Next.js 16.4.3 | Lulus di folder sementara, tanpa mengganggu .next dev |
| Browser interaktif | HP tegak/mendatar, tablet, PC: total, save ganda, pilih order gabungan, konflik dan layout lulus |
| npm audit frontend/backend/bot | 0 kerentanan tercatat |
| README link/fence dan diff whitespace | Lulus |

Pengujian memakai fixture lokal; tidak menjalankan migrasi di Supabase produksi,
mengirim pesan WhatsApp, mengubah pembayaran nyata, commit, atau push.

## Aktivasi dan batas

Jalankan migrations/007_order_item_editing.sql setelah 001-006, lalu restart proses.
Gunakan Node.js 22.13+ untuk memenuhi persyaratan tooling; mesin pengujian masih memiliki
Node 22.11 yang menghasilkan peringatan engine dependency ESLint meskipun lint/build lulus.

Selisih total Cash tetap perlu dicocokkan manual. Bukti WA bukan verifikasi bank/identitas.
JSON development tidak menjamin transaksi multi-proses. Hasil tes dan audit dependency bukan
bukti ketiadaan semua kerentanan: deployment, rate limit, backup dan kredensial tetap berada
dalam tanggung jawab operasional.

---

# Validasi backend dan bot sebelum push

Tanggal pemeriksaan: 17 Oktober 2026 (Asia/Jakarta).
Status: perbaikan lokal sudah diuji; belum merupakan persetujuan keamanan produksi.

Pemeriksaan meliputi source backend Express, akses database, webhook Meta, dan
worker Baileys. Tidak ada perubahan schema atau data Supabase produksi,
penautan akun, pengiriman WhatsApp, atau push repository dalam pemeriksaan ini.

## Temuan yang sudah diperbaiki

| Temuan | Perbaikan | Verifikasi |
| --- | --- | --- |
| ID menu hanya memakai Date.now, sehingga bisa bentrok | Tambah UUID pada ID menu | 100 menu dibuat pada timestamp sama, semua ID berbeda |
| Dua startup dapat berebut menghapus lock proses lama | Gate eksklusif untuk seluruh proses akuisisi dan pemulihan lock | Startup 12 pesaing, recovery 16 pesaing; satu pemenang |
| Callback pemeriksaan grup koneksi lama dapat memengaruhi sesi baru | Periksa status stopping dan identitas socket setelah await serta sebelum penanganan error | Pemeriksaan source dan syntax worker |
| Error cloud pada operasi lama beralih ke JSON dengan hasil sukses | Jika cloud dikonfigurasi, gagalnya query atau inisialisasi dikembalikan sebagai error | Outage dan kegagalan inisialisasi disimulasikan untuk baca/tulis |
| Penghapusan menu dilakukan lewat dua statement | Hapus parent saja; FK ON DELETE CASCADE menghapus jadwal dalam statement yang sama | Tes hanya satu DELETE ke menus |
| Alias jadwal tertangkap oleh route menu dinamis | Daftarkan route jadwal sebelum /menus/:id | Tes urutan registrasi route |
| Snapshot terenkripsi belum meminta flush sebelum rename | Aktifkan flush pada writeFile Node.js sebelum rename | Tes penyimpanan terenkripsi dan round trip |

Penghapusan menu atomik mengandalkan FK pada schema.sql benar-benar diterapkan
di database target. Tidak ada jaminan jika schema produksi telah diubah manual.

## Uji konkurensi dan kegagalan

- Enqueue 80 permintaan dengan 40 ID berbeda saat satu pembayaran masih disimpan.
  Setelah drain lanjutan, seluruh 41 pembayaran unik diproses tanpa kehilangan data.
- Drain bersamaan tidak menghasilkan lebih dari satu panggilan database aktif.
- Shutdown menunggu penyimpanan yang sedang berlangsung; item yang belum diproses
  tetap ada di state terenkripsi untuk restart.
- Simulasi database sudah commit tetapi respons hilang: item tetap di antrean;
  retry mengandalkan unique message ID dan diperlakukan sebagai duplikat.
- State terenkripsi diuji untuk penulisan bersamaan, kunci salah, dan credential
  Baileys asli secara offline.
- ID pesan unik dan upsert ignoreDuplicates tetap digunakan untuk WhatsApp.
- Update/delete riwayat tetap menyaring deleted_at IS NULL sehingga edit tidak
  mengaktifkan kembali catatan yang sudah dihapus.

## Risiko yang masih terbuka

### Prioritas tinggi

1. **Harga pesanan masih berasal dari payload klien.**
   [server.js](src/server.js) menghitung subtotal dari item.price yang dikirim
   browser. Nilai negatif, nominal tidak semestinya, atau harga yang dimanipulasi
   belum dicegah dengan pembacaan ulang master harga. Identitas item perlu
   divalidasi terhadap menus sebelum menghitung tagihan.

2. **Kebijakan RLS tabel lama masih permisif dalam schema.sql.**
   menus, menu_schedules, dan orders memiliki policy FOR ALL USING true.
   Risiko akses langsung tergantung grant dan konfigurasi project Supabase
   yang sesungguhnya. Proteksi token pada Express tidak cukup untuk mengamankan
   API database yang masih memberi akses publik. Perlu peninjauan grant/policy
   target dan migrasi akses backend saja; belum diterapkan pada audit ini.

3. **Konfirmasi lunas belum otomatis gugur jika tagihan bulan yang sama bertambah.**
   [kasbon.js](src/kasbon.js) membaca is_paid berdasarkan employee_key, sedangkan
   total dihitung dari pesanan saat ini. Pesanan Kasbon tambahan setelah konfirmasi
   dapat menambah total tanpa mencabut status lunas. Perlu aturan rekonsiliasi
   nominal/snapshot tagihan dan pengujian saat order masuk bersamaan dengan konfirmasi.

### Integritas data dan kondisi bersamaan

4. **Edit dari dua admin masih memakai penulisan terakhir.**
   Update riwayat pembayaran, jadwal, serta status kasbon belum memakai revision
   atau conditional version check. Unique index mencegah duplikasi baris,
   bukan mencegah perubahan admin pertama ditimpa admin kedua.
   Solusi berikutnya: optimistic concurrency dengan version/updated_at,
   respons konflik 409, dan UI yang meminta muat ulang.

5. **Create/update menu dan jadwal belum satu transaksi database.**
   Create mencoba rollback manual bila jadwal gagal, tetapi rollback sendiri
   dapat gagal. Update menu lalu jadwal dapat berhasil sebagian. Perlu fungsi
   PostgreSQL/RPC transaksional, bukan hanya mutex dalam satu proses Node.js.

6. **POST pesanan dan pembayaran manual belum idempotent.**
   Klik ulang atau retry jaringan dapat membuat dua catatan berbeda.
   Unique WhatsApp message ID hanya berlaku pada pesan WhatsApp.
   Perlu idempotency key dengan constraint database untuk jalur manual/checkout.

7. **JSON lokal bukan penyimpanan bersama multiproses.**
   Operasi file lokal tidak memiliki transaksi/lock lintas API instance dan
   dapat kehilangan perubahan bila beberapa proses menggunakan file sama.
   Gunakan Supabase untuk operasional. Tidak ada migrasi otomatis JSON ke cloud.

8. **Pagination offset dapat bergeser saat ada insert/hapus.**
   Daftar admin masih memakai page/range. Aktivitas bersamaan dapat menyebabkan
   baris terulang atau terlewat antarhalaman. Ini bukan penghapusan data database;
   keyset pagination diperlukan bila daftar harus konsisten saat berubah cepat.

### Operasional dan keamanan

9. Token admin tersimpan di localStorage, CORS masih terbuka, belum ada rate limit
   login dan belum ada pencabutan token per sesi. Token internal bukan JWT standar.
10. Antrean bot belum dibatasi ukurannya; gangguan database panjang dapat menambah
    penggunaan disk. Satu pesan gagal terus-menerus juga menahan item setelahnya.
11. Penghentian proses menunggu operasi yang sedang berlangsung; belum ada jaminan
    waktu shutdown bila request eksternal tidak selesai.
12. flush dan rename mengurangi risiko file setengah tertulis, tetapi bukan
    jaminan pemulihan seluruh kondisi power loss, disk penuh, atau kerusakan disk.
13. Jika proses mati saat worker-lock.guard masih dipegang, startup berikutnya
    sengaja ditolak. Periksa tidak ada worker hidup sebelum membersihkan guard.
    Jangan menghapus runtime.enc atau mengganti kunci untuk melewati masalah lock.
14. Baileys tetap integrasi tidak resmi dan perangkat tertaut memiliki izin lebih
    luas dari filter grup kode. Pesan saat bot tidak aktif belum dijamin pulih.

## Hasil pengujian

| Perintah dari backend | Hasil |
| --- | --- |
| npm.cmd test | 41 lulus |
| npm.cmd run test:bot | 19 lulus |

Tes menggunakan VM/mock database dan file sementara. Tes lock memakai operasi
file eksklusif bersamaan dalam satu proses pengujian. Belum ada load test terhadap
Supabase target, simulasi banyak host, pemutusan daya nyata, atau audit menyeluruh
seluruh dependensi. Pengujian ini tidak membuktikan sistem bebas race condition.

README utama dan backend disesuaikan dengan perubahan: kegagalan cloud tidak
lagi dianggap sukses melalui JSON; JSON tetap tersedia ketika Supabase memang
tidak dikonfigurasi. Restart API dan worker untuk memakai kode baru.


## Pembaruan alur waiting payments — 25 Oktober 2026

Migrasi 005 menambahkan waiting_payments, status ledger privat, identitas unik,
dan RPC atomik. Akses publik orders juga dicabut. Cash checkout memakai token
retry khusus sehingga percobaan ulang dengan payload sama pada halaman yang
sama mengembalikan pesanan asli. Kasbon belum memiliki idempotency key terpisah.

Pengujian PostgreSQL lokal terisolasi lulus untuk satu waiting per identitas,
race admin/WhatsApp, rollback ketika insert gagal, replay bukti, race Bayar/Hapus,
retry checkout sebelum/sesudah paid, dan larangan akses role publik.
Tidak ada transaksi pengujian yang dilakukan pada Supabase produksi.

Pemindahan otomatis adalah pencocokan laporan, bukan verifikasi transaksi bank.
Ketepatan nominal/bukti tetap tanggung jawab proses bisnis. Pembaruan ini tidak
menghilangkan risiko lain seperti harga dari klien dan konflik edit dua admin.


## 2026-10-25: legacy orders payment-column repair

Supabase metadata confirmed that the deployed original orders table lacked payment_method
and notes. This causes SQLSTATE 42703 in the Cash confirmation trigger even when the
migration 005 functions exist. Migration 006 adds those columns and widens order_day
without removing rows. Migration 005 also now installs these prerequisites for new runs.
The repair has not been applied to production by this change.

Validation: 59 backend tests, 27 frontend tests, frontend lint, and 11 isolated PostgreSQL
tests passed, including missing-column reproduction, repeated repair, payment settlement,
rollback, and concurrent pay/delete/receipt operations.
