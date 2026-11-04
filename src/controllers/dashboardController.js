const { db } = require('../config/database');
const kasService = require('../services/kasService');

class DashboardController {
  constructor() {
    this.index = this.index.bind(this);
    this.histori = this.histori.bind(this);
    this.riwayatTahunan = this.riwayatTahunan.bind(this);
  }

  async index(req, res) {
    try {
      const filterCabang = req.query.cabang_id ? Number(req.query.cabang_id) : null;
      const showArsip = req.query.show_arsip === '1';

      // Ambil cabang aktif
      const cabangList = await db.query('SELECT * FROM cabang ORDER BY is_active DESC, nama ASC');

      // Ambil proyek
      let querySql = `
        SELECT p.*, c.nama AS nama_cabang 
        FROM proyek p
        JOIN cabang c ON c.id = p.cabang_id
        WHERE 1=1
      `;
      const params = [];

      if (!showArsip) {
        querySql += " AND p.status != 'Arsip'";
      }

      if (filterCabang) {
        querySql += " AND p.cabang_id = ?";
        params.push(filterCabang);
      }

      querySql += " ORDER BY c.nama ASC, p.status ASC, p.tanggal_mulai DESC";

      const rawProyekList = await db.query(querySql, params);

      // Hitung metrik 5 pilar untuk setiap proyek
      const proyekList = [];
      for (const pr of rawProyekList) {
        const saldo = await kasService.hitungSaldoProyek(pr.id);
        proyekList.push({
          ...pr,
          saldo
        });
      }

      // Kelompokkan proyek per cabang (A-36: tanpa subtotal saldo kas cabang)
      const grupCabang = {};
      for (const c of cabangList) {
        if (!filterCabang || c.id === filterCabang) {
          grupCabang[c.id] = {
            id: c.id,
            nama: c.nama,
            kota: c.kota,
            is_active: c.is_active,
            proyek: []
          };
        }
      }

      for (const pr of proyekList) {
        if (grupCabang[pr.cabang_id]) {
          grupCabang[pr.cabang_id].proyek.push(pr);
        }
      }

      // Hitung ringkasan total portofolio
      const ringkasanTotal = {
        totalKas: 0,
        totalBelanja: 0,
        totalModal: 0,
        totalProyek: proyekList.length
      };

      for (const pr of proyekList) {
        ringkasanTotal.totalKas += pr.saldo.saldoKas;
        ringkasanTotal.totalBelanja += pr.saldo.biayaTerealisasi;
        ringkasanTotal.totalModal += pr.saldo.modalBersih;
      }

      res.render('dashboard', {
        cabangList,
        grupCabang: Object.values(grupCabang),
        filterCabang,
        showArsip,
        ringkasanTotal,
        success: req.query.success,
        error: req.query.error
      });
    } catch (err) {
      console.error('Dashboard Error:', err);
      res.render('dashboard', {
        cabangList: [],
        grupCabang: [],
        filterCabang: null,
        showArsip: false,
        error: 'Gagal memuat dasbor: ' + err.message
      });
    }
  }

  async histori(req, res) {
    try {
      const filterCabang = req.query.cabang_id ? Number(req.query.cabang_id) : null;
      const filterTahun = req.query.tahun || 'semua';
      const filterStatus = req.query.status || 'Selesai';
      const cari = req.query.cari ? req.query.cari.trim().toLowerCase() : '';

      // Ambil daftar tahun unik dari proyek selesai dan transaksi
      const listTahunRaw = await db.query(`
        SELECT DISTINCT strftime('%Y', COALESCE(p.tanggal_selesai, p.tanggal_mulai)) AS tahun 
        FROM proyek p 
        WHERE p.status = 'Selesai'
        UNION
        SELECT DISTINCT strftime('%Y', tanggal_transaksi) AS tahun 
        FROM transaksi 
        WHERE is_cancelled = 0
        ORDER BY tahun DESC
      `);
      let listTahun = listTahunRaw.map(t => t.tahun).filter(t => t && Number(t) > 0);
      const currentYearStr = String(new Date().getFullYear());
      if (!listTahun.includes(currentYearStr)) {
        listTahun.unshift(currentYearStr);
      }
      listTahun.sort((a, b) => Number(b) - Number(a));

      // Ambil seluruh cabang
      const cabangList = await db.query('SELECT * FROM cabang ORDER BY is_active DESC, nama ASC');

      // Ambil proyek sesuai filter histori
      let sqlProyek = `
        SELECT p.*, c.nama AS nama_cabang, c.kota AS kota_cabang
        FROM proyek p
        JOIN cabang c ON c.id = p.cabang_id
        WHERE 1=1
      `;
      const params = [];

      if (filterStatus === 'Selesai') {
        sqlProyek += " AND p.status = 'Selesai'";
      } else if (filterStatus === 'semua') {
        sqlProyek += " AND p.status != 'Arsip'";
      } else {
        sqlProyek += " AND p.status = ?";
        params.push(filterStatus);
      }

      if (filterCabang) {
        sqlProyek += " AND p.cabang_id = ?";
        params.push(filterCabang);
      }

      if (filterTahun && filterTahun !== 'semua') {
        sqlProyek += " AND (strftime('%Y', p.tanggal_selesai) = ? OR (p.tanggal_selesai IS NULL AND strftime('%Y', p.tanggal_mulai) = ?))";
        params.push(String(filterTahun), String(filterTahun));
      }

      sqlProyek += " ORDER BY c.nama ASC, p.tanggal_selesai DESC, p.tanggal_mulai DESC";

      const rawProyekList = await db.query(sqlProyek, params);

      // Hitung metrik keuangan & kumpulkan detail belanja tiap proyek
      const rekapCabangMap = {};
      for (const c of cabangList) {
        if (!filterCabang || c.id === filterCabang) {
          rekapCabangMap[c.id] = {
            cabang: c,
            modalMasuk: 0,
            penarikanModal: 0,
            biayaRealisasi: 0,
            saldoKas: 0,
            proyekList: []
          };
        }
      }

      let totalSemuaCabang = {
        modalMasuk: 0,
        penarikanModal: 0,
        biayaRealisasi: 0,
        saldoKas: 0,
        totalProyekSelesai: 0
      };

      for (const pr of rawProyekList) {
        if (cari && !pr.nama.toLowerCase().includes(cari) && !pr.jenis_bangunan.toLowerCase().includes(cari)) {
          continue;
        }

        const saldo = await kasService.hitungSaldoProyek(pr.id);

        // Ambil detail belanja proyek
        const belanjaList = await db.query(
          `SELECT t.*, k.nama AS nama_kategori
           FROM transaksi t
           LEFT JOIN kategori k ON k.id = t.kategori_id
           WHERE t.proyek_id = ? 
             AND t.is_cancelled = 0
             AND t.jenis_transaksi IN ('PENGELUARAN_LANGSUNG', 'NOTA_PANJAR')
           ORDER BY t.tanggal_transaksi ASC, t.id ASC`,
          [pr.id]
        );

        // Hitung durasi pengerjaan hari
        let durasiHari = null;
        if (pr.tanggal_mulai && pr.tanggal_selesai) {
          const t1 = new Date(pr.tanggal_mulai);
          const t2 = new Date(pr.tanggal_selesai);
          durasiHari = Math.max(1, Math.round((t2 - t1) / (1000 * 60 * 60 * 24)));
        }

        // Rekapitulasi subtotal per kategori belanja untuk histori
        const kategoriSubtotal = {};
        for (const b of belanjaList) {
          const kn = b.nama_kategori || 'Tanpa Kategori';
          kategoriSubtotal[kn] = (kategoriSubtotal[kn] || 0) + Number(b.nominal);
        }

        const pData = {
          id: pr.id,
          nama: pr.nama,
          jenis_bangunan: pr.jenis_bangunan,
          luas_m2: pr.luas_m2,
          lokasi: pr.lokasi,
          status: pr.status,
          tanggal_mulai: pr.tanggal_mulai,
          tanggal_selesai: pr.tanggal_selesai,
          durasiHari,
          modalMasuk: saldo.modalBersih,
          penarikanModal: saldo.totalPenarikanModal,
          biayaRealisasi: saldo.biayaTerealisasi,
          saldoKas: saldo.saldoKas,
          totalItemBelanja: belanjaList.length,
          transaksiBelanja: belanjaList,
          kategoriSubtotal
        };

        if (rekapCabangMap[pr.cabang_id]) {
          rekapCabangMap[pr.cabang_id].modalMasuk += pData.modalMasuk;
          rekapCabangMap[pr.cabang_id].penarikanModal += pData.penarikanModal;
          rekapCabangMap[pr.cabang_id].biayaRealisasi += pData.biayaRealisasi;
          rekapCabangMap[pr.cabang_id].saldoKas += pData.saldoKas;
          rekapCabangMap[pr.cabang_id].proyekList.push(pData);
        }

        totalSemuaCabang.modalMasuk += pData.modalMasuk;
        totalSemuaCabang.penarikanModal += pData.penarikanModal;
        totalSemuaCabang.biayaRealisasi += pData.biayaRealisasi;
        totalSemuaCabang.saldoKas += pData.saldoKas;
        totalSemuaCabang.totalProyekSelesai += 1;
      }

      const rekapCabang = Object.values(rekapCabangMap);

      res.render('laporan/histori', {
        filterCabang,
        filterTahun,
        filterStatus,
        cari,
        listTahun,
        cabangList,
        rekapCabang,
        totalSemuaCabang,
        success: req.query.success,
        error: req.query.error
      });
    } catch (err) {
      console.error('Histori Error:', err);
      res.redirect('/?error=' + encodeURIComponent('Gagal memuat histori: ' + err.message));
    }
  }

  async riwayatTahunan(req, res) {
    return this.histori(req, res);
  }
}

module.exports = new DashboardController();
