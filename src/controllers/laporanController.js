const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { db } = require('../config/database');
const kasService = require('../services/kasService');

// Fungsi netralisasi injeksi formula spreadsheet (F-14)
function escapeFormula(str) {
  if (!str) return '';
  const s = String(str);
  if (['=', '+', '-', '@'].includes(s.charAt(0))) {
    return "'" + s;
  }
  return s;
}

// Gaya tabel profesional untuk berkas Excel (Corporate Office Grade)
const BORDER_THIN = {
  top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
};

const BORDER_TOTAL = {
  top: { style: 'thin', color: { argb: 'FF0F172A' } },
  left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  bottom: { style: 'double', color: { argb: 'FF0F172A' } },
  right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
};

function formatHeaderRow(row, bgArgb = 'FF0F172A') {
  row.height = 24;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: bgArgb }
    };
    cell.font = {
      name: 'Calibri',
      size: 10,
      bold: true,
      color: { argb: 'FFFFFFFF' }
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
    cell.border = BORDER_THIN;
  });
}

function formatDataRow(row, isEven = false) {
  row.height = 20;
  row.eachCell({ includeEmpty: true }, (cell) => {
    if (isEven) {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF8FAFC' }
      };
    }
    cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF1E293B' } };
    cell.border = BORDER_THIN;
    cell.alignment = { vertical: 'middle' };
  });
}

function formatTotalRow(row) {
  row.height = 22;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE2E8F0' }
    };
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
    cell.border = BORDER_TOTAL;
    cell.alignment = { vertical: 'middle' };
  });
}

class LaporanController {
  constructor() {
    this.biDashboard = this.biDashboard.bind(this);
    this.eksporProyekExcel = this.eksporProyekExcel.bind(this);
    this.eksporProyekPdf = this.eksporProyekPdf.bind(this);
    this.eksporHistoriExcel = this.eksporHistoriExcel.bind(this);
    this.eksporTahunanExcel = this.eksporTahunanExcel.bind(this);
    this.eksporHistoriPdf = this.eksporHistoriPdf.bind(this);
    this.eksporTahunanPdf = this.eksporTahunanPdf.bind(this);
    this.unduhCadangan = this.unduhCadangan.bind(this);
  }

  /**
   * Executive Business Intelligence (BI) Analytics Dashboard
   */
  async biDashboard(req, res) {
    try {
      const filterCabang = req.query.cabang_id ? Number(req.query.cabang_id) : null;
      const filterTahun = req.query.tahun || String(new Date().getFullYear());
      const filterStatus = req.query.status || 'semua';

      // 1. Ambil list cabang & list tahun
      const cabangList = await db.query('SELECT * FROM cabang ORDER BY is_active DESC, nama ASC');
      const listTahunRaw = await db.query(`
        SELECT DISTINCT strftime('%Y', tanggal_transaksi) as tahun 
        FROM transaksi WHERE is_cancelled = 0 AND tanggal_transaksi IS NOT NULL
        UNION
        SELECT DISTINCT strftime('%Y', tanggal_mulai) as tahun FROM proyek
        ORDER BY tahun DESC
      `);
      let listTahun = listTahunRaw.map(t => t.tahun).filter(t => t && Number(t) > 0);
      const curYear = String(new Date().getFullYear());
      if (!listTahun.includes(curYear)) listTahun.unshift(curYear);
      listTahun.sort((a, b) => Number(b) - Number(a));

      // 2. Query proyek yang relevan
      let sqlProyek = `
        SELECT p.*, c.nama as nama_cabang, c.kota as kota_cabang 
        FROM proyek p
        JOIN cabang c ON c.id = p.cabang_id
        WHERE 1=1
      `;
      const pParams = [];
      if (filterCabang) {
        sqlProyek += " AND p.cabang_id = ?";
        pParams.push(filterCabang);
      }
      if (filterStatus && filterStatus !== 'semua') {
        sqlProyek += " AND p.status = ?";
        pParams.push(filterStatus);
      } else {
        sqlProyek += " AND p.status != 'Arsip'";
      }
      sqlProyek += " ORDER BY p.tanggal_mulai DESC";

      const rawProyek = await db.query(sqlProyek, pParams);

      // Hitung metrik keuangan tiap proyek
      let totalModalPortofolio = 0;
      let totalBelanjaPortofolio = 0;
      let totalKasPortofolio = 0;
      let totalLuasM2 = 0;
      let countAktif = 0;
      let countSelesai = 0;

      const proyekAnalytics = [];
      for (const pr of rawProyek) {
        const saldo = await kasService.hitungSaldoProyek(pr.id);
        totalModalPortofolio += saldo.modalBersih;
        totalBelanjaPortofolio += saldo.biayaTerealisasi;
        totalKasPortofolio += saldo.saldoKas;
        totalLuasM2 += Number(pr.luas_m2 || 0);

        if (pr.status === 'Aktif') countAktif++;
        if (pr.status === 'Selesai') countSelesai++;

        // Hitung rasio serapan & biaya per m2
        const serapanPct = saldo.modalBersih > 0 ? Math.round((saldo.biayaTerealisasi / saldo.modalBersih) * 100) : 0;
        const biayaPerM2 = pr.luas_m2 > 0 ? Math.round(saldo.biayaTerealisasi / pr.luas_m2) : 0;

        let statusKesehatan = 'Sehat';
        if (saldo.isKasMinus || saldo.saldoKas < 0) {
          statusKesehatan = 'Defisit';
        } else if (serapanPct >= 90) {
          statusKesehatan = 'Waspada';
        }

        proyekAnalytics.push({
          id: pr.id,
          nama: pr.nama,
          cabang: pr.nama_cabang,
          jenis: pr.jenis_bangunan,
          luas: pr.luas_m2,
          status: pr.status,
          modal: saldo.modalBersih,
          belanja: saldo.biayaTerealisasi,
          saldoKas: saldo.saldoKas,
          serapanPct,
          biayaPerM2,
          statusKesehatan,
          isMinus: saldo.isKasMinus
        });
      }

      // Rasio Serapan Portofolio Global
      const rasioSerapanPortofolio = totalModalPortofolio > 0 
        ? Math.round((totalBelanjaPortofolio / totalModalPortofolio) * 100) 
        : 0;

      // 3. Data Grafik 1: Arus Kas Bulanan (Tahun Terpilih)
      const namaBulan = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
      const monthlyInflow = new Array(12).fill(0);
      const monthlyOutflow = new Array(12).fill(0);

      let txSql = `
        SELECT 
          strftime('%m', t.tanggal_transaksi) as bulan,
          t.jenis_transaksi,
          SUM(t.nominal) as total
        FROM transaksi t
        JOIN proyek p ON p.id = t.proyek_id
        WHERE t.is_cancelled = 0
      `;
      const txParams = [];
      if (filterTahun && filterTahun !== 'semua') {
        txSql += " AND strftime('%Y', t.tanggal_transaksi) = ?";
        txParams.push(String(filterTahun));
      }
      if (filterCabang) {
        txSql += " AND p.cabang_id = ?";
        txParams.push(filterCabang);
      }
      txSql += " GROUP BY bulan, t.jenis_transaksi ORDER BY bulan ASC";

      const txMonthly = await db.query(txSql, txParams);
      for (const row of txMonthly) {
        const bIdx = Number(row.bulan) - 1;
        if (bIdx >= 0 && bIdx < 12) {
          if (row.jenis_transaksi === 'MODAL_MASUK') {
            monthlyInflow[bIdx] += Number(row.total);
          } else if (row.jenis_transaksi === 'PENGELUARAN_LANGSUNG' || row.jenis_transaksi === 'NOTA_PANJAR') {
            monthlyOutflow[bIdx] += Number(row.total);
          }
        }
      }

      // 4. Data Grafik 2: Komposisi Pengeluaran per Kategori
      let katSql = `
        SELECT 
          COALESCE(k.nama, 'Lain-lain') as kategori,
          SUM(t.nominal) as total
        FROM transaksi t
        JOIN proyek p ON p.id = t.proyek_id
        LEFT JOIN kategori k ON k.id = t.kategori_id
        WHERE t.is_cancelled = 0
          AND t.jenis_transaksi IN ('PENGELUARAN_LANGSUNG', 'NOTA_PANJAR')
      `;
      const katParams = [];
      if (filterTahun && filterTahun !== 'semua') {
        katSql += " AND strftime('%Y', t.tanggal_transaksi) = ?";
        katParams.push(String(filterTahun));
      }
      if (filterCabang) {
        katSql += " AND p.cabang_id = ?";
        katParams.push(filterCabang);
      }
      katSql += " GROUP BY k.id, k.nama ORDER BY total DESC";

      const katDataRaw = await db.query(katSql, katParams);
      const totalSemuaKat = katDataRaw.reduce((acc, curr) => acc + Number(curr.total), 0);
      const categoryChart = {
        labels: katDataRaw.map(k => k.kategori),
        data: katDataRaw.map(k => Number(k.total)),
        percentages: katDataRaw.map(k => totalSemuaKat > 0 ? Math.round((Number(k.total) / totalSemuaKat) * 100) : 0)
      };

      // 5. Data Grafik 3: Perbandingan Modal vs Belanja 8 Proyek Terbesar
      const topProjects = [...proyekAnalytics]
        .sort((a, b) => b.modal - a.modal)
        .slice(0, 8);
      const projectComparison = {
        labels: topProjects.map(p => p.nama),
        modal: topProjects.map(p => p.modal),
        belanja: topProjects.map(p => p.belanja),
        saldo: topProjects.map(p => p.saldoKas)
      };

      // 6. Data Grafik 4: Distribusi per Cabang
      const branchSummary = [];
      for (const c of cabangList) {
        const prInCabang = proyekAnalytics.filter(p => p.cabang === c.nama);
        const bModal = prInCabang.reduce((acc, curr) => acc + curr.modal, 0);
        const bBelanja = prInCabang.reduce((acc, curr) => acc + curr.belanja, 0);
        branchSummary.push({
          nama: c.nama,
          kota: c.kota,
          proyekCount: prInCabang.length,
          modal: bModal,
          belanja: bBelanja
        });
      }

      // 7. Unit Economics: Rata-rata Biaya per m2 per Jenis Bangunan
      const jenisGroups = {};
      for (const pr of proyekAnalytics) {
        const j = pr.jenis || 'Lainnya';
        if (!jenisGroups[j]) {
          jenisGroups[j] = { totalBiaya: 0, totalLuas: 0, count: 0 };
        }
        jenisGroups[j].totalBiaya += pr.belanja;
        jenisGroups[j].totalLuas += pr.luas;
        jenisGroups[j].count += 1;
      }
      const unitEconomics = Object.keys(jenisGroups).map(key => {
        const g = jenisGroups[key];
        const avgPerM2 = g.totalLuas > 0 ? Math.round(g.totalBiaya / g.totalLuas) : 0;
        return {
          jenis: key,
          count: g.count,
          totalLuas: g.totalLuas,
          totalBiaya: g.totalBiaya,
          avgPerM2
        };
      }).sort((a, b) => b.totalBiaya - a.totalBiaya);

      res.render('laporan/index', {
        filterCabang,
        filterTahun,
        filterStatus,
        cabangList,
        listTahun,
        totalModalPortofolio,
        totalBelanjaPortofolio,
        totalKasPortofolio,
        totalLuasM2,
        countAktif,
        countSelesai,
        totalProyek: rawProyek.length,
        rasioSerapanPortofolio,
        namaBulan,
        monthlyInflow,
        monthlyOutflow,
        categoryChart,
        projectComparison,
        branchSummary,
        proyekAnalytics,
        unitEconomics,
        success: req.query.success,
        error: req.query.error
      });
    } catch (err) {
      console.error('BI Dashboard Error:', err);
      res.redirect('/?error=' + encodeURIComponent('Gagal memuat dasbor laporan: ' + err.message));
    }
  }

  async eksporProyekExcel(req, res) {
    const { id } = req.params;
    try {
      const proyek = await db.get(
        'SELECT p.*, c.nama AS nama_cabang FROM proyek p JOIN cabang c ON c.id = p.cabang_id WHERE p.id = ?',
        [id]
      );
      if (!proyek) return res.status(404).send('Proyek tidak ditemukan');

      const cv = await db.get('SELECT nama FROM cv WHERE id = 1');
      const saldo = await kasService.hitungSaldoProyek(proyek.id);

      const transaksiList = await db.query(
        `SELECT t.*, k.nama AS nama_kategori, p.nama AS nama_pembeli 
         FROM transaksi t
         LEFT JOIN kategori k ON k.id = t.kategori_id
         LEFT JOIN pembeli p ON p.id = t.pembeli_id
         WHERE t.proyek_id = ? AND t.is_cancelled = 0
         ORDER BY t.tanggal_transaksi ASC, t.id ASC`,
        [proyek.id]
      );

      const workbook = new ExcelJS.Workbook();
      workbook.creator = cv?.nama || 'KasProyek';
      workbook.created = new Date();

      const sheet = workbook.addWorksheet('Buku Kas');

      // Judul & Header Perusahaan
      const r1 = sheet.addRow([cv?.nama || 'CV. Pembangunan Bersama']);
      r1.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FF0F172A' } };
      
      const r2 = sheet.addRow([`LAPORAN KEUANGAN PROYEK: ${proyek.nama.toUpperCase()}`]);
      r2.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF334155' } };

      const r3 = sheet.addRow([`Cabang: ${proyek.nama_cabang} | Tanggal Cetak: ${new Date().toLocaleDateString('id-ID')} WIB`]);
      r3.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF64748B' } };
      sheet.addRow([]);

      // Ringkasan Posisi Keuangan
      const rPilarTitle = sheet.addRow(['RINGKASAN KEUANGAN PROYEK']);
      rPilarTitle.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };

      const rModal = sheet.addRow(['Modal Bersih Kas (Rp)', Number(saldo.modalBersih)]);
      formatDataRow(rModal, false);
      rModal.getCell(2).numFmt = '#,##0';

      const rKas = sheet.addRow(['Saldo Kas di Tangan (Rp)', Number(saldo.saldoKas)]);
      formatDataRow(rKas, true);
      rKas.getCell(2).numFmt = '#,##0';

      const rBelanja = sheet.addRow(['Total Realisasi Belanja (Rp)', Number(saldo.biayaTerealisasi)]);
      formatDataRow(rBelanja, false);
      rBelanja.getCell(2).numFmt = '#,##0';
      sheet.addRow([]);

      // Tabel Mutasi
      const rHeader = sheet.addRow([
        'No',
        'Tanggal',
        'Jenis Mutasi',
        'Kategori',
        'Vendor / Rekanan',
        'Uraian Transaksi',
        'Nominal (Rp)'
      ]);
      formatHeaderRow(rHeader);

      transaksiList.forEach((t, idx) => {
        const row = sheet.addRow([
          idx + 1,
          t.tanggal_transaksi,
          t.jenis_transaksi === 'MODAL_MASUK' ? 'Modal Masuk' : (t.jenis_transaksi === 'PENARIKAN_MODAL' ? 'Tarik Modal' : 'Belanja Langsung'),
          escapeFormula(t.nama_kategori || '-'),
          escapeFormula(t.vendor || '-'),
          escapeFormula(t.uraian),
          Number(t.nominal)
        ]);
        formatDataRow(row, idx % 2 === 1);
        row.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
        row.getCell(2).alignment = { vertical: 'middle', horizontal: 'center' };
        row.getCell(7).alignment = { vertical: 'middle', horizontal: 'right' };
        row.getCell(7).numFmt = '#,##0';
      });

      // Total Row
      const rTotal = sheet.addRow([
        'TOTAL PENGELUARAN REALISASI',
        '',
        '',
        '',
        '',
        '',
        Number(saldo.biayaTerealisasi)
      ]);
      formatTotalRow(rTotal);
      rTotal.getCell(7).alignment = { vertical: 'middle', horizontal: 'right' };
      rTotal.getCell(7).numFmt = '#,##0';

      // Atur lebar kolom agar rapi dan tidak terpotong
      sheet.columns = [
        { width: 6 },
        { width: 14 },
        { width: 18 },
        { width: 18 },
        { width: 22 },
        { width: 35 },
        { width: 20 }
      ];

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="Laporan_${proyek.nama.replace(/\s+/g, '_')}.xlsx"`);

      await workbook.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error('Ekspor Excel Error:', err);
      res.status(500).send('Gagal mengekspor Excel: ' + err.message);
    }
  }

  async eksporProyekPdf(req, res) {
    const { id } = req.params;
    try {
      const proyek = await db.get(
        'SELECT p.*, c.nama AS nama_cabang FROM proyek p JOIN cabang c ON c.id = p.cabang_id WHERE p.id = ?',
        [id]
      );
      if (!proyek) return res.status(404).send('Proyek tidak ditemukan');

      const cv = await db.get('SELECT nama FROM cv WHERE id = 1');
      const saldo = await kasService.hitungSaldoProyek(proyek.id);
      const transaksiList = await db.query(
        `SELECT t.*, k.nama AS nama_kategori, p.nama AS nama_pembeli 
         FROM transaksi t
         LEFT JOIN kategori k ON k.id = t.kategori_id
         LEFT JOIN pembeli p ON p.id = t.pembeli_id
         WHERE t.proyek_id = ? AND t.is_cancelled = 0
         ORDER BY t.tanggal_transaksi ASC, t.id ASC`,
        [proyek.id]
      );

      const doc = new PDFDocument({ margin: 40, size: 'A4' });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Laporan_${proyek.nama.replace(/\s+/g, '_')}.pdf"`);
      doc.pipe(res);

      // Header Laporan
      doc.fontSize(16).font('Helvetica-Bold').text(cv?.nama || 'CV. Pembangunan Bersama', { align: 'center' });
      doc.fontSize(12).font('Helvetica').text(`LAPORAN KAS PROYEK: ${proyek.nama.toUpperCase()}`, { align: 'center' });
      doc.fontSize(9).fillColor('#666666').text(
        `Cabang: ${proyek.nama_cabang} | Dicetak: ${new Date().toLocaleDateString('id-ID')} WIB | Status: ${proyek.status}`,
        { align: 'center' }
      );
      doc.moveDown(1.5);
      doc.fillColor('#000000');

      // Ringkasan Posisi Keuangan (Tabel Ringkas)
      doc.fontSize(11).font('Helvetica-Bold').text('POSISI KEUANGAN KAS PROYEK');
      doc.rect(40, doc.y + 4, 515, 45).strokeColor('#e2e8f0').stroke();
      
      const startY = doc.y + 10;
      doc.fontSize(9).font('Helvetica');
      doc.text(`Modal Bersih: Rp${saldo.modalBersih.toLocaleString('id-ID')}`, 50, startY);
      doc.text(`Saldo Kas di Tangan: Rp${saldo.saldoKas.toLocaleString('id-ID')}`, 50, startY + 16);

      doc.text(`Total Realisasi Belanja: Rp${saldo.biayaTerealisasi.toLocaleString('id-ID')}`, 300, startY);
      doc.text(`Status Kas: SEIMBANG (OK)`, 300, startY + 16);

      doc.y = startY + 50;
      doc.moveDown(1);

      // Tabel Transaksi
      doc.fontSize(11).font('Helvetica-Bold').text('BUKU KAS MUTASI');
      doc.moveDown(0.5);

      // Header Tabel
      let y = doc.y;
      doc.rect(40, y, 515, 20).fillColor('#f8fafc').fill();
      doc.fillColor('#000000').fontSize(8).font('Helvetica-Bold');
      doc.text('Tgl', 45, y + 6);
      doc.text('Jenis', 95, y + 6);
      doc.text('Kategori/Vendor', 170, y + 6);
      doc.text('Uraian', 260, y + 6);
      doc.text('Nominal (Rp)', 450, y + 6, { align: 'right', width: 95 });

      y += 22;
      doc.font('Helvetica').fontSize(8);

      for (const t of transaksiList) {
        if (y > 750) {
          doc.addPage();
          y = 40;
        }

        const party = t.nama_kategori || t.nama_pembeli || t.vendor || '-';
        doc.text(t.tanggal_transaksi, 45, y);
        doc.text(t.jenis_transaksi.replace('_', ' '), 95, y);
        doc.text(party.substring(0, 18), 170, y);
        doc.text(t.uraian.substring(0, 35), 260, y);
        doc.text(Number(t.nominal).toLocaleString('id-ID'), 450, y, { align: 'right', width: 95 });

        y += 18;
      }

      // Kaki Laporan
      doc.fontSize(8).fillColor('#888888').text(
        'Dokumen ini dicetak otomatis dari sistem KasProyek dan diakui secara sah oleh Pemilik.',
        40,
        780,
        { align: 'center', width: 515 }
      );

      doc.end();
    } catch (err) {
      console.error('Ekspor PDF Error:', err);
      res.status(500).send('Gagal mengekspor PDF: ' + err.message);
    }
  }

  /**
   * Ekspor Histori Proyek Selesai ke Excel (Format Kantor Profesional & Lengkap)
   */
  async eksporHistoriExcel(req, res) {
    const filterCabang = req.query.cabang_id ? Number(req.query.cabang_id) : null;
    const filterTahun = req.query.tahun || 'semua';
    const filterStatus = req.query.status || 'Selesai';

    try {
      const cv = await db.get('SELECT nama FROM cv WHERE id = 1');
      const cabangList = await db.query('SELECT * FROM cabang ORDER BY nama ASC');

      const workbook = new ExcelJS.Workbook();
      workbook.creator = cv?.nama || 'MyProyek';
      workbook.created = new Date();

      // =========================================================================
      // SHEET 1: REKAPITULASI HISTORI PROYEK
      // =========================================================================
      const sheetRekap = workbook.addWorksheet('Rekapitulasi Histori');

      const rTitleCv = sheetRekap.addRow([cv?.nama || 'CV. Pembangunan Bersama']);
      rTitleCv.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FF0F172A' } };

      const subJudul = filterTahun !== 'semua' 
        ? `HISTORI LAPORAN KEUANGAN PROYEK (TAHUN ${filterTahun})` 
        : `HISTORI KEUANGAN SELURUH PROYEK SELESAI`;
      const rTitleLap = sheetRekap.addRow([subJudul]);
      rTitleLap.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF334155' } };

      const rTgl = sheetRekap.addRow([`Tanggal Cetak: ${new Date().toLocaleDateString('id-ID')} WIB | Sistem MyProyek`]);
      rTgl.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF64748B' } };
      sheetRekap.addRow([]);

      // Section 1: Ringkasan Konsolidasi Per Cabang
      const secCabangTitle = sheetRekap.addRow(['RINGKASAN KONSOLIDASI CABANG']);
      secCabangTitle.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };

      const hCabang = sheetRekap.addRow([
        'No',
        'Nama Cabang',
        'Kota',
        'Total Proyek Selesai',
        'Modal Masuk (Rp)',
        'Realisasi Belanja (Rp)',
        'Sisa Kas (Rp)'
      ]);
      formatHeaderRow(hCabang);

      let grandModal = 0;
      let grandBelanja = 0;
      let grandSisaKas = 0;
      const allProjectsRekap = [];
      const allExpensesDetail = [];

      for (let i = 0; i < cabangList.length; i++) {
        const c = cabangList[i];
        if (filterCabang && c.id !== filterCabang) continue;

        let sqlP = `SELECT * FROM proyek WHERE cabang_id = ?`;
        const pParams = [c.id];

        if (filterStatus === 'Selesai') {
          sqlP += " AND status = 'Selesai'";
        } else if (filterStatus === 'semua') {
          sqlP += " AND status != 'Arsip'";
        } else {
          sqlP += " AND status = ?";
          pParams.push(filterStatus);
        }

        if (filterTahun && filterTahun !== 'semua') {
          sqlP += " AND (strftime('%Y', tanggal_selesai) = ? OR (tanggal_selesai IS NULL AND strftime('%Y', tanggal_mulai) = ?))";
          pParams.push(String(filterTahun), String(filterTahun));
        }

        sqlP += " ORDER BY tanggal_selesai DESC, tanggal_mulai DESC";
        const proyekDiCabang = await db.query(sqlP, pParams);

        let cModal = 0;
        let cBelanja = 0;
        let cSisaKas = 0;

        for (const p of proyekDiCabang) {
          const saldo = await kasService.hitungSaldoProyek(p.id);

          const txList = await db.query(
            `SELECT t.*, k.nama AS nama_kategori 
             FROM transaksi t
             LEFT JOIN kategori k ON k.id = t.kategori_id
             WHERE t.proyek_id = ? AND t.is_cancelled = 0
             ORDER BY t.tanggal_transaksi ASC, t.id ASC`,
            [p.id]
          );

          let pItemBelanja = 0;
          for (const t of txList) {
            if (t.jenis_transaksi === 'PENGELUARAN_LANGSUNG' || t.jenis_transaksi === 'NOTA_PANJAR') {
              pItemBelanja++;
              allExpensesDetail.push({
                cabang: c.nama,
                proyek: p.nama,
                tanggal: t.tanggal_transaksi,
                kategori: t.nama_kategori || 'Tanpa Kategori',
                uraian: t.uraian,
                vendor: t.vendor || '-',
                nominal: Number(t.nominal)
              });
            }
          }

          let durasiHari = '-';
          if (p.tanggal_mulai && p.tanggal_selesai) {
            const d1 = new Date(p.tanggal_mulai);
            const d2 = new Date(p.tanggal_selesai);
            durasiHari = Math.max(1, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)));
          }

          cModal += saldo.modalBersih;
          cBelanja += saldo.biayaTerealisasi;
          cSisaKas += saldo.saldoKas;

          allProjectsRekap.push({
            cabang: c.nama,
            nama: p.nama,
            jenis: p.jenis_bangunan,
            luas: p.luas_m2,
            tanggal_mulai: p.tanggal_mulai,
            tanggal_selesai: p.tanggal_selesai || '-',
            durasiHari,
            status: p.status,
            modal: saldo.modalBersih,
            belanja: saldo.biayaTerealisasi,
            sisaKas: saldo.saldoKas,
            itemBelanja: pItemBelanja
          });
        }

        grandModal += cModal;
        grandBelanja += cBelanja;
        grandSisaKas += cSisaKas;

        const rowC = sheetRekap.addRow([
          i + 1,
          c.nama,
          c.kota || '-',
          proyekDiCabang.length,
          cModal,
          cBelanja,
          cSisaKas
        ]);
        formatDataRow(rowC, i % 2 === 1);
        rowC.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
        rowC.getCell(4).alignment = { vertical: 'middle', horizontal: 'center' };
        rowC.getCell(5).alignment = { vertical: 'middle', horizontal: 'right' };
        rowC.getCell(6).alignment = { vertical: 'middle', horizontal: 'right' };
        rowC.getCell(7).alignment = { vertical: 'middle', horizontal: 'right' };
        rowC.getCell(5).numFmt = '#,##0';
        rowC.getCell(6).numFmt = '#,##0';
        rowC.getCell(7).numFmt = '#,##0';
      }

      // Total Baris Cabang
      const rTotalCabang = sheetRekap.addRow([
        'TOTAL KONSOLIDASI',
        '',
        '',
        allProjectsRekap.length,
        grandModal,
        grandBelanja,
        grandSisaKas
      ]);
      formatTotalRow(rTotalCabang);
      rTotalCabang.getCell(4).alignment = { vertical: 'middle', horizontal: 'center' };
      rTotalCabang.getCell(5).alignment = { vertical: 'middle', horizontal: 'right' };
      rTotalCabang.getCell(6).alignment = { vertical: 'middle', horizontal: 'right' };
      rTotalCabang.getCell(7).alignment = { vertical: 'middle', horizontal: 'right' };
      rTotalCabang.getCell(5).numFmt = '#,##0';
      rTotalCabang.getCell(6).numFmt = '#,##0';
      rTotalCabang.getCell(7).numFmt = '#,##0';
      sheetRekap.addRow([]);

      // Section 2: Daftar Lengkap Proyek Selesai
      const secProyekTitle = sheetRekap.addRow(['RINCIAN PROYEK HISTORI']);
      secProyekTitle.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };

      const hProyek = sheetRekap.addRow([
        'No',
        'Cabang',
        'Nama Proyek',
        'Jenis',
        'Luas (m²)',
        'Tgl Mulai',
        'Tgl Selesai',
        'Durasi (Hari)',
        'Modal Proyek (Rp)',
        'Realisasi Belanja (Rp)',
        'Sisa Kas (Rp)'
      ]);
      formatHeaderRow(hProyek, 'FF334155');

      if (allProjectsRekap.length === 0) {
        const rEmptyP = sheetRekap.addRow(['Belum ada proyek dalam histori.', '', '', '', '', '', '', '', '', '', '']);
        formatDataRow(rEmptyP);
      } else {
        allProjectsRekap.forEach((pr, pIdx) => {
          const rowP = sheetRekap.addRow([
            pIdx + 1,
            pr.cabang,
            pr.nama,
            pr.jenis,
            pr.luas || '-',
            pr.tanggal_mulai,
            pr.tanggal_selesai,
            pr.durasiHari,
            pr.modal,
            pr.belanja,
            pr.sisaKas
          ]);
          formatDataRow(rowP, pIdx % 2 === 1);
          rowP.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
          rowP.getCell(4).alignment = { vertical: 'middle', horizontal: 'center' };
          rowP.getCell(5).alignment = { vertical: 'middle', horizontal: 'center' };
          rowP.getCell(6).alignment = { vertical: 'middle', horizontal: 'center' };
          rowP.getCell(7).alignment = { vertical: 'middle', horizontal: 'center' };
          rowP.getCell(8).alignment = { vertical: 'middle', horizontal: 'center' };
          rowP.getCell(9).alignment = { vertical: 'middle', horizontal: 'right' };
          rowP.getCell(10).alignment = { vertical: 'middle', horizontal: 'right' };
          rowP.getCell(11).alignment = { vertical: 'middle', horizontal: 'right' };
          rowP.getCell(9).numFmt = '#,##0';
          rowP.getCell(10).numFmt = '#,##0';
          rowP.getCell(11).numFmt = '#,##0';
        });
      }

      sheetRekap.columns = [
        { width: 6 },
        { width: 18 },
        { width: 26 },
        { width: 14 },
        { width: 12 },
        { width: 14 },
        { width: 14 },
        { width: 14 },
        { width: 20 },
        { width: 22 },
        { width: 20 }
      ];

      // =========================================================================
      // SHEET 2: DETAIL PEMBELIAN / PENGELUARAN LENGKAP TIAP PROYEK
      // =========================================================================
      const sheetDetail = workbook.addWorksheet('Detail Belanja');

      const dTitle1 = sheetDetail.addRow([cv?.nama || 'CV. Pembangunan Bersama']);
      dTitle1.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FF0F172A' } };

      const dTitle2 = sheetDetail.addRow(['DETAIL PEMBELIAN & PENGELUARAN LENGKAP PROYEK HISTORI']);
      dTitle2.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF334155' } };

      const dTitle3 = sheetDetail.addRow([`Dicetak pada: ${new Date().toLocaleDateString('id-ID')} WIB | Total Transaksi: ${allExpensesDetail.length} Baris`]);
      dTitle3.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF64748B' } };
      sheetDetail.addRow([]);

      const hDetail = sheetDetail.addRow([
        'No',
        'Cabang',
        'Nama Proyek',
        'Tanggal',
        'Kategori',
        'Nama Pengeluaran / Barang',
        'Toko / Rekanan',
        'Nominal (Rp)'
      ]);
      formatHeaderRow(hDetail, 'FF0F172A');

      if (allExpensesDetail.length === 0) {
        const emptyRow = sheetDetail.addRow(['Tidak ada transaksi belanja.', '', '', '', '', '', '', '']);
        formatDataRow(emptyRow);
      } else {
        allExpensesDetail.forEach((exp, eIdx) => {
          const rowE = sheetDetail.addRow([
            eIdx + 1,
            exp.cabang,
            exp.proyek,
            exp.tanggal,
            escapeFormula(exp.kategori),
            escapeFormula(exp.uraian),
            escapeFormula(exp.vendor),
            exp.nominal
          ]);
          formatDataRow(rowE, eIdx % 2 === 1);
          rowE.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
          rowE.getCell(4).alignment = { vertical: 'middle', horizontal: 'center' };
          rowE.getCell(8).alignment = { vertical: 'middle', horizontal: 'right' };
          rowE.getCell(8).numFmt = '#,##0';
        });

        // Baris Total Belanja
        const rTotalBelanja = sheetDetail.addRow([
          'TOTAL PENGELUARAN BELANJA HISTORI',
          '',
          '',
          '',
          '',
          '',
          '',
          grandBelanja
        ]);
        formatTotalRow(rTotalBelanja);
        rTotalBelanja.getCell(8).alignment = { vertical: 'middle', horizontal: 'right' };
        rTotalBelanja.getCell(8).numFmt = '#,##0';

        // Aktifkan Filter Otomatis Excel
        sheetDetail.autoFilter = {
          from: 'A5',
          to: 'H5'
        };
      }

      sheetDetail.columns = [
        { width: 6 },
        { width: 18 },
        { width: 24 },
        { width: 14 },
        { width: 18 },
        { width: 34 },
        { width: 22 },
        { width: 20 }
      ];

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="Histori_Proyek_Selesai.xlsx"`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error('Ekspor Histori Excel Error:', err);
      res.status(500).send('Gagal mengekspor histori Excel: ' + err.message);
    }
  }

  async eksporTahunanExcel(req, res) {
    return this.eksporHistoriExcel(req, res);
  }

  /**
   * Ekspor Histori Proyek Selesai ke PDF
   */
  async eksporHistoriPdf(req, res) {
    const filterCabang = req.query.cabang_id ? Number(req.query.cabang_id) : null;
    const filterTahun = req.query.tahun || 'semua';
    const filterStatus = req.query.status || 'Selesai';

    try {
      const cv = await db.get('SELECT nama FROM cv WHERE id = 1');
      const cabangList = await db.query('SELECT * FROM cabang ORDER BY nama ASC');

      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Histori_Proyek_Selesai.pdf"`);
      doc.pipe(res);

      doc.fontSize(16).font('Helvetica-Bold').text(cv?.nama || 'CV. Pembangunan Bersama', { align: 'center' });
      const pdfJudul = filterTahun !== 'semua'
        ? `HISTORI LAPORAN KEUANGAN PROYEK (TAHUN ${filterTahun})`
        : `HISTORI KEUANGAN SELURUH PROYEK SELESAI`;
      doc.fontSize(11).font('Helvetica').text(pdfJudul, { align: 'center' });
      doc.fontSize(8).fillColor('#666666').text(`Waktu Cetak: ${new Date().toLocaleDateString('id-ID')} WIB | Sistem MyProyek`, { align: 'center' });
      doc.moveDown(1.2);
      doc.fillColor('#000000');

      let y = doc.y;
      doc.rect(40, y, 515, 20).fillColor('#f8fafc').fill();
      doc.fillColor('#000000').fontSize(8).font('Helvetica-Bold');
      doc.text('Cabang', 45, y + 6);
      doc.text('Proyek Selesai', 180, y + 6);
      doc.text('Modal (Rp)', 280, y + 6, { align: 'right', width: 75 });
      doc.text('Belanja (Rp)', 365, y + 6, { align: 'right', width: 90 });
      doc.text('Sisa Kas (Rp)', 460, y + 6, { align: 'right', width: 90 });

      y += 24;
      doc.font('Helvetica').fontSize(8);

      let grandModal = 0, grandBelanja = 0, grandSisaKas = 0;

      for (const c of cabangList) {
        if (filterCabang && c.id !== filterCabang) continue;

        let sqlP = `SELECT * FROM proyek WHERE cabang_id = ?`;
        const pParams = [c.id];

        if (filterStatus === 'Selesai') {
          sqlP += " AND status = 'Selesai'";
        } else if (filterStatus === 'semua') {
          sqlP += " AND status != 'Arsip'";
        } else {
          sqlP += " AND status = ?";
          pParams.push(filterStatus);
        }

        if (filterTahun && filterTahun !== 'semua') {
          sqlP += " AND (strftime('%Y', tanggal_selesai) = ? OR (tanggal_selesai IS NULL AND strftime('%Y', tanggal_mulai) = ?))";
          pParams.push(String(filterTahun), String(filterTahun));
        }

        const proyekDiCabang = await db.query(sqlP, pParams);

        let cModal = 0, cBelanja = 0, cSisa = 0;
        for (const p of proyekDiCabang) {
          const saldo = await kasService.hitungSaldoProyek(p.id);
          cModal += saldo.modalBersih;
          cBelanja += saldo.biayaTerealisasi;
          cSisa += saldo.saldoKas;
        }

        grandModal += cModal;
        grandBelanja += cBelanja;
        grandSisaKas += cSisa;

        doc.text(c.nama, 45, y);
        doc.text(String(proyekDiCabang.length), 180, y);
        doc.text(cModal.toLocaleString('id-ID'), 280, y, { align: 'right', width: 75 });
        doc.text(cBelanja.toLocaleString('id-ID'), 365, y, { align: 'right', width: 90 });
        doc.text(cSisa.toLocaleString('id-ID'), 460, y, { align: 'right', width: 90 });

        y += 18;
      }

      // Garis Total
      doc.rect(40, y, 515, 1).fillColor('#cbd5e1').fill();
      y += 6;
      doc.font('Helvetica-Bold').fillColor('#000000');
      doc.text('TOTAL KONSOLIDASI', 45, y);
      doc.text(grandModal.toLocaleString('id-ID'), 280, y, { align: 'right', width: 75 });
      doc.text(grandBelanja.toLocaleString('id-ID'), 365, y, { align: 'right', width: 90 });
      doc.text(grandSisaKas.toLocaleString('id-ID'), 460, y, { align: 'right', width: 90 });

      doc.end();
    } catch (err) {
      console.error('Ekspor Histori PDF Error:', err);
      res.status(500).send('Gagal mengekspor histori PDF: ' + err.message);
    }
  }

  async eksporTahunanPdf(req, res) {
    return this.eksporHistoriPdf(req, res);
  }

  /**
   * F-15: Unduh Cadangan Mandiri Database SQLite (Live Snapshot via VACUUM INTO)
   */
  async unduhCadangan(req, res) {
    const fs = require('fs');
    const path = require('path');
    const backupDir = path.join(__dirname, '../../data');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `backup-${timestamp}.sqlite`);

    try {
      // Buat live snapshot yang 100% konsisten tanpa mematikan server
      await db.run(`VACUUM INTO ?`, [backupFile]);

      res.download(backupFile, `KasProyek_Backup_${timestamp.split('T')[0]}.sqlite`, (err) => {
        // Hapus file sementara setelah selesai diunduh
        if (fs.existsSync(backupFile)) {
          fs.unlinkSync(backupFile);
        }
      });
    } catch (err) {
      console.error('Cadangan Database Error:', err);
      res.redirect('/profil?error=' + encodeURIComponent('Gagal membuat cadangan database: ' + err.message));
    }
  }
}

module.exports = new LaporanController();
