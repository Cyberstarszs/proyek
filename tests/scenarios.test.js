const assert = require('assert');
const { db, initSchema } = require('../src/config/database');
const kasService = require('../src/services/kasService');

async function runScenarioTests() {
  console.log('=== MEMULAI PENGUJIAN OTOMATIS ARUS KAS TUNGGAL (SINGLE OPERATOR) ===\n');

  // Inisialisasi basis data
  await initSchema();

  // Bersihkan data lama agar pengujian selalu deterministik
  await db.run('DELETE FROM audit_logs');
  await db.run('DELETE FROM transaksi');
  await db.run('DELETE FROM anggaran_kategori');
  await db.run('DELETE FROM proyek');
  await db.run('DELETE FROM pembeli');
  await db.run('DELETE FROM cabang');

  // Buat Cabang untuk testing
  const ts = Date.now();
  const cbRes = await db.run('INSERT INTO cabang (nama, kota) VALUES (?, ?)', [`Cabang Uji ${ts}`, 'Jakarta']);
  const cabangId = cbRes.lastID;

  const katMaterial = await db.get("SELECT id FROM kategori WHERE nama = 'Material'");

  // --------------------------------------------------------------------------
  // SKENARIO S-A: Alur Kas Standar Tunggal
  // Modal Masuk Rp200.000.000 -> Belanja Semen 12.5jt -> Belanja Pasir 7.3jt
  // --------------------------------------------------------------------------
  console.log('--- Menguji Skenario S-A: Alur Kas Standar Tunggal ---');
  const prA = await db.run(
    "INSERT INTO proyek (cabang_id, nama, jenis_bangunan, luas_m2, tanggal_mulai, status) VALUES (?, ?, 'Rumah', 100, '2026-01-01', 'Aktif')",
    [cabangId, `Proyek S-A ${ts}`]
  );
  const proyekAId = prA.lastID;

  // 1. Modal masuk Rp200.000.000
  await kasService.catatModalMasuk({
    proyekId: proyekAId,
    nominal: 200000000,
    tanggal: '2026-01-01',
    uraian: 'Modal Masuk Awal'
  });
  let saldo = await kasService.hitungSaldoProyek(proyekAId);
  assert.strictEqual(saldo.saldoKas, 200000000);
  assert.strictEqual(saldo.biayaTerealisasi, 0);
  assert.strictEqual(saldo.modalBersih, 200000000);
  console.log('  ✓ Langkah 1: Modal masuk 200jt -> Kas 200jt, Modal Bersih 200jt');

  // 2. Belanja semen langsung Rp12.500.000
  await kasService.catatPengeluaranLangsung({
    proyekId: proyekAId,
    kategoriId: katMaterial.id,
    nominal: 12500000,
    tanggal: '2026-01-02',
    uraian: 'Beli semen langsung 50 sak'
  });
  saldo = await kasService.hitungSaldoProyek(proyekAId);
  assert.strictEqual(saldo.saldoKas, 187500000);
  assert.strictEqual(saldo.biayaTerealisasi, 12500000);
  assert.strictEqual(saldo.modalBersih, 200000000);
  console.log('  ✓ Langkah 2: Beli semen 12.5jt -> Kas 187.5jt, Biaya 12.5jt');

  // 3. Belanja pasir langsung Rp7.300.000
  await kasService.catatPengeluaranLangsung({
    proyekId: proyekAId,
    kategoriId: katMaterial.id,
    nominal: 7300000,
    tanggal: '2026-01-03',
    uraian: 'Beli pasir cor 2 truk'
  });
  saldo = await kasService.hitungSaldoProyek(proyekAId);
  assert.strictEqual(saldo.saldoKas, 180200000);
  assert.strictEqual(saldo.biayaTerealisasi, 19800000);
  assert.strictEqual(saldo.modalBersih, 200000000);
  assert.strictEqual(saldo.saldoKas + saldo.biayaTerealisasi, saldo.modalBersih);
  console.log('  ✓ Langkah 3: Beli pasir 7.3jt -> Kas 180.2jt, Total Biaya 19.8jt, Invarian Seimbang!');
  console.log('  Skenario S-A: 100% LULUS.\n');

  // --------------------------------------------------------------------------
  // SKENARIO S-B: Belanja Melebihi Saldo Kas (Deteksi Kas Minus)
  // --------------------------------------------------------------------------
  console.log('--- Menguji Skenario S-B: Belanja dan Deteksi Kas Minus ---');
  const prB = await db.run(
    "INSERT INTO proyek (cabang_id, nama, jenis_bangunan, luas_m2, tanggal_mulai, status) VALUES (?, ?, 'Ruko', 120, '2026-01-01', 'Aktif')",
    [cabangId, `Proyek S-B ${ts}`]
  );
  const proyekBId = prB.lastID;

  // Modal 5jt
  await kasService.catatModalMasuk({
    proyekId: proyekBId,
    nominal: 5000000,
    tanggal: '2026-01-01',
    uraian: 'Modal mini'
  });

  // Belanja 7jt (melebihi kas masuk)
  await kasService.catatPengeluaranLangsung({
    proyekId: proyekBId,
    kategoriId: katMaterial.id,
    nominal: 7000000,
    tanggal: '2026-01-02',
    uraian: 'Beli besi cor melebihi saldo kas'
  });
  saldo = await kasService.hitungSaldoProyek(proyekBId);
  assert.strictEqual(saldo.saldoKas, -2000000);
  assert.strictEqual(saldo.isKasMinus, true);
  assert.strictEqual(saldo.biayaTerealisasi, 7000000);
  assert.strictEqual(saldo.modalBersih, 5000000);
  assert.strictEqual(saldo.saldoKas + saldo.biayaTerealisasi, saldo.modalBersih);
  console.log('  ✓ Belanja 7jt terhadap modal 5jt -> Kas defisit -2jt terdeteksi, Invarian Seimbang!');
  console.log('  Skenario S-B: 100% LULUS.\n');

  // --------------------------------------------------------------------------
  // SKENARIO S-C: Penarikan Sisa Modal & Penutupan Proyek
  // --------------------------------------------------------------------------
  console.log('--- Menguji Skenario S-C: Penarikan Sisa Modal Kas ---');
  // Tarik modal kas Rp180.200.000 dari Proyek A
  await kasService.catatPenarikanModal({
    proyekId: proyekAId,
    nominal: 180200000,
    tanggal: '2026-01-05',
    uraian: 'Tarik sisa kas modal'
  });
  saldo = await kasService.hitungSaldoProyek(proyekAId);
  assert.strictEqual(saldo.saldoKas, 0);
  assert.strictEqual(saldo.modalBersih, 19800000);
  assert.strictEqual(saldo.biayaTerealisasi, 19800000);
  console.log('  ✓ Penarikan kas 180.2jt -> Kas 0, Modal Bersih 19.8jt (sama persis dengan total biaya belanja)');

  // Verifikasi penarikan melebihi saldo kas ditolak
  await assert.rejects(
    async () => {
      await kasService.catatPenarikanModal({
        proyekId: proyekAId,
        nominal: 1000,
        tanggal: '2026-01-05',
        uraian: 'Tarik kas saat saldo 0'
      });
    },
    /melebihi saldo kas/
  );
  console.log('  ✓ Penarikan melebihi saldo kas berhasil DITOLAK.');
  console.log('  Skenario S-C: 100% LULUS.\n');

  // --------------------------------------------------------------------------
  // SKENARIO S-D: Pembatalan Transaksi & Pemulihan Kas
  // --------------------------------------------------------------------------
  console.log('--- Menguji Skenario S-D: Pembatalan Transaksi Belanja ---');
  const prD = await db.run(
    "INSERT INTO proyek (cabang_id, nama, jenis_bangunan, luas_m2, tanggal_mulai, status) VALUES (?, ?, 'Rumah', 80, '2026-01-01', 'Aktif')",
    [cabangId, `Proyek S-D ${ts}`]
  );
  const proyekDId = prD.lastID;

  await kasService.catatModalMasuk({
    proyekId: proyekDId,
    nominal: 50000000,
    tanggal: '2026-01-01',
    uraian: 'Modal 50jt'
  });

  const txBelanja = await kasService.catatPengeluaranLangsung({
    proyekId: proyekDId,
    kategoriId: katMaterial.id,
    nominal: 5000000,
    tanggal: '2026-01-02',
    uraian: 'Beli keramik salah warna'
  });
  saldo = await kasService.hitungSaldoProyek(proyekDId);
  assert.strictEqual(saldo.saldoKas, 45000000);
  assert.strictEqual(saldo.biayaTerealisasi, 5000000);

  // Batalkan transaksi belanja
  await kasService.batalkanTransaksi(txBelanja, 'Retur keramik dana kembali', '127.0.0.1');
  saldo = await kasService.hitungSaldoProyek(proyekDId);
  assert.strictEqual(saldo.saldoKas, 50000000);
  assert.strictEqual(saldo.biayaTerealisasi, 0);
  assert.strictEqual(saldo.modalBersih, 50000000);
  console.log('  ✓ Belanja 5jt dibatalkan -> Biaya kembali 0, Kas kembali utuh 50jt, Invarian Seimbang!');
  console.log('  Skenario S-D: 100% LULUS.\n');

  // --------------------------------------------------------------------------
  // SKENARIO S-G: Patokan Biaya Konstruksi per m2
  // --------------------------------------------------------------------------
  console.log('--- Menguji Skenario S-G: Patokan Biaya per m2 ---');
  // Proyek Rumah 1: 100 m2, biaya 500jt -> 5jt/m2
  const p1 = await db.run(
    "INSERT INTO proyek (cabang_id, nama, jenis_bangunan, luas_m2, tanggal_mulai, status) VALUES (?, ?, 'Rumah', 100, '2025-01-01', 'Selesai')",
    [cabangId, `Rumah Selesai 1 ${ts}`]
  );
  await db.run(
    "INSERT INTO transaksi (proyek_id, jenis_transaksi, nominal, tanggal_transaksi, uraian) VALUES (?, 'PENGELUARAN_LANGSUNG', 500000000, '2025-02-01', 'Biaya total')",
    [p1.lastID]
  );

  // Proyek Rumah 2: 120 m2, biaya 700jt -> ~5.83jt/m2
  const p2 = await db.run(
    "INSERT INTO proyek (cabang_id, nama, jenis_bangunan, luas_m2, tanggal_mulai, status) VALUES (?, ?, 'Rumah', 120, '2025-01-01', 'Selesai')",
    [cabangId, `Rumah Selesai 2 ${ts}`]
  );
  await db.run(
    "INSERT INTO transaksi (proyek_id, jenis_transaksi, nominal, tanggal_transaksi, uraian) VALUES (?, 'PENGELUARAN_LANGSUNG', 700000000, '2025-02-01', 'Biaya total')",
    [p2.lastID]
  );

  // Proyek Rumah 3: 200 m2, biaya 1.2M -> 6jt/m2
  const p3 = await db.run(
    "INSERT INTO proyek (cabang_id, nama, jenis_bangunan, luas_m2, tanggal_mulai, status) VALUES (?, ?, 'Rumah', 200, '2025-01-01', 'Selesai')",
    [cabangId, `Rumah Selesai 3 ${ts}`]
  );
  await db.run(
    "INSERT INTO transaksi (proyek_id, jenis_transaksi, nominal, tanggal_transaksi, uraian) VALUES (?, 'PENGELUARAN_LANGSUNG', 1200000000, '2025-02-01', 'Biaya total')",
    [p3.lastID]
  );

  // Proyek Aktif Baru Rumah 45 m2
  const pBaru = await db.run(
    "INSERT INTO proyek (cabang_id, nama, jenis_bangunan, luas_m2, tanggal_mulai, status) VALUES (?, ?, 'Rumah', 45, '2026-01-01', 'Aktif')",
    [cabangId, `Rumah Baru 45m2 ${ts}`]
  );

  const patokan = await kasService.getPatokanProyekSerupa(pBaru.lastID);
  assert.strictEqual(patokan.cukupData, true);
  assert.strictEqual(patokan.jumlahPembanding, 3);
  assert.strictEqual(patokan.minRate, 5000000);
  assert.strictEqual(patokan.maxRate, 6000000);
  assert.strictEqual(patokan.medianRate, 5833333);
  assert.strictEqual(patokan.proyeksiMin, 225000000); // 45 * 5jt
  assert.strictEqual(patokan.proyeksiMax, 270000000); // 45 * 6jt
  console.log('  ✓ Patokan 3 Rumah: Min 5jt/m2, Median 5.83jt/m2, Max 6jt/m2');
  console.log('  ✓ Proyeksi Rumah 45 m2: Rp225.000.000 s.d. Rp270.000.000');
  console.log('  Skenario S-G: 100% LULUS.\n');

  console.log('================================================================');
  console.log('SELURUH PENGUJIAN SKENARIO ARUS KAS TUNGGAL 100% LULUS & VALID!');
  console.log('================================================================');
}

runScenarioTests().catch(err => {
  console.error('PENGUJIAN SKENARIO GAGAL:', err);
  process.exit(1);
});
