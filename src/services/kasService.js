const { db } = require('../config/database');

function getTodayWIB() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const wib = new Date(utc + (3600000 * 7));
  return wib.toISOString().split('T')[0];
}

async function validateTanggalTransaksi(proyekId, tanggal) {
  if (!tanggal) return;
  const today = getTodayWIB();
  if (tanggal > today) {
    throw new Error(`Tanggal transaksi tidak boleh melebihi hari ini (${today})`);
  }
  const pr = await db.get('SELECT tanggal_mulai FROM proyek WHERE id = ?', [proyekId]);
  if (pr && pr.tanggal_mulai && tanggal < pr.tanggal_mulai) {
    throw new Error(`Tanggal transaksi tidak boleh sebelum tanggal mulai proyek (${pr.tanggal_mulai})`);
  }
}

/**
 * Deteksi kategori otomatis dari teks nama pengeluaran
 */
async function deteksiKategoriOtomatis(uraian, kategoriIdPilihan) {
  if (kategoriIdPilihan) {
    const valid = await db.get('SELECT id FROM kategori WHERE id = ? AND is_active = 1', [kategoriIdPilihan]);
    if (valid) return valid.id;
  }

  const teks = (uraian || '').toLowerCase();
  const allKat = await db.query('SELECT id, LOWER(nama) as nama FROM kategori WHERE is_active = 1');
  const katMap = {};
  for (const k of allKat) {
    katMap[k.nama] = k.id;
  }

  if (/semen|pasir|bata|hebel|besi|kawat|cat|keramik|granit|batu|koral|kayu|triplek|paku|paralon|pipa|kabel|genteng|baja|spandek|asbes|seng|nat|amplas|tiner|lem|gypsum|baut|screed|mortir/i.test(teks)) {
    if (katMap['material']) return katMap['material'];
  }
  if (/upah|tukang|pekerja|mandor|kenek|kernet|gaji|lembur|borongan|harian|ongkos/i.test(teks)) {
    if (katMap['upah kerja']) return katMap['upah kerja'];
  }
  if (/sewa|molen|bego|excavator|jack|scaffolding|perancah|genset|vibrator|pompa|stamper|alat/i.test(teks)) {
    if (katMap['sewa alat']) return katMap['sewa alat'];
  }
  if (/transport|bensin|solar|ongkir|armada|dump|angkut|tol|parkir/i.test(teks)) {
    if (katMap['transportasi']) return katMap['transportasi'];
  }
  if (/makan|konsumsi|kopi|air|galon|rokok|snack|pulsa|atk|listrik|pdam/i.test(teks)) {
    if (katMap['operasional']) return katMap['operasional'];
  }
  if (/izin|pbg|imb|retribusi|koordinasi|lingkungan|amdal/i.test(teks)) {
    if (katMap['perizinan']) return katMap['perizinan'];
  }
  if (/subkon|aluminium|baja ringan|plafon|kanopi|teralis|pagar|kaca/i.test(teks)) {
    if (katMap['subkontraktor']) return katMap['subkontraktor'];
  }

  if (katMap['lain-lain']) return katMap['lain-lain'];
  return allKat[0] ? allKat[0].id : 1;
}

class KasService {
  /**
   * Menghitung saldo kas proyek
   */
  async hitungSaldoProyek(proyekId) {
    const rows = await db.query(
      `SELECT jenis_transaksi, nominal 
       FROM transaksi 
       WHERE proyek_id = ? AND is_cancelled = 0`,
      [proyekId]
    );

    let MM = 0; // Modal Masuk
    let MT = 0; // Penarikan Modal
    let PL = 0; // Belanja Langsung

    for (const r of rows) {
      const nom = Number(r.nominal);
      switch (r.jenis_transaksi) {
        case 'MODAL_MASUK':
          MM += nom;
          break;
        case 'PENARIKAN_MODAL':
          MT += nom;
          break;
        case 'PENGELUARAN_LANGSUNG':
        case 'NOTA_PANJAR':
          PL += nom;
          break;
      }
    }

    const modalBersih = MM - MT;
    const saldoKas = MM - MT - PL;
    const biayaTerealisasi = PL;

    return {
      proyekId: Number(proyekId),
      modalBersih,
      saldoKas,
      biayaTerealisasi,
      panjarBeredar: 0,
      talanganBelumDiganti: 0,
      isKasMinus: saldoKas < 0,
      rincian: { MM, MT, PL }
    };
  }

  /**
   * Modal Masuk
   */
  async catatModalMasuk({ proyekId, nominal, tanggal, uraian, idempotencyKey, ipAddress }) {
    nominal = Number(String(nominal || 0).replace(/\./g, ''));
    if (!nominal || nominal <= 0 || nominal > 10000000000) {
      throw new Error('Nominal modal masuk harus lebih dari 0');
    }

    await validateTanggalTransaksi(proyekId, tanggal);

    return await db.transaction(async () => {
      if (idempotencyKey) {
        const exist = await db.get('SELECT id FROM transaksi WHERE idempotency_key = ?', [idempotencyKey]);
        if (exist) return exist.id;
      }

      const res = await db.run(
        `INSERT INTO transaksi (proyek_id, jenis_transaksi, nominal, tanggal_transaksi, uraian, idempotency_key)
         VALUES (?, 'MODAL_MASUK', ?, ?, ?, ?)`,
        [proyekId, nominal, tanggal, uraian || 'Setoran Modal', idempotencyKey]
      );

      await db.run(
        `INSERT INTO audit_logs (proyek_id, transaksi_id, aksi, keterangan, nilai_sesudah, ip_address)
         VALUES (?, ?, 'MODAL_MASUK', ?, ?, ?)`,
        [proyekId, res.lastID, `Setor modal Rp${nominal.toLocaleString('id-ID')}`, `Rp${nominal.toLocaleString('id-ID')}`, ipAddress]
      );

      return res.lastID;
    });
  }

  /**
   * Penarikan Modal
   */
  async catatPenarikanModal({ proyekId, nominal, tanggal, uraian, idempotencyKey, ipAddress }) {
    nominal = Number(String(nominal || 0).replace(/\./g, ''));
    if (!nominal || nominal <= 0 || nominal > 10000000000) {
      throw new Error('Nominal penarikan modal tidak valid');
    }

    await validateTanggalTransaksi(proyekId, tanggal);

    return await db.transaction(async () => {
      if (idempotencyKey) {
        const exist = await db.get('SELECT id FROM transaksi WHERE idempotency_key = ?', [idempotencyKey]);
        if (exist) return exist.id;
      }

      const saldo = await this.hitungSaldoProyek(proyekId);
      if (nominal > saldo.saldoKas) {
        throw new Error(`Penarikan modal (Rp${nominal.toLocaleString('id-ID')}) melebihi saldo kas (Rp${saldo.saldoKas.toLocaleString('id-ID')})`);
      }
      if (saldo.modalBersih - nominal < 0) {
        throw new Error('Penarikan modal tidak boleh membuat modal bersih menjadi negatif');
      }

      const res = await db.run(
        `INSERT INTO transaksi (proyek_id, jenis_transaksi, nominal, tanggal_transaksi, uraian, idempotency_key)
         VALUES (?, 'PENARIKAN_MODAL', ?, ?, ?, ?)`,
        [proyekId, nominal, tanggal, uraian || 'Tarik Modal', idempotencyKey]
      );

      await db.run(
        `INSERT INTO audit_logs (proyek_id, transaksi_id, aksi, keterangan, nilai_sesudah, ip_address)
         VALUES (?, ?, 'PENARIKAN_MODAL', ?, ?, ?)`,
        [proyekId, res.lastID, `Tarik modal Rp${nominal.toLocaleString('id-ID')}`, `Rp${nominal.toLocaleString('id-ID')}`, ipAddress]
      );

      return res.lastID;
    });
  }

  /**
   * Catat Belanja Langsung (Input simpel: nama pengeluaran & nominal, kategori otomatis / custom baru)
   */
  async catatPengeluaranLangsung({ proyekId, kategoriId, kategoriBaru, nominal, tanggal, uraian, vendor, jumlah, idempotencyKey, ipAddress }) {
    nominal = Number(String(nominal || 0).replace(/\./g, ''));
    if (!nominal || nominal <= 0 || nominal > 10000000000) {
      throw new Error('Nominal belanja harus lebih dari 0');
    }

    if (!uraian || uraian.trim().length === 0) {
      throw new Error('Nama pengeluaran belanja wajib diisi');
    }

    await validateTanggalTransaksi(proyekId, tanggal);

    const cleanJumlah = jumlah ? String(jumlah).trim() : null;

    // Tentukan kategori: kategori baru, kategori pilihan, atau otomatis
    let finalKategoriId;
    if (kategoriBaru && kategoriBaru.trim()) {
      const namaKat = kategoriBaru.trim();
      const existing = await db.get('SELECT id FROM kategori WHERE LOWER(nama) = LOWER(?)', [namaKat]);
      if (existing) {
        finalKategoriId = existing.id;
      } else {
        const ins = await db.run('INSERT INTO kategori (nama, is_active) VALUES (?, 1)', [namaKat]);
        finalKategoriId = ins.lastID;
      }
      // Pastikan ada anggaran_kategori untuk proyek ini
      await db.run(
        'INSERT OR IGNORE INTO anggaran_kategori (proyek_id, kategori_id, pagu_anggaran) VALUES (?, ?, 0)',
        [proyekId, finalKategoriId]
      );
    } else {
      finalKategoriId = await deteksiKategoriOtomatis(uraian, kategoriId);
    }

    return await db.transaction(async () => {
      if (idempotencyKey) {
        const exist = await db.get('SELECT id FROM transaksi WHERE idempotency_key = ?', [idempotencyKey]);
        if (exist) return exist.id;
      }

      const pr = await db.get('SELECT status FROM proyek WHERE id = ?', [proyekId]);
      if (!pr || pr.status !== 'Aktif') {
        throw new Error('Pencatatan belanja ditolak: status proyek bukan Aktif');
      }

      const res = await db.run(
        `INSERT INTO transaksi (proyek_id, kategori_id, jenis_transaksi, nominal, tanggal_transaksi, uraian, vendor, jumlah, idempotency_key)
         VALUES (?, ?, 'PENGELUARAN_LANGSUNG', ?, ?, ?, ?, ?, ?)`,
        [proyekId, finalKategoriId, nominal, tanggal, uraian.trim(), vendor?.trim() || null, cleanJumlah, idempotencyKey]
      );

      const txId = res.lastID;

      const ketJumlah = cleanJumlah ? ` [${cleanJumlah}]` : '';
      await db.run(
        `INSERT INTO audit_logs (proyek_id, transaksi_id, aksi, keterangan, nilai_sesudah, ip_address)
         VALUES (?, ?, 'BELANJA', ?, ?, ?)`,
        [proyekId, txId, `Belanja Rp${nominal.toLocaleString('id-ID')} (${uraian}${ketJumlah})`, `Rp${nominal.toLocaleString('id-ID')}`, ipAddress]
      );

      return txId;
    });
  }

  /**
   * Pembatalan Transaksi
   */
  async batalkanTransaksi(transaksiId, alasan, ipAddress) {
    if (!alasan || alasan.trim().length < 3) {
      throw new Error('Alasan pembatalan minimal 3 karakter');
    }

    return await db.transaction(async () => {
      const tx = await db.get('SELECT * FROM transaksi WHERE id = ?', [transaksiId]);
      if (!tx) throw new Error('Transaksi tidak ditemukan');
      if (tx.is_cancelled) return true;

      if (tx.jenis_transaksi === 'MODAL_MASUK') {
        const saldo = await this.hitungSaldoProyek(tx.proyek_id);
        if (saldo.modalBersih - Number(tx.nominal) < 0) {
          throw new Error('Pembatalan modal masuk ditolak: modal bersih tidak boleh negatif.');
        }
      }

      await db.run(
        `UPDATE transaksi 
         SET is_cancelled = 1, cancelled_at = CURRENT_TIMESTAMP, cancel_reason = ? 
         WHERE id = ?`,
        [alasan.trim(), tx.id]
      );

      await db.run(
        `INSERT INTO audit_logs (proyek_id, transaksi_id, aksi, keterangan, nilai_sebelum, nilai_sesudah, ip_address)
         VALUES (?, ?, 'BATAL', ?, ?, 'BATAL', ?)`,
        [tx.proyek_id, tx.id, `Batal ${tx.jenis_transaksi}: ${alasan}`, `Rp${tx.nominal}`, ipAddress]
      );

      return true;
    });
  }

  /**
   * Realisasi vs Anggaran Kategori
   */
  async getStatusAnggaranProyek(proyekId) {
    const list = await db.query(
      `SELECT k.id AS kategori_id, k.nama, 
        COALESCE(ak.pagu_anggaran, 0) AS pagu_anggaran,
        COALESCE((
          SELECT SUM(nominal) 
          FROM transaksi t 
          WHERE t.proyek_id = ? 
            AND t.kategori_id = k.id 
            AND t.jenis_transaksi IN ('PENGELUARAN_LANGSUNG', 'NOTA_PANJAR')
            AND t.is_cancelled = 0
        ), 0) AS realisasi
       FROM kategori k
       LEFT JOIN anggaran_kategori ak ON ak.kategori_id = k.id AND ak.proyek_id = ?
       WHERE k.is_active = 1
       ORDER BY k.id ASC`,
      [proyekId, proyekId]
    );

    return list.map(item => {
      const pagu = Number(item.pagu_anggaran);
      const real = Number(item.realisasi);
      const sisa = pagu - real;
      const persentase = pagu > 0 ? (real / pagu) * 100 : 0;

      let status = 'Aman';
      let badgeClass = 'text-emerald-700 bg-emerald-50 border-emerald-200';

      if (pagu > 0) {
        if (persentase > 100) {
          status = 'Melebihi';
          badgeClass = 'text-rose-700 bg-rose-50 border-rose-200';
        } else if (persentase >= 80) {
          status = 'Waspada';
          badgeClass = 'text-amber-700 bg-amber-50 border-amber-200';
        }
      }

      return {
        ...item,
        pagu_anggaran: pagu,
        realisasi: real,
        sisa_anggaran: sisa,
        persentase: Math.round(persentase),
        status,
        badgeClass
      };
    });
  }

  /**
   * Patokan Biaya Proyek Serupa per m²
   */
  async getPatokanProyekSerupa(proyekId) {
    const currentProyek = await db.get('SELECT * FROM proyek WHERE id = ?', [proyekId]);
    if (!currentProyek) return null;

    const rawList = await db.query(
      `SELECT p.id, p.nama, p.luas_m2, p.jenis_bangunan, c.nama AS nama_cabang, strftime('%Y', p.created_at) AS tahun,
        COALESCE((
          SELECT SUM(nominal) 
          FROM transaksi t 
          WHERE t.proyek_id = p.id 
            AND t.jenis_transaksi IN ('PENGELUARAN_LANGSUNG', 'NOTA_PANJAR')
            AND t.is_cancelled = 0
        ), 0) AS total_biaya
       FROM proyek p
       JOIN cabang c ON c.id = p.cabang_id
       WHERE p.jenis_bangunan = ? 
         AND p.status = 'Selesai'
         AND p.luas_m2 > 0
         AND p.id != ?`,
      [currentProyek.jenis_bangunan, currentProyek.id]
    );

    if (rawList.length < 2) {
      return {
        cukupData: false,
        jumlahPembanding: rawList.length,
        pembanding: rawList,
        pesan: 'Dibutuhkan minimal 2 proyek sejenis yang selesai.'
      };
    }

    const rates = rawList.map(p => {
      const biayaM2 = Math.round(Number(p.total_biaya) / Number(p.luas_m2));
      return {
        ...p,
        total_biaya: Number(p.total_biaya),
        biaya_per_m2: biayaM2
      };
    }).sort((a, b) => a.biaya_per_m2 - b.biaya_per_m2);

    const rateValues = rates.map(r => r.biaya_per_m2);
    const minRate = rateValues[0];
    const maxRate = rateValues[rateValues.length - 1];

    let medianRate = 0;
    const mid = Math.floor(rateValues.length / 2);
    if (rateValues.length % 2 === 0) {
      medianRate = Math.round((rateValues[mid - 1] + rateValues[mid]) / 2);
    } else {
      medianRate = rateValues[mid];
    }

    const luasSekarang = Number(currentProyek.luas_m2 || 0);
    const proyeksiMin = luasSekarang > 0 ? minRate * luasSekarang : 0;
    const proyeksiMax = luasSekarang > 0 ? maxRate * luasSekarang : 0;
    const proyeksiMedian = luasSekarang > 0 ? medianRate * luasSekarang : 0;

    return {
      cukupData: true,
      jumlahPembanding: rates.length,
      jenisBangunan: currentProyek.jenis_bangunan,
      luasSekarang,
      minRate,
      maxRate,
      medianRate,
      proyeksiMin,
      proyeksiMax,
      proyeksiMedian,
      pembanding: rates
    };
  }

  /**
   * Edit Teks Uraian / Vendor
   */
  async editTransaksi({ transaksiId, uraian, vendor, jumlah, ipAddress }) {
    if (!uraian || uraian.trim().length < 3) {
      throw new Error('Uraian minimal 3 karakter');
    }

    const cleanJumlah = jumlah !== undefined ? (String(jumlah || '').trim() || null) : undefined;

    return await db.transaction(async () => {
      const tx = await db.get('SELECT * FROM transaksi WHERE id = ?', [transaksiId]);
      if (!tx) throw new Error('Transaksi tidak ditemukan');
      if (tx.is_cancelled) throw new Error('Tidak dapat mengedit transaksi yang dibatalkan');

      const targetJumlah = cleanJumlah !== undefined ? cleanJumlah : tx.jumlah;
      const sebelum = `Uraian: "${tx.uraian}" | Qty: "${tx.jumlah || '-'}" | Vendor: "${tx.vendor || '-'}"`;
      const sesudah = `Uraian: "${uraian.trim()}" | Qty: "${targetJumlah || '-'}" | Vendor: "${vendor?.trim() || '-'}"`;

      await db.run(
        'UPDATE transaksi SET uraian = ?, vendor = ?, jumlah = ? WHERE id = ?',
        [uraian.trim(), vendor?.trim() || null, targetJumlah, transaksiId]
      );

      await db.run(
        `INSERT INTO audit_logs (proyek_id, transaksi_id, aksi, keterangan, nilai_sebelum, nilai_sesudah, ip_address)
         VALUES (?, ?, 'EDIT', ?, ?, ?, ?)`,
        [tx.proyek_id, transaksiId, 'Ubah uraian/vendor/jumlah belanja', sebelum, sesudah, ipAddress]
      );

      return true;
    });
  }

  /**
   * Salin Anggaran Kategori dari Proyek Lain
   */
  async salinAnggaran({ proyekTujuanId, proyekSumberId, ipAddress }) {
    return await db.transaction(async () => {
      const sumberProyek = await db.get('SELECT nama FROM proyek WHERE id = ?', [proyekSumberId]);
      if (!sumberProyek) throw new Error('Proyek sumber anggaran tidak ditemukan');

      const anggaranSumber = await db.query(
        'SELECT kategori_id, pagu_anggaran FROM anggaran_kategori WHERE proyek_id = ?',
        [proyekSumberId]
      );

      if (anggaranSumber.length === 0) {
        throw new Error('Proyek sumber belum memiliki alokasi anggaran');
      }

      for (const item of anggaranSumber) {
        await db.run(
          `INSERT INTO anggaran_kategori (proyek_id, kategori_id, pagu_anggaran, revisi_ke, alasan_revisi, updated_at)
           VALUES (?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(proyek_id, kategori_id) DO UPDATE SET
             pagu_anggaran = excluded.pagu_anggaran,
             revisi_ke = revisi_ke + 1,
             alasan_revisi = excluded.alasan_revisi,
             updated_at = CURRENT_TIMESTAMP`,
          [proyekTujuanId, item.kategori_id, item.pagu_anggaran, `Salin dari ${sumberProyek.nama}`]
        );
      }

      await db.run(
        `INSERT INTO audit_logs (proyek_id, aksi, keterangan, nilai_sesudah, ip_address)
         VALUES (?, 'SALIN_ANGGARAN', ?, ?, ?)`,
        [proyekTujuanId, `Salin anggaran dari ${sumberProyek.nama}`, `Proyek #${proyekSumberId}`, ipAddress]
      );

      return true;
    });
  }
}

module.exports = new KasService();
