const { db } = require('../config/database');
const kasService = require('../services/kasService');

class ProyekController {
  async create(req, res) {
    try {
      const activeCabang = await db.query('SELECT * FROM cabang WHERE is_active = 1 ORDER BY id ASC');
      if (activeCabang.length === 0) {
        return res.redirect('/cabang?error=' + encodeURIComponent('Buat minimal satu cabang aktif terlebih dahulu sebelum mendaftarkan proyek baru (F-02)'));
      }

      // Ambil seluruh jenis konstruksi yang tersimpan
      const jenisRows = await db.query('SELECT nama FROM jenis_konstruksi ORDER BY id ASC');
      const jenisList = jenisRows.length > 0 
        ? jenisRows.map(j => j.nama) 
        : ['Rumah', 'Ruko', 'Renovasi', 'Gedung', 'Lainnya'];

      res.render('proyek/form', {
        cabangList: activeCabang,
        jenisList,
        error: req.query.error
      });
    } catch (err) {
      res.redirect('/?error=' + encodeURIComponent(err.message));
    }
  }

  async store(req, res) {
    let { cabang_id, nama, jenis_bangunan, jenis_bangunan_kustom, luas_m2, lokasi, tanggal_mulai, catatan, modal_awal } = req.body;

    // Jika cabang_id kosong (karena form disembunyikan saat cabang cuma 1), pilih otomatis cabang aktif
    if (!cabang_id) {
      const defaultCabang = await db.get('SELECT id FROM cabang WHERE is_active = 1 ORDER BY id ASC LIMIT 1');
      if (defaultCabang) {
        cabang_id = defaultCabang.id;
      } else {
        return res.redirect('/proyek/baru?error=' + encodeURIComponent('Cabang wajib dipilih (A-32)'));
      }
    }

    if (!nama || nama.trim().length < 3) {
      return res.redirect('/proyek/baru?error=' + encodeURIComponent('Nama proyek minimal 3 karakter'));
    }

    // Tangani jenis konstruksi kustom
    let finalJenis = (jenis_bangunan_kustom && jenis_bangunan_kustom.trim()) 
      ? jenis_bangunan_kustom.trim() 
      : (jenis_bangunan || '').trim();

    if (!finalJenis) {
      return res.redirect('/proyek/baru?error=' + encodeURIComponent('Jenis bangunan wajib dipilih'));
    }

    // Simpan permanen ke jenis_konstruksi agar seterusnya tersimpan untuk proyek-proyek berikutnya
    await db.run('INSERT OR IGNORE INTO jenis_konstruksi (nama) VALUES (?)', [finalJenis]);

    const luas = Number(luas_m2 || 0);
    if (luas_m2 && luas <= 0) {
      return res.redirect('/proyek/baru?error=' + encodeURIComponent('Luas bangunan harus berupa bilangan positif > 0'));
    }

    if (!tanggal_mulai) {
      return res.redirect('/proyek/baru?error=' + encodeURIComponent('Tanggal mulai proyek wajib diisi'));
    }

    try {
      const existing = await db.get('SELECT id FROM proyek WHERE LOWER(nama) = LOWER(?)', [nama.trim()]);
      if (existing) {
        return res.redirect('/proyek/baru?error=' + encodeURIComponent(`Proyek dengan nama "${nama}" sudah terdaftar`));
      }

      const resInsert = await db.run(
        `INSERT INTO proyek (cabang_id, nama, jenis_bangunan, luas_m2, lokasi, tanggal_mulai, status, catatan)
         VALUES (?, ?, ?, ?, ?, ?, 'Aktif', ?)`,
        [
          Number(cabang_id),
          nama.trim(),
          finalJenis,
          luas,
          lokasi?.trim() || null,
          tanggal_mulai,
          catatan?.trim() || null
        ]
      );

      const proyekId = resInsert.lastID;

      // Inisialisasi default pagu anggaran untuk kategori aktif
      const categories = await db.query('SELECT id FROM kategori WHERE is_active = 1');
      for (const c of categories) {
        await db.run(
          'INSERT OR IGNORE INTO anggaran_kategori (proyek_id, kategori_id, pagu_anggaran) VALUES (?, ?, 0)',
          [proyekId, c.id]
        );
      }

      // Catat modal awal mandiri untuk proyek ini jika diinput
      const cleanModalAwal = Number(String(modal_awal || 0).replace(/\./g, ''));
      if (cleanModalAwal > 0) {
        await kasService.catatModalMasuk({
          proyekId,
          nominal: cleanModalAwal,
          tanggal: tanggal_mulai,
          uraian: 'Modal Awal Proyek',
          ipAddress: req.ip
        });
      }

      await db.run(
        `INSERT INTO audit_logs (proyek_id, aksi, keterangan, nilai_sesudah, ip_address)
         VALUES (?, 'BUAT_PROYEK', ?, ?, ?)`,
        [proyekId, `Pendaftaran proyek baru: ${nama.trim()}`, `Cabang #${cabang_id} | Modal: Rp${cleanModalAwal.toLocaleString('id-ID')}`, req.ip]
      );

      res.redirect(`/proyek/${proyekId}?success=` + encodeURIComponent('Proyek berhasil didaftarkan'));
    } catch (err) {
      res.redirect('/proyek/baru?error=' + encodeURIComponent(err.message));
    }
  }

  async detail(req, res) {
    const { id } = req.params;
    try {
      const proyek = await db.get(
        `SELECT p.*, c.nama AS nama_cabang 
         FROM proyek p 
         JOIN cabang c ON c.id = p.cabang_id 
         WHERE p.id = ?`,
        [id]
      );

      if (!proyek) {
        return res.redirect('/?error=' + encodeURIComponent('Proyek tidak ditemukan'));
      }

      // Hitung 5 pilar keuangan proyek
      const saldo = await kasService.hitungSaldoProyek(proyek.id);

      // Status anggaran kategori
      const anggaranList = await kasService.getStatusAnggaranProyek(proyek.id);
      const totalPaguAnggaran = anggaranList.reduce((acc, curr) => acc + curr.pagu_anggaran, 0);

      // Patokan biaya m2
      const patokan = await kasService.getPatokanProyekSerupa(proyek.id);

      // Daftar kategori untuk dropdown
      const kategoriList = await db.query('SELECT * FROM kategori WHERE is_active = 1 ORDER BY nama ASC');

      // Daftar cabang untuk modal pindah cabang
      const cabangList = await db.query('SELECT * FROM cabang WHERE is_active = 1 ORDER BY nama ASC');

      // Daftar jenis konstruksi tersimpan
      const jenisRows = await db.query('SELECT nama FROM jenis_konstruksi ORDER BY id ASC');
      const jenisList = jenisRows.length > 0 ? jenisRows.map(j => j.nama) : ['Rumah', 'Ruko', 'Renovasi', 'Gedung', 'Lainnya'];

      // Filter buku kas
      const filterKategori = req.query.kategori_id ? Number(req.query.kategori_id) : null;
      const filterJenis = req.query.jenis || null;
      const showCancelled = req.query.show_cancelled === '1';

      let txSql = `
        SELECT t.*, k.nama AS nama_kategori
        FROM transaksi t
        LEFT JOIN kategori k ON k.id = t.kategori_id
        WHERE t.proyek_id = ?
      `;
      const txParams = [proyek.id];

      if (!showCancelled) {
        txSql += " AND t.is_cancelled = 0";
      }
      if (filterKategori) {
        txSql += " AND t.kategori_id = ?";
        txParams.push(filterKategori);
      }
      if (filterJenis) {
        txSql += " AND t.jenis_transaksi = ?";
        txParams.push(filterJenis);
      }

      txSql += " ORDER BY t.tanggal_transaksi DESC, t.id DESC";

      const transaksiList = await db.query(txSql, txParams);

      // Hitung total pengeluaran kategori ketika filter kategori aktif
      let totalFilterKategori = 0;
      let namaFilterKategori = '';
      if (filterKategori) {
        const katObj = kategoriList.find(k => k.id === filterKategori);
        if (katObj) namaFilterKategori = katObj.nama;
        totalFilterKategori = transaksiList
          .filter(t => !t.is_cancelled && (t.jenis_transaksi === 'PENGELUARAN_LANGSUNG' || t.jenis_transaksi === 'NOTA_PANJAR'))
          .reduce((acc, curr) => acc + Number(curr.nominal), 0);
      }

      // Hitung saldo kas berjalan (running balance)
      let currentRunningKas = 0;
      const allTxChronological = await db.query(
        "SELECT * FROM transaksi WHERE proyek_id = ? AND is_cancelled = 0 ORDER BY tanggal_transaksi ASC, id ASC",
        [proyek.id]
      );
      const runningBalanceMap = {};
      for (const t of allTxChronological) {
        const nom = Number(t.nominal);
        switch (t.jenis_transaksi) {
          case 'MODAL_MASUK':
            currentRunningKas += nom;
            break;
          case 'PENARIKAN_MODAL':
            currentRunningKas -= nom;
            break;
          case 'PENGELUARAN_LANGSUNG':
          case 'NOTA_PANJAR':
            currentRunningKas -= nom;
            break;
        }
        runningBalanceMap[t.id] = currentRunningKas;
      }

      // Jejak Audit Proyek
      const auditLogs = await db.query(
        'SELECT * FROM audit_logs WHERE proyek_id = ? ORDER BY id DESC LIMIT 50',
        [proyek.id]
      );

      // Daftar proyek lain untuk fitur Salin Anggaran
      const otherProjects = await db.query('SELECT id, nama FROM proyek WHERE id != ? ORDER BY nama ASC', [proyek.id]);

      res.render('proyek/detail', {
        proyek,
        saldo,
        totalPaguAnggaran,
        anggaranList,
        patokan,
        kategoriList,
        cabangList,
        jenisList,
        transaksiList,
        runningBalanceMap,
        auditLogs,
        otherProjects,
        activeTab: req.query.tab || 'bukukas',
        filterKategori,
        totalFilterKategori,
        namaFilterKategori,
        filterJenis,
        showCancelled,
        success: req.query.success,
        error: req.query.error
      });
    } catch (err) {
      console.error('Proyek Detail Error:', err);
      res.redirect('/?error=' + encodeURIComponent('Gagal memuat detail proyek: ' + err.message));
    }
  }

  async updateStatus(req, res) {
    const { id } = req.params;
    const { status, alasan, tanggal_selesai } = req.body;

    try {
      const proyek = await db.get('SELECT * FROM proyek WHERE id = ?', [id]);
      if (!proyek) {
        return res.redirect('/?error=' + encodeURIComponent('Proyek tidak ditemukan'));
      }

      // Validasi transisi status ke 'Selesai' (BR-13)
      let tglSelesai = proyek.tanggal_selesai;
      if (status === 'Selesai') {
        const saldo = await kasService.hitungSaldoProyek(id);
        if (saldo.panjarBeredar > 0) {
          return res.redirect(`/proyek/${id}?error=` + encodeURIComponent(
            `Status Selesai ditolak: masih terdapat Panjar Beredar sebesar Rp${saldo.panjarBeredar.toLocaleString('id-ID')}`
          ));
        }
        if (saldo.talanganBelumDiganti > 0) {
          return res.redirect(`/proyek/${id}?error=` + encodeURIComponent(
            `Status Selesai ditolak: masih terdapat Talangan Belum Diganti sebesar Rp${saldo.talanganBelumDiganti.toLocaleString('id-ID')}`
          ));
        }
        const todayWIB = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
        tglSelesai = (tanggal_selesai && tanggal_selesai.trim()) ? tanggal_selesai.trim() : todayWIB;
        if (tglSelesai < proyek.tanggal_mulai) {
          return res.redirect(`/proyek/${id}?error=` + encodeURIComponent('Tanggal berakhir tidak boleh mendahului tanggal mulai proyek (' + proyek.tanggal_mulai + ')'));
        }
      } else if (status === 'Aktif') {
        tglSelesai = null;
      }

      await db.run('UPDATE proyek SET status = ?, tanggal_selesai = ? WHERE id = ?', [status, tglSelesai, id]);

      await db.run(
        `INSERT INTO audit_logs (proyek_id, aksi, keterangan, nilai_sebelum, nilai_sesudah, ip_address)
         VALUES (?, 'UPDATE_STATUS_PROYEK', ?, ?, ?, ?)`,
        [id, `Ubah status proyek menjadi ${status} (${alasan || 'Pembaruan status'})`, proyek.status, `${status}${tglSelesai ? ' (Berakhir: ' + tglSelesai + ')' : ''}`, req.ip]
      );

      res.redirect(`/proyek/${id}?success=` + encodeURIComponent(`Status proyek berhasil diubah menjadi "${status}"`));
    } catch (err) {
      res.redirect(`/proyek/${id}?error=` + encodeURIComponent(err.message));
    }
  }

  async akhiriProyek(req, res) {
    const { id } = req.params;
    let { tanggal_selesai, catatan_selesai } = req.body;

    try {
      const proyek = await db.get('SELECT * FROM proyek WHERE id = ?', [id]);
      if (!proyek) {
        return res.redirect('/?error=' + encodeURIComponent('Proyek tidak ditemukan'));
      }

      const todayWIB = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
      const tglSelesai = (tanggal_selesai && tanggal_selesai.trim()) ? tanggal_selesai.trim() : todayWIB;

      if (tglSelesai < proyek.tanggal_mulai) {
        return res.redirect(`/proyek/${id}?error=` + encodeURIComponent(`Tanggal berakhir (${tglSelesai}) tidak boleh mendahului tanggal mulai proyek (${proyek.tanggal_mulai})`));
      }

      const saldo = await kasService.hitungSaldoProyek(id);
      if (saldo.panjarBeredar > 0) {
        return res.redirect(`/proyek/${id}?error=` + encodeURIComponent(
          `Proyek belum dapat diakhiri: masih terdapat Panjar Beredar sebesar Rp${saldo.panjarBeredar.toLocaleString('id-ID')}`
        ));
      }
      if (saldo.talanganBelumDiganti > 0) {
        return res.redirect(`/proyek/${id}?error=` + encodeURIComponent(
          `Proyek belum dapat diakhiri: masih terdapat Talangan Belum Diganti sebesar Rp${saldo.talanganBelumDiganti.toLocaleString('id-ID')}`
        ));
      }

      let catatanBaru = proyek.catatan || '';
      if (catatan_selesai && catatan_selesai.trim()) {
        catatanBaru = catatanBaru ? `${catatanBaru}\nCatatan Penutupan (${tglSelesai}): ${catatan_selesai.trim()}` : `Catatan Penutupan (${tglSelesai}): ${catatan_selesai.trim()}`;
      }

      await db.run(
        'UPDATE proyek SET status = ?, tanggal_selesai = ?, catatan = ? WHERE id = ?',
        ['Selesai', tglSelesai, catatanBaru, id]
      );

      await db.run(
        `INSERT INTO audit_logs (proyek_id, aksi, keterangan, nilai_sebelum, nilai_sesudah, ip_address)
         VALUES (?, 'AKHIRI_PROYEK', ?, ?, ?, ?)`,
        [
          id,
          `Proyek resmi diakhiri dan dipindahkan ke Histori`,
          `Status: ${proyek.status}`,
          `Status: Selesai | Berakhir: ${tglSelesai} | Kas Sisa: Rp${saldo.saldoKas.toLocaleString('id-ID')} | Belanja: Rp${saldo.biayaTerealisasi.toLocaleString('id-ID')}`,
          req.ip
        ]
      );

      res.redirect(`/proyek/${id}?success=` + encodeURIComponent(`Proyek "${proyek.nama}" resmi diakhiri pada tanggal ${tglSelesai} dan tersimpan di Histori.`));
    } catch (err) {
      console.error('Akhiri Proyek Error:', err);
      res.redirect(`/proyek/${id}?error=` + encodeURIComponent(err.message));
    }
  }

  async aktifkanKembali(req, res) {
    const { id } = req.params;
    try {
      const proyek = await db.get('SELECT * FROM proyek WHERE id = ?', [id]);
      if (!proyek) {
        return res.redirect('/?error=' + encodeURIComponent('Proyek tidak ditemukan'));
      }

      await db.run('UPDATE proyek SET status = ?, tanggal_selesai = NULL WHERE id = ?', ['Aktif', id]);

      await db.run(
        `INSERT INTO audit_logs (proyek_id, aksi, keterangan, nilai_sebelum, nilai_sesudah, ip_address)
         VALUES (?, 'REAKTIVASI_PROYEK', ?, ?, ?, ?)`,
        [id, `Mengaktifkan kembali proyek ke status berjalan`, proyek.status, 'Aktif', req.ip]
      );

      res.redirect(`/proyek/${id}?success=` + encodeURIComponent(`Proyek "${proyek.nama}" diaktifkan kembali sebagai proyek berjalan.`));
    } catch (err) {
      console.error('Reaktivasi Proyek Error:', err);
      res.redirect(`/proyek/${id}?error=` + encodeURIComponent(err.message));
    }
  }

  async pindahCabang(req, res) {
    const { id } = req.params;
    const { cabang_id, alasan } = req.body;

    if (!cabang_id) {
      return res.redirect(`/proyek/${id}?error=` + encodeURIComponent('Cabang tujuan wajib dipilih'));
    }

    try {
      const proyek = await db.get('SELECT * FROM proyek WHERE id = ?', [id]);
      const cabangBaru = await db.get('SELECT * FROM cabang WHERE id = ?', [cabang_id]);

      if (!cabangBaru) {
        return res.redirect(`/proyek/${id}?error=` + encodeURIComponent('Cabang tujuan tidak ditemukan'));
      }

      await db.run('UPDATE proyek SET cabang_id = ? WHERE id = ?', [cabang_id, id]);

      await db.run(
        `INSERT INTO audit_logs (proyek_id, aksi, keterangan, nilai_sebelum, nilai_sesudah, ip_address)
         VALUES (?, 'PINDAH_CABANG', ?, ?, ?, ?)`,
        [id, `Pindah cabang ke ${cabangBaru.nama}: ${alasan || 'Penataan wilayah'}`, `Cabang #${proyek.cabang_id}`, `Cabang #${cabang_id}`, req.ip]
      );

      res.redirect(`/proyek/${id}?success=` + encodeURIComponent(`Proyek berhasil dipindahkan ke cabang "${cabangBaru.nama}"`));
    } catch (err) {
      res.redirect(`/proyek/${id}?error=` + encodeURIComponent(err.message));
    }
  }

  async updateAnggaran(req, res) {
    const { id } = req.params;
    const { kategori_id, pagu_anggaran, alasan_revisi } = req.body;

    const nominalPagu = Number(String(pagu_anggaran || 0).replace(/\./g, ''));
    if (nominalPagu < 0) {
      return res.redirect(`/proyek/${id}?tab=anggaran&error=` + encodeURIComponent('Pagu anggaran tidak boleh bernilai negatif'));
    }

    try {
      const existing = await db.get(
        'SELECT * FROM anggaran_kategori WHERE proyek_id = ? AND kategori_id = ?',
        [id, kategori_id]
      );

      const revisiKe = existing ? (existing.revisi_ke || 1) + 1 : 1;
      const nilaiSebelum = existing ? `Rp${Number(existing.pagu_anggaran).toLocaleString('id-ID')}` : 'Rp0';

      await db.run(
        `INSERT INTO anggaran_kategori (proyek_id, kategori_id, pagu_anggaran, revisi_ke, alasan_revisi, updated_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(proyek_id, kategori_id) DO UPDATE SET
           pagu_anggaran = excluded.pagu_anggaran,
           revisi_ke = excluded.revisi_ke,
           alasan_revisi = excluded.alasan_revisi,
           updated_at = CURRENT_TIMESTAMP`,
        [id, kategori_id, nominalPagu, revisiKe, alasan_revisi?.trim() || null]
      );

      await db.run(
        `INSERT INTO audit_logs (proyek_id, aksi, keterangan, nilai_sebelum, nilai_sesudah, ip_address)
         VALUES (?, 'REVISI_ANGGARAN', ?, ?, ?, ?)`,
        [id, `Revisi pagu anggaran kategori #${kategori_id}: ${alasan_revisi || 'Penyesuaian rencana'}`, nilaiSebelum, `Rp${nominalPagu.toLocaleString('id-ID')}`, req.ip]
      );

      res.redirect(`/proyek/${id}?tab=anggaran&success=` + encodeURIComponent('Anggaran kategori berhasil diperbarui'));
    } catch (err) {
      res.redirect(`/proyek/${id}?tab=anggaran&error=` + encodeURIComponent(err.message));
    }
  }

  async tambahKategori(req, res) {
    const { nama, proyek_id } = req.body;
    if (!nama || nama.trim().length < 2) {
      return res.redirect(proyek_id ? `/proyek/${proyek_id}?tab=anggaran&error=` + encodeURIComponent('Nama kategori minimal 2 karakter') : '/?error=Nama tidak valid');
    }

    try {
      const exist = await db.get('SELECT id FROM kategori WHERE LOWER(nama) = LOWER(?)', [nama.trim()]);
      let katId = exist ? exist.id : null;
      if (!exist) {
        const ins = await db.run('INSERT INTO kategori (nama, is_active) VALUES (?, 1)', [nama.trim()]);
        katId = ins.lastID;
      }

      if (proyek_id) {
        await db.run('INSERT OR IGNORE INTO anggaran_kategori (proyek_id, kategori_id, pagu_anggaran) VALUES (?, ?, 0)', [proyek_id, katId]);
        return res.redirect(`/proyek/${proyek_id}?tab=anggaran&success=` + encodeURIComponent(`Kategori "${nama.trim()}" berhasil ditambahkan`));
      }

      res.redirect('/?success=' + encodeURIComponent('Kategori berhasil ditambahkan'));
    } catch (err) {
      res.redirect(proyek_id ? `/proyek/${proyek_id}?tab=anggaran&error=` + encodeURIComponent(err.message) : '/?error=' + encodeURIComponent(err.message));
    }
  }

  async updateMetadata(req, res) {
    const { id } = req.params;
    const { nama, jenis_bangunan, luas_m2, lokasi, tanggal_mulai, catatan } = req.body;

    if (!nama || nama.trim().length < 3) {
      return res.redirect(`/proyek/${id}?tab=pengaturan&error=` + encodeURIComponent('Nama proyek minimal 3 karakter'));
    }

    const luas = Number(luas_m2 || 0);
    if (luas_m2 && luas <= 0) {
      return res.redirect(`/proyek/${id}?tab=pengaturan&error=` + encodeURIComponent('Luas bangunan harus > 0'));
    }

    if (!tanggal_mulai) {
      return res.redirect(`/proyek/${id}?tab=pengaturan&error=` + encodeURIComponent('Tanggal mulai proyek wajib diisi'));
    }

    try {
      const existingName = await db.get('SELECT id FROM proyek WHERE LOWER(nama) = LOWER(?) AND id != ?', [nama.trim(), id]);
      if (existingName) {
        return res.redirect(`/proyek/${id}?tab=pengaturan&error=` + encodeURIComponent(`Nama proyek "${nama}" sudah dipakai proyek lain`));
      }

      const current = await db.get('SELECT * FROM proyek WHERE id = ?', [id]);
      if (!current) {
        return res.redirect('/?error=' + encodeURIComponent('Proyek tidak ditemukan'));
      }

      const sebelum = `Nama: ${current.nama}, Jenis: ${current.jenis_bangunan}, Luas: ${current.luas_m2}m2, Tgl Mulai: ${current.tanggal_mulai}`;
      const sesudah = `Nama: ${nama.trim()}, Jenis: ${jenis_bangunan}, Luas: ${luas}m2, Tgl Mulai: ${tanggal_mulai}`;

      if (jenis_bangunan && jenis_bangunan.trim()) {
        await db.run('INSERT OR IGNORE INTO jenis_konstruksi (nama) VALUES (?)', [jenis_bangunan.trim()]);
      }

      await db.run(
        `UPDATE proyek 
         SET nama = ?, jenis_bangunan = ?, luas_m2 = ?, lokasi = ?, tanggal_mulai = ?, catatan = ? 
         WHERE id = ?`,
        [nama.trim(), jenis_bangunan, luas, lokasi?.trim() || null, tanggal_mulai, catatan?.trim() || null, id]
      );

      await db.run(
        `INSERT INTO audit_logs (proyek_id, aksi, keterangan, nilai_sebelum, nilai_sesudah, ip_address)
         VALUES (?, 'UPDATE_METADATA_PROYEK', ?, ?, ?, ?)`,
        [id, 'Pembaruan data spesifikasi proyek (F-03)', sebelum, sesudah, req.ip]
      );

      res.redirect(`/proyek/${id}?tab=pengaturan&success=` + encodeURIComponent('Data spesifikasi proyek berhasil diperbarui'));
    } catch (err) {
      res.redirect(`/proyek/${id}?tab=pengaturan&error=` + encodeURIComponent(err.message));
    }
  }

  async salinAnggaran(req, res) {
    const { id } = req.params;
    const { sumber_proyek_id } = req.body;

    if (!sumber_proyek_id) {
      return res.redirect(`/proyek/${id}?tab=anggaran&error=` + encodeURIComponent('Pilih proyek sumber anggaran'));
    }

    try {
      await kasService.salinAnggaran({
        proyekTujuanId: id,
        proyekSumberId: sumber_proyek_id,
        ipAddress: req.ip
      });

      res.redirect(`/proyek/${id}?tab=anggaran&success=` + encodeURIComponent('Susunan anggaran berhasil disalin dari proyek lain (F-17)'));
    } catch (err) {
      res.redirect(`/proyek/${id}?tab=anggaran&error=` + encodeURIComponent(err.message));
    }
  }
}

module.exports = new ProyekController();
