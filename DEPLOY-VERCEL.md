# Deploy SQL Merge Converter ke Vercel

Proyek ini merupakan website statis sehingga tidak membutuhkan instalasi dependency, build command, atau output directory khusus.

## Isi folder yang perlu diunggah

- `index.html`
- `style.css`
- `script.js`
- `vercel.json`
- `favicon.ico`
- `favicon.svg`
- `favicon-32.png`
- `app-icon-192.png`
- `app-icon-512.png`

## Cara 1 — Deploy melalui GitHub (direkomendasikan)

1. Buat repository baru di GitHub, misalnya `sql-merge-converter`.
2. Masukkan seluruh file proyek ke bagian paling atas repository, bukan ke dalam subfolder tambahan.
3. Buka <https://vercel.com/new> lalu login menggunakan akun GitHub.
4. Pilih **Import** pada repository `sql-merge-converter`.
5. Gunakan pengaturan berikut:
   - Framework Preset: **Other**
   - Root Directory: `./`
   - Build Command: kosongkan
   - Output Directory: kosongkan
   - Install Command: kosongkan
6. Klik **Deploy**.
7. Setelah deployment selesai, Vercel memberikan alamat website dengan domain `.vercel.app`.

Setiap perubahan yang di-push ke branch utama GitHub akan membuat deployment produksi baru secara otomatis.

## Cara 2 — Deploy menggunakan Vercel CLI

Buka terminal pada folder proyek, kemudian jalankan:

```bash
npm install --global vercel
vercel login
vercel --prod
```

Untuk pertanyaan konfigurasi awal:

- Set up and deploy: `Y`
- Scope: pilih akun Vercel Anda
- Link to existing project: `N` untuk deployment pertama
- Project name: tentukan nama website
- Directory: `./`
- Override settings: `N`

Deployment berikutnya cukup menggunakan:

```bash
vercel --prod
```

## Mengaktifkan Vercel Web Analytics

Script Analytics sudah dipasang pada `index.html`:

```html
<script defer src="/_vercel/insights/script.js"></script>
```

Langkah aktivasinya:

1. Buka dashboard Vercel.
2. Pilih proyek SQL Merge Converter.
3. Masuk ke menu **Analytics**.
4. Klik **Enable** pada bagian Web Analytics.
5. Lakukan deployment ulang:
   - GitHub: push perubahan baru atau pilih **Redeploy** dari halaman Deployments.
   - CLI: jalankan `vercel --prod`.
6. Buka website produksi dan lakukan beberapa kunjungan halaman.
7. Periksa hasilnya melalui **Project → Analytics**.

Analytics memang tidak aktif ketika `index.html` hanya dibuka langsung dari komputer. Data baru dikirim saat website berjalan pada deployment Vercel dan Web Analytics sudah diaktifkan.

## Jika data Analytics belum muncul

- Pastikan deployment dilakukan setelah Web Analytics diaktifkan.
- Buka website melalui domain `.vercel.app`, bukan melalui file lokal.
- Periksa bahwa `/_vercel/insights/script.js` tidak diblokir browser, extension, atau ad blocker.
- Coba akses website melalui mode Incognito tanpa extension pemblokir.

Referensi resmi:

- <https://vercel.com/docs/deployments>
- <https://vercel.com/docs/analytics/quickstart>
