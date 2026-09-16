<div align="center">
  <img src="app-icon-192.png" width="96" alt="MazWay SQL Merge Converter">

# SQL Merge Converter

Website sederhana untuk mengubah data SQL menjadi format Stored Procedure `CALL MWCONFIG.MERGE_*` secara cepat dan konsisten.

**HTML • CSS • JavaScript • Vercel Analytics**

</div>

---

## Tentang Website

SQL Merge Converter dibuat untuk membantu proses konfigurasi data pada tabel-tabel `MWCONFIG`. Pengguna cukup memilih jenis tabel, memasukkan data SQL, lalu website akan menghasilkan perintah Stored Procedure yang sesuai.

Seluruh proses konversi dijalankan langsung di browser. Data yang dimasukkan tidak dikirim ke backend atau disimpan pada database website.

## Fitur Utama

- Konversi data menjadi format `CALL MWCONFIG.MERGE_*`.
- Mendukung satu atau banyak perintah dalam sekali proses.
- Mendukung beberapa kelompok nilai dalam satu perintah.
- Koma di dalam string tetap dibaca sebagai bagian dari nilai.
- Mendukung string SQL dengan escape petik tunggal seperti `''`.
- Validasi jenis tabel, jumlah kolom, dan jumlah nilai.
- Kolom audit tertentu dapat diabaikan secara otomatis.
- Mode khusus untuk `MAPPING`, `MAPPING_GROUP`, dan `MAPPING_GROUP_LINE`.
- Tombol untuk menyalin hasil dan membersihkan area input.
- Pilihan layout kiri–kanan atau atas–bawah.
- Tampilan responsif untuk desktop, tablet, dan perangkat mobile.
- Favicon serta ikon aplikasi MazWay.
- Vercel Web Analytics sudah terintegrasi.

## Tabel yang Didukung

- `ADAPTOR`
- `ADAPTOR_CODEX`
- `ADAPTOR_PARAM`
- `CHARGES`
- `CLIENT`
- `CLIENT_TARGET`
- `DEV_TELLER_MAP`
- `DTREE`
- `ERROR_MAP`
- `MAPPING_COMBINE`
- `PARAM_MAP`
- `ROUTING_TABLE`
- `SERVER_PORT`

Mode `MAPPING_COMBINE` dapat memproses tiga tabel berikut secara bersamaan:

- `MAPPING`
- `MAPPING_GROUP`
- `MAPPING_GROUP_LINE`

## Cara Menggunakan

1. Buka website melalui browser.
2. Pilih **Jenis tabel** sesuai data yang akan dikonversi.
3. Masukkan data pada bagian **Data Input**.
4. Klik tombol **Convert Data** atau gunakan `Ctrl + Enter`.
5. Periksa hasil pada bagian **Hasil Konversi**.
6. Klik **Salin** untuk menyalin seluruh hasil.
7. Gunakan **Ubah Layout** jika ingin mengubah posisi area input dan hasil.

## Contoh Konversi

### Data Input

```sql
INSERT INTO MWCONFIG.MAPPING
  (ID, DESCRIPTION, MODIFIED_BY, "TIMESTAMP", MODULE)
VALUES
  ('req-core.sms.0200.1.101138', '', CURRENT_USER, CURRENT_TIMESTAMP, '[smsm]'),
  ('res-core.sms.0200.1.101138', '', CURRENT_USER, CURRENT_TIMESTAMP, '[smsm]');
```

### Hasil Konversi

```sql
CALL MWCONFIG.MERGE_MAPPING('req-core.sms.0200.1.101138',NULL,'[smsm]');
CALL MWCONFIG.MERGE_MAPPING('res-core.sms.0200.1.101138',NULL,'[smsm]');
```

Setiap kelompok nilai akan menghasilkan satu perintah `CALL` tersendiri.

## Struktur Proyek

```text
sql-call-merge-converter/
├── index.html              # Struktur halaman website
├── style.css               # Tampilan dan desain responsif
├── script.js               # Parser dan logika konversi
├── vercel.json             # Konfigurasi deployment Vercel
├── favicon.ico             # Favicon kompatibel browser
├── favicon.svg             # Favicon format vektor
├── favicon-32.png          # Favicon fallback PNG
├── app-icon-192.png        # Ikon aplikasi ukuran 192px
├── app-icon-512.png        # Ikon aplikasi ukuran 512px
├── DEPLOY-VERCEL.md        # Panduan deployment dan Analytics
└── README.md               # Dokumentasi utama proyek
```

## Menjalankan di Komputer

Cara paling sederhana adalah membuka `index.html` langsung menggunakan browser.

Untuk hasil yang lebih konsisten, jalankan melalui local server:

```bash
python -m http.server 5500
```

Kemudian buka:

```text
http://localhost:5500
```

Anda juga dapat menggunakan extension **Live Server** pada Visual Studio Code.

## Deployment

Website dapat di-deploy sebagai static site tanpa proses build. Panduan lengkap deployment melalui GitHub atau Vercel CLI tersedia pada [`DEPLOY-VERCEL.md`](DEPLOY-VERCEL.md).

Pengaturan utama saat import ke Vercel:

- Framework Preset: `Other`
- Root Directory: `./`
- Build Command: kosong
- Output Directory: kosong
- Install Command: kosong

## Vercel Web Analytics

Integrasi Analytics berikut sudah tersedia pada `index.html`:

```html
<script defer src="/_vercel/insights/script.js"></script>
```

Setelah website di-deploy:

1. Buka proyek pada dashboard Vercel.
2. Pilih menu **Analytics**.
3. Klik **Enable**.
4. Lakukan deployment ulang.
5. Buka website produksi untuk mulai mengirimkan data kunjungan.

Analytics tidak aktif ketika website hanya dibuka sebagai file lokal.

## Teknologi

- HTML5
- CSS3
- Vanilla JavaScript
- Vercel Static Hosting
- Vercel Web Analytics

Tidak menggunakan framework, library UI, backend, atau database tambahan.

## Catatan Keamanan

- Proses konversi berjalan di sisi pengguna melalui browser.
- Website tidak memiliki fitur penyimpanan data input.
- Selalu periksa kembali hasil konversi sebelum menjalankannya pada database.
- Hindari memasukkan data sensitif ketika menggunakan perangkat bersama.

## Author

**MazWay**

Copyright © MazWay 2026.
