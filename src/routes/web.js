const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');

const { requireAuth, rateLimiter } = require('../middleware/auth');
const { uploadsDir } = require('../config/database');

const authController = require('../controllers/authController');
const dashboardController = require('../controllers/dashboardController');
const cabangController = require('../controllers/cabangController');
const proyekController = require('../controllers/proyekController');
const transaksiController = require('../controllers/transaksiController');
const laporanController = require('../controllers/laporanController');

// Multer khusus upload logo CV
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, 'logo-' + Date.now() + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }
});

// -----------------------------------------------------------------------------
// Route Publik
// -----------------------------------------------------------------------------
router.get('/login', authController.showLogin);
router.post('/login', rateLimiter, authController.login);
router.get('/logout', authController.logout);
router.get('/lupa-sandi', authController.showLupaSandi);
router.post('/lupa-sandi', rateLimiter, authController.kirimTokenReset);
router.get('/reset-sandi', authController.showResetSandi);
router.post('/reset-sandi', rateLimiter, authController.prosesResetSandi);

// -----------------------------------------------------------------------------
// Route Terproteksi
// -----------------------------------------------------------------------------
router.use(requireAuth);

// Dasbor, Laporan BI & Histori Proyek
router.get('/', dashboardController.index);
router.get('/laporan', laporanController.biDashboard);
router.get('/histori', dashboardController.histori);
router.get('/riwayat-tahunan', dashboardController.riwayatTahunan);

// Profil CV & Sandi
router.get('/profil', authController.showProfile);
router.post('/profil/cv', upload.single('logo'), authController.updateCv);
router.post('/profil/password', authController.updatePassword);
router.post('/profil/kode-akses', authController.updateKodeAkses);

// Cabang
router.get('/cabang', cabangController.index);
router.post('/cabang', cabangController.store);
router.post('/cabang/:id/toggle', cabangController.toggleActive);

// Proyek & Kategori
router.get('/proyek/baru', proyekController.create);
router.post('/proyek/baru', proyekController.store);
router.get('/proyek/:id', proyekController.detail);
router.post('/proyek/:id/status', proyekController.updateStatus);
router.post('/proyek/:id/akhiri', proyekController.akhiriProyek);
router.post('/proyek/:id/aktifkan-kembali', proyekController.aktifkanKembali);
router.post('/proyek/:id/pindah-cabang', proyekController.pindahCabang);
router.post('/proyek/:id/edit-metadata', proyekController.updateMetadata);
router.post('/proyek/:id/anggaran', proyekController.updateAnggaran);
router.post('/proyek/:id/salin-anggaran', proyekController.salinAnggaran);
router.post('/kategori', proyekController.tambahKategori);

// Transaksi Kas
router.post('/proyek/:id/modal', transaksiController.storeModal);
router.post('/proyek/:id/pengeluaran', transaksiController.storePengeluaranLangsung);
router.post('/proyek/:id/belanja', transaksiController.storePengeluaranLangsung);
router.post('/proyek/:id/transaksi/:transaksiId/batal', transaksiController.batalkan);
router.post('/proyek/:id/transaksi/:transaksiId/edit', transaksiController.editTransaksi);

// Ekspor & Backup
router.get('/proyek/:id/ekspor/excel', laporanController.eksporProyekExcel);
router.get('/proyek/:id/ekspor/pdf', laporanController.eksporProyekPdf);
router.get('/histori/ekspor/excel', laporanController.eksporHistoriExcel);
router.get('/histori/ekspor/pdf', laporanController.eksporHistoriPdf);
router.get('/riwayat-tahunan/ekspor/excel', laporanController.eksporHistoriExcel);
router.get('/riwayat-tahunan/ekspor/pdf', laporanController.eksporHistoriPdf);
router.get('/cadangan/unduh', laporanController.unduhCadangan);

module.exports = router;
