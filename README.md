# KasProyek - Aplikasi Pencatat Keuangan & Modal Proyek Konstruksi

Aplikasi web mandiri berbasis **Node.js (Express.js)**, antarmuka template **EJS** dengan nuansa profesional dan **Tailwind CSS**, serta basis data **SQLite** (mode WAL). Dirancang khusus untuk pemilik CV dalam mengawasi arus kas, alokasi modal bertingkat, dan realisasi belanja proyek pembangunan di berbagai cabang secara terisolasi, cepat di lapangan, dan akurat.

---

## Fitur Utama

1. **Kantong Modal Mandiri per Proyek**:
   - Saldo kas dan modal kerja terpisah secara ketat antar proyek.
   - Smart card visual dengan gradien bertingkat (Mikro, Kecil, Menengah, Besar, Mega) dan motif arsitektural.
2. **Realisasi Belanja & Rincian Volume**:
   - Pencatatan transaksi belanja dengan input opsional jumlah volume (misal: "50 sak", "2 truk").
   - Filter transaksi per kategori dengan kalkulasi subtotal instan.
3. **Penyelesaian Proyek & Histori Multi-Cabang**:
   - Fitur "Akhiri Proyek" yang mencatat tanggal penyelesaian secara otomatis dan membekukan status.
   - Halaman Histori proyek selesai multi-cabang dengan filter pencarian dan kalkulasi total.
4. **Dasbor BI Laporan & Grafik Visual**:
   - Grafik distribusi belanja, serapan modal, dan tren bulanan menggunakan Chart.js dengan proporsi seimbang.
5. **Keamanan & Otorisasi PIN Cepat**:
   - Akses ringkas berbasis PIN pemilik (`231125`) dengan proteksi brute-force otomatis.
   - Sesi terenkripsi dan persisten.

---

## Panduan Menjalankan Aplikasi

### 1. Prasyarat
- Node.js versi 20+ LTS

### 2. Pemasangan & Menjalankan Server
```bash
npm install
npm start
```
Aplikasi akan aktif di alamat: `http://localhost:3000`

### 3. Akun Akses Default
- **Email**: `pemilik@kasproyek.com`
- **Kata Sandi**: `admin12345`
- **PIN Cepat**: `231125`

---

## Menjalankan Pengujian Otomatis

Aplikasi dilengkapi dengan pengujian skenario moneter dan integrasi rute HTTP:

```bash
npm test
```
