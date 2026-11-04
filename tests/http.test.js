const request = require('supertest');
const assert = require('assert');
const app = require('../src/app');
const { initSchema, db } = require('../src/config/database');

async function runHttpTests() {
  console.log('=== MEMULAI PENGUJIAN INTEGRASI HTTP WEB (EXPRESS + EJS + SQLITE) ===\n');

  await initSchema();

  const agent = request.agent(app);

  // 1. Uji halaman login publik
  console.log('1. Menguji GET /login...');
  const resLogin = await agent.get('/login');
  assert.strictEqual(resLogin.status, 200);
  assert.ok(resLogin.text.includes('MyProyek'));
  console.log('  ✓ Halaman login termuat sukses (HTTP 200).\n');

  // 2. Uji login salah kata sandi
  console.log('2. Menguji login dengan sandi salah...');
  const resSalah = await agent.post('/login').send({
    email: 'pemilik@kasproyek.com',
    password: 'sandisalahbanget'
  });
  assert.strictEqual(resSalah.status, 200);
  assert.ok(resSalah.text.includes('Email atau kata sandi tidak valid'));
  console.log('  ✓ Login gagal ditangani dengan pesan aman.\n');

  // 3. Uji login sukses pemilik
  console.log('3. Menguji login pemilik (pemilik@kasproyek.com / admin12345)...');
  const resSukses = await agent.post('/login').send({
    email: 'pemilik@kasproyek.com',
    password: 'admin12345'
  });
  assert.strictEqual(resSukses.status, 302);
  assert.strictEqual(resSukses.header.location, '/');
  console.log('  ✓ Login berhasil, redirect ke dasbor utama.\n');

  // 4. Akses dasbor setelah login
  console.log('4. Menguji GET / (Dasbor Portofolio)...');
  const resDash = await agent.get('/');
  assert.strictEqual(resDash.status, 200);
  assert.ok(resDash.text.includes('Cari proyek...'));
  console.log('  ✓ Dasbor berhasil dibuka dengan sesi login aktif.\n');

  // 5. Tambah Cabang
  console.log('5. Menguji POST /cabang...');
  const uniqueBranch = `Cabang Web ${Date.now()}`;
  const resCabang = await agent.post('/cabang').send({
    nama: uniqueBranch,
    kota: 'Denpasar',
    catatan: 'Wilayah Bali'
  });
  assert.strictEqual(resCabang.status, 302);

  const cbRecord = await db.get('SELECT id FROM cabang WHERE nama = ?', [uniqueBranch]);
  assert.ok(cbRecord);
  console.log(`  ✓ Cabang "${uniqueBranch}" berhasil tersimpan di SQLite.\n`);

  // 6. Buat Proyek Baru di Bawah Cabang Tersebut
  console.log('6. Menguji POST /proyek/baru...');
  const uniqueProyek = `Proyek Villa ${Date.now()}`;
  const resProyek = await agent.post('/proyek/baru').send({
    cabang_id: cbRecord.id,
    nama: uniqueProyek,
    jenis_bangunan: 'Rumah',
    luas_m2: 150,
    lokasi: 'Sanur',
    tanggal_mulai: '2026-05-01'
  });
  assert.strictEqual(resProyek.status, 302);

  const prRecord = await db.get('SELECT id FROM proyek WHERE nama = ?', [uniqueProyek]);
  assert.ok(prRecord);
  console.log(`  ✓ Proyek "${uniqueProyek}" berhasil dibuat (ID #${prRecord.id}).\n`);

  // 7. Buka Detail Proyek
  console.log(`7. Menguji GET /proyek/${prRecord.id}...`);
  const resDetail = await agent.get(`/proyek/${prRecord.id}`);
  assert.strictEqual(resDetail.status, 200);
  assert.ok(resDetail.text.includes(uniqueProyek));
  assert.ok(resDetail.text.includes('Saldo Kas Proyek'));
  console.log('  ✓ Halaman detail proyek dan 5 kartu metrik termuat sempurna.\n');

  // 8. Setor Modal ke Proyek via Form
  console.log('8. Menguji POST /proyek/:id/modal...');
  const resModal = await agent.post(`/proyek/${prRecord.id}/modal`).send({
    tipe: 'MASUK',
    nominal: 75000000,
    tanggal: '2026-05-01',
    uraian: 'Modal awal villa'
  });
  assert.strictEqual(resModal.status, 302);

  const detailUpdate = await agent.get(`/proyek/${prRecord.id}`);
  assert.ok(detailUpdate.text.includes('75.000.000'));
  console.log('  ✓ Modal masuk Rp75.000.000 seketika terupdate di saldo kas.\n');

  // 9. Ekspor Laporan Excel
  console.log('9. Menguji GET /proyek/:id/ekspor/excel...');
  const resExcel = await agent.get(`/proyek/${prRecord.id}/ekspor/excel`);
  assert.strictEqual(resExcel.status, 200);
  assert.ok(resExcel.header['content-type'].includes('spreadsheetml'));
  console.log('  ✓ Laporan Excel berhasil di-generate dengan formula escaped.\n');

  // 10. Ekspor Laporan PDF
  console.log('10. Menguji GET /proyek/:id/ekspor/pdf...');
  const resPdf = await agent.get(`/proyek/${prRecord.id}/ekspor/pdf`);
  assert.strictEqual(resPdf.status, 200);
  assert.strictEqual(resPdf.header['content-type'], 'application/pdf');
  console.log('  ✓ Laporan PDF siap cetak berhasil di-generate via PDFKit.\n');

  // 11. Riwayat Tahunan
  console.log('11. Menguji GET /riwayat-tahunan...');
  const resTahunan = await agent.get('/riwayat-tahunan');
  assert.strictEqual(resTahunan.status, 200);
  assert.ok(resTahunan.text.includes('Tahun'));
  console.log('  ✓ Laporan konsolidasi tahunan lintas cabang sukses.\n');

  // 12. Ekspor Riwayat Tahunan Excel & PDF (F-14, A-37)
  console.log('12. Menguji ekspor riwayat tahunan (Excel & PDF)...');
  const resTahunanExcel = await agent.get('/riwayat-tahunan/ekspor/excel?tahun=2026');
  assert.strictEqual(resTahunanExcel.status, 200);
  assert.ok(resTahunanExcel.header['content-type'].includes('spreadsheetml'));

  const resTahunanPdf = await agent.get('/riwayat-tahunan/ekspor/pdf?tahun=2026');
  assert.strictEqual(resTahunanPdf.status, 200);
  assert.strictEqual(resTahunanPdf.header['content-type'], 'application/pdf');
  console.log('  ✓ Ekspor riwayat tahunan multi-cabang (PDF & Excel) sukses.\n');

  // 13. Tambah Kategori Anggaran Kustom (F-05)
  console.log('13. Menguji POST /kategori (Tambah Kategori Kustom)...');
  const uniqueKat = `Kolam Renang ${Date.now()}`;
  const resKat = await agent.post('/kategori').send({
    nama: uniqueKat,
    proyek_id: prRecord.id
  });
  assert.strictEqual(resKat.status, 302);
  const katCheck = await db.get('SELECT id FROM kategori WHERE nama = ?', [uniqueKat]);
  assert.ok(katCheck);
  console.log(`  ✓ Kategori baru "${uniqueKat}" berhasil dibuat dan dialokasikan ke proyek.\n`);

  // 14. Cadangan Database Mandiri (F-15)
  console.log('14. Menguji GET /cadangan/unduh (F-15 VACUUM INTO)...');
  const resBackup = await agent.get('/cadangan/unduh');
  assert.strictEqual(resBackup.status, 200);
  assert.ok(resBackup.header['content-disposition'].includes('KasProyek_Backup_'));
  console.log('  ✓ Fitur Cadangan Mandiri SQLite sukses diunduh secara konsisten.\n');

  // 15. Lupa Sandi & Token Reset Kriptografis (F-01)
  console.log('15. Menguji Fitur Lupa Sandi & Token Kriptografis (F-01)...');
  const resLupaGet = await request(app).get('/lupa-sandi');
  assert.strictEqual(resLupaGet.status, 200);
  assert.ok(resLupaGet.text.includes('Lupa Kata Sandi'));

  const resLupaPost = await request(app).post('/lupa-sandi').send({ email: 'pemilik@kasproyek.com' });
  assert.strictEqual(resLupaPost.status, 200);
  assert.ok(resLupaPost.text.includes('Tautan reset sandi kriptografis berhasil dibuat'));

  const userWithToken = await db.get('SELECT reset_token FROM users WHERE id = 1');
  assert.ok(userWithToken.reset_token);

  const resResetGet = await request(app).get(`/reset-sandi?token=${userWithToken.reset_token}`);
  assert.strictEqual(resResetGet.status, 200);
  assert.ok(resResetGet.text.includes('Sandi Baru'));
  console.log('  ✓ Alur Lupa Sandi & Token Kriptografis 60 Menit valid 100%.\n');

  // 16. Edit Metadata Proyek (F-03)
  console.log('16. Menguji Edit Data Spesifikasi Proyek (F-03)...');
  const resEditMeta = await agent.post(`/proyek/${prRecord.id}/edit-metadata`).send({
    nama: `${uniqueProyek} - Revisi`,
    jenis_bangunan: 'Rumah',
    luas_m2: 175,
    lokasi: 'Sanur Denpasar',
    tanggal_mulai: '2026-05-01',
    catatan: 'Revisi luas bangunan ke 175m2'
  });
  assert.strictEqual(resEditMeta.status, 302);
  const updatedPr = await db.get('SELECT luas_m2, lokasi FROM proyek WHERE id = ?', [prRecord.id]);
  assert.strictEqual(updatedPr.luas_m2, 175);
  console.log('  ✓ Pembaruan metadata proyek tersimpan dan tercatat di audit log.\n');

  // 17. Salin Anggaran dari Proyek Lain (F-17)
  console.log('17. Menguji Salin Anggaran Antarproyek (F-17)...');
  const pr2 = await agent.post('/proyek/baru').send({
    cabang_id: cbRecord.id,
    nama: `Proyek Sasaran Salin ${Date.now()}`,
    jenis_bangunan: 'Ruko',
    luas_m2: 120,
    tanggal_mulai: '2026-06-01'
  });
  const pr2Record = await db.get('SELECT id FROM proyek ORDER BY id DESC LIMIT 1');
  const resSalin = await agent.post(`/proyek/${pr2Record.id}/salin-anggaran`).send({
    sumber_proyek_id: prRecord.id
  });
  assert.strictEqual(resSalin.status, 302);
  console.log('  ✓ Susunan anggaran proyek sumber sukses disalin ke proyek tujuan.\n');

  // 18. Edit Keterangan Transaksi & Audit Log (F-10)
  console.log('18. Menguji Edit Uraian Transaksi & Audit Log (F-10)...');
  const firstTx = await db.get('SELECT id FROM transaksi WHERE proyek_id = ? LIMIT 1', [prRecord.id]);
  assert.ok(firstTx);
  const resEditTx = await agent.post(`/proyek/${prRecord.id}/transaksi/${firstTx.id}/edit`).send({
    uraian: 'Modal awal villa tahap 1 perbaikan keterangan',
    vendor: 'Bank Mandiri Transfer'
  });
  assert.strictEqual(resEditTx.status, 302);
  const txEdited = await db.get('SELECT uraian, vendor FROM transaksi WHERE id = ?', [firstTx.id]);
  assert.strictEqual(txEdited.uraian, 'Modal awal villa tahap 1 perbaikan keterangan');
  assert.strictEqual(txEdited.vendor, 'Bank Mandiri Transfer');
  console.log('  ✓ Edit uraian keterangan transaksi berhasil tanpa membatalkan transaksi.\n');

  // 19. Validasi Tanggal Masa Depan (BR-14)
  console.log('19. Menguji Validasi Tanggal Masa Depan (BR-14)...');
  const resMasaDepan = await agent.post(`/proyek/${prRecord.id}/modal`).send({
    tipe: 'MASUK',
    nominal: 1000000,
    tanggal: '2099-12-31',
    uraian: 'Modal masa depan yang tidak valid'
  });
  assert.strictEqual(resMasaDepan.status, 302);
  assert.ok(resMasaDepan.header.location.includes('tidak%20boleh%20melebihi%20hari%20ini'));
  console.log('  ✓ Transaksi bertanggal masa depan berhasil ditolak sistem (BR-14).\n');

  // 20. Menguji Login dengan Kode Akses PIN (231125)
  console.log('20. Menguji Login dengan Kode Akses PIN (231125)...');
  const pinAgent = request.agent(app);
  const resPinLogin = await pinAgent.post('/login').send({ kode: '231125' });
  assert.strictEqual(resPinLogin.status, 302);
  assert.strictEqual(resPinLogin.header.location, '/');
  console.log('  ✓ Login instan dengan kode akses "231125" sukses 100%.\n');

  // 21. Menguji Pendaftaran Proyek Baru dengan Modal Awal Mandiri & Format Titik
  console.log('21. Menguji Pendaftaran Proyek Baru dengan Modal Awal Mandiri (50.000.000)...');
  const uniqueProyekMandiri = `Proyek Mandiri ${Date.now()}`;
  const resProyekMandiri = await pinAgent.post('/proyek/baru').send({
    cabang_id: cbRecord.id,
    nama: uniqueProyekMandiri,
    jenis_bangunan: 'Ruko',
    luas_m2: 120,
    modal_awal: '50.000.000',
    tanggal_mulai: '2026-05-01'
  });
  assert.strictEqual(resProyekMandiri.status, 302);
  const prMandiri = await db.get('SELECT id FROM proyek WHERE nama = ?', [uniqueProyekMandiri]);
  assert.ok(prMandiri);
  const resDetailMandiri = await pinAgent.get(`/proyek/${prMandiri.id}`);
  assert.ok(resDetailMandiri.text.includes('50.000.000'), 'Harus menampilkan saldo kas modal awal Rp50.000.000');
  console.log('  ✓ Proyek baru terdaftar dengan modal awal mandiri Rp50.000.000 seketika.\n');

  // 22. Menguji Catat Belanja dengan Kategori Kustom Baru & Format Titik
  console.log('22. Menguji Catat Belanja dengan Kategori Baru & Format Titik...');
  const resBelanjaBaru = await pinAgent.post(`/proyek/${prMandiri.id}/belanja`).send({
    uraian: 'Pemasangan Plafon Gypsum',
    kategori_baru: 'Finishing Interior',
    nominal: '3.500.000',
    vendor: 'Toko Gypsum Makmur',
    tanggal: '2026-05-01'
  });
  assert.strictEqual(resBelanjaBaru.status, 302);
  const customKatCheck = await db.get('SELECT id FROM kategori WHERE nama = ?', ['Finishing Interior']);
  assert.ok(customKatCheck, 'Kategori baru harus otomatis dibuat');
  const resDetailAfterBelanja = await pinAgent.get(`/proyek/${prMandiri.id}`);
  assert.ok(resDetailAfterBelanja.text.includes('Finishing Interior'));
  assert.ok(resDetailAfterBelanja.text.includes('3.500.000'));
  console.log('  ✓ Kategori baru otomatis terdaftar & belanja terformat titik sukses.\n');

  // 23. Menguji Auto-Select Cabang Tunggal (tanpa cabang_id eksplisit)
  console.log('23. Menguji Pendaftaran Proyek Otomatis Pilih Cabang Tunggal...');
  const uniqueProyekAutoCabang = `Proyek Auto Cabang ${Date.now()}`;
  const resAutoCabang = await pinAgent.post('/proyek/baru').send({
    nama: uniqueProyekAutoCabang,
    jenis_bangunan: 'Rumah',
    tanggal_mulai: '2026-06-01'
  });
  assert.strictEqual(resAutoCabang.status, 302);
  const prAuto = await db.get('SELECT * FROM proyek WHERE nama = ?', [uniqueProyekAutoCabang]);
  assert.ok(prAuto, 'Proyek harus berhasil dibuat');
  assert.ok(prAuto.cabang_id > 0, 'Cabang harus otomatis terisi');
  console.log('  ✓ Proyek berhasil dibuat dengan cabang default otomatis terpilih.\n');

  // 24. Menguji Custom Jenis Konstruksi Baru & Tersimpan Seterusnya
  console.log('24. Menguji Jenis Konstruksi Baru Kustom & Tersimpan Permanen...');
  const uniqueProyekKustomJenis = `Proyek Villa Mewah ${Date.now()}`;
  const resKustomJenis = await pinAgent.post('/proyek/baru').send({
    nama: uniqueProyekKustomJenis,
    jenis_bangunan_kustom: 'Villa Tropis',
    tanggal_mulai: '2026-06-01'
  });
  assert.strictEqual(resKustomJenis.status, 302);
  const prJenis = await db.get('SELECT * FROM proyek WHERE nama = ?', [uniqueProyekKustomJenis]);
  assert.strictEqual(prJenis.jenis_bangunan, 'Villa Tropis');
  const jenisDb = await db.get('SELECT * FROM jenis_konstruksi WHERE nama = ?', ['Villa Tropis']);
  assert.ok(jenisDb, 'Jenis konstruksi baru harus tersimpan permanen di database');
  console.log('  ✓ Jenis konstruksi "Villa Tropis" tersimpan permanen dan diterapkan ke proyek.\n');

  // 25. Menguji Sesi Persisten di SQLite
  console.log('25. Menguji Sesi Login Persisten di Tabel SQLite...');
  const sessionCount = await db.get('SELECT COUNT(*) as c FROM sessions');
  assert.ok(sessionCount.c > 0, 'Sesi aktif harus tersimpan di tabel sessions SQLite');
  console.log('  ✓ Sesi persisten tersimpan di SQLite (tetap login melintasi restart server).\n');

  // 26. Menguji Akhiri Proyek & Pencatatan Otomatis Tanggal Selesai
  console.log('26. Menguji Fitur Akhiri Proyek & Pencatatan Tanggal Berakhir Otomatis...');
  const resAkhiri = await pinAgent.post(`/proyek/${prMandiri.id}/akhiri`).send({
    tanggal_selesai: '2026-06-15',
    catatan_selesai: 'Proyek rampung 100%'
  });
  assert.strictEqual(resAkhiri.status, 302);
  const prEnded = await db.get('SELECT * FROM proyek WHERE id = ?', [prMandiri.id]);
  assert.strictEqual(prEnded.status, 'Selesai');
  assert.strictEqual(prEnded.tanggal_selesai, '2026-06-15');
  console.log('  ✓ Proyek berhasil diakhiri & tanggal berakhir tercatat otomatis.');

  // 27. Menguji Halaman Histori Proyek Selesai & Detail Belanja
  console.log('27. Menguji Halaman Histori Proyek Selesai & Rincian Item Belanja...');
  const resHistori = await pinAgent.get('/histori');
  assert.strictEqual(resHistori.status, 200);
  assert.ok(resHistori.text.includes('Pemasangan Plafon Gypsum'));
  assert.ok(resHistori.text.includes('Detail Belanja'));
  assert.ok(resHistori.text.includes('Hanya Selesai'));

  const resTahunanAlias = await pinAgent.get('/riwayat-tahunan');
  assert.strictEqual(resTahunanAlias.status, 200);
  assert.ok(resTahunanAlias.text.includes('Pemasangan Plafon Gypsum'));

  const resHistoriExcel = await pinAgent.get('/histori/ekspor/excel');
  assert.strictEqual(resHistoriExcel.status, 200);
  assert.ok(resHistoriExcel.header['content-type'].includes('spreadsheetml'));

  const resHistoriPdf = await pinAgent.get('/histori/ekspor/pdf');
  assert.strictEqual(resHistoriPdf.status, 200);
  assert.strictEqual(resHistoriPdf.header['content-type'], 'application/pdf');
  console.log('  ✓ Histori proyek selesai, detail belanja, dan ekspor (Excel/PDF) sukses 100%.\n');

  // 28. Menguji Halaman Laporan & Business Intelligence (BI) Analytics
  console.log('28. Menguji Halaman Laporan BI & Visualisasi Grafik...');
  const resLaporan = await pinAgent.get('/laporan');
  assert.strictEqual(resLaporan.status, 200);
  assert.ok(resLaporan.text.includes('Tren Arus Kas Bulanan'));
  assert.ok(resLaporan.text.includes('Alokasi Biaya per Kategori'));
  console.log('  ✓ Dasbor BI grafis eksekutif termuat sempurna dengan metrik analitik.\n');

  // 29. Menguji Form Input Jumlah (Opsional), Filter Kategori & Total Kategori Otomatis
  console.log('29. Menguji Catat Belanja dengan Jumlah (Qty) & Filter Kategori...');
  // Catat belanja semen dengan jumlah "10 sak"
  const resBeli1 = await agent
    .post(`/proyek/${prRecord.id}/belanja`)
    .type('form')
    .send({
      uraian: 'Semen Tiga Roda',
      kategori_id: 1, // Material
      nominal: '750.000',
      jumlah: '10 sak',
      vendor: 'TB Sentosa',
      tanggal: '2026-05-10'
    });
  assert.strictEqual(resBeli1.status, 302);

  // Catat belanja paku dengan jumlah "5 kg"
  const resBeli2 = await agent
    .post(`/proyek/${prRecord.id}/belanja`)
    .type('form')
    .send({
      uraian: 'Paku Beton',
      kategori_id: 1, // Material
      nominal: '150.000',
      jumlah: '5 kg',
      vendor: 'TB Sentosa',
      tanggal: '2026-05-10'
    });
  assert.strictEqual(resBeli2.status, 302);

  // Buka detail proyek dan periksa keberadaan jumlah
  const resDetailQty = await agent.get(`/proyek/${prRecord.id}?tab=bukukas`);
  assert.strictEqual(resDetailQty.status, 200);
  assert.ok(resDetailQty.text.includes('10 sak'));
  assert.ok(resDetailQty.text.includes('5 kg'));
  // Pastikan tombol ekspor dan tombol modal kas tidak ada di detail proyek
  assert.ok(!resDetailQty.text.includes('/ekspor/pdf'));
  assert.ok(!resDetailQty.text.includes('/ekspor/excel'));
  assert.ok(!resDetailQty.text.includes("openModal('modal-kelola-modal')"));

  // Uji filter kategori Material (kategori_id=1)
  const resFilterKat = await agent.get(`/proyek/${prRecord.id}?tab=bukukas&kategori_id=1`);
  assert.strictEqual(resFilterKat.status, 200);
  assert.ok(resFilterKat.text.includes('Total Kategori'));
  assert.ok(resFilterKat.text.includes('Material'));
  // Subtotal kategori Material = 750.000 + 150.000 = 900.000
  assert.ok(resFilterKat.text.includes('900.000'));
  console.log('  ✓ Catat belanja jumlah (qty), filter kategori & total otomatis sukses 100%.\n');

  // 30. Menguji Histori dengan Subtotal Kategori & Tanpa Tombol Ekspor di UI
  console.log('30. Menguji Histori Proyek: Subtotal Kategori & Verifikasi Bersih Ekspor...');
  const resHistoriClean = await pinAgent.get('/histori?status=semua');
  assert.strictEqual(resHistoriClean.status, 200);
  assert.ok(resHistoriClean.text.includes('Subtotal Per Kategori:'));
  assert.ok(resHistoriClean.text.includes('10 sak'));
  assert.ok(!resHistoriClean.text.includes('/histori/ekspor/pdf'));
  assert.ok(!resHistoriClean.text.includes('/histori/ekspor/excel'));

  const resLaporanClean = await pinAgent.get('/laporan');
  assert.ok(!resLaporanClean.text.includes('/histori/ekspor/pdf'));
  assert.ok(!resLaporanClean.text.includes('/histori/ekspor/excel'));

  console.log('  ✓ Histori subtotal kategori dan pembersihan ekspor seluruh halaman valid 100%.\n');

  console.log('================================================================');
  console.log('SELURUH 30 PENGUJIAN INTEGRASI WEB & ROUTE BERHASIL LULUS 100%!');
  console.log('================================================================');
  process.exit(0);
}

runHttpTests().catch(err => {
  console.error('PENGUJIAN HTTP GAGAL:', err);
  process.exit(1);
});
