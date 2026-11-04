const { db } = require('../config/database');
const kasService = require('../services/kasService');

class TransaksiController {
  async storeModal(req, res) {
    const { id } = req.params;
    const { tipe, nominal, tanggal, uraian, idempotency_key } = req.body;
    const cleanNominal = String(nominal || '').replace(/\./g, '');

    try {
      if (tipe === 'PENARIKAN') {
        await kasService.catatPenarikanModal({
          proyekId: id,
          nominal: cleanNominal,
          tanggal,
          uraian,
          idempotencyKey: idempotency_key,
          ipAddress: req.ip
        });
        res.redirect(`/proyek/${id}?success=` + encodeURIComponent('Penarikan modal berhasil'));
      } else {
        await kasService.catatModalMasuk({
          proyekId: id,
          nominal: cleanNominal,
          tanggal,
          uraian,
          idempotencyKey: idempotency_key,
          ipAddress: req.ip
        });
        res.redirect(`/proyek/${id}?success=` + encodeURIComponent('Setoran modal berhasil'));
      }
    } catch (err) {
      res.redirect(`/proyek/${id}?error=` + encodeURIComponent(err.message));
    }
  }

  async storePengeluaranLangsung(req, res) {
    const { id } = req.params;
    const { kategori_id, kategori_baru, nominal, tanggal, uraian, vendor, jumlah, idempotency_key } = req.body;
    const cleanNominal = String(nominal || '').replace(/\./g, '');

    try {
      await kasService.catatPengeluaranLangsung({
        proyekId: id,
        kategoriId: kategori_id,
        kategoriBaru: kategori_baru,
        nominal: cleanNominal,
        tanggal,
        uraian,
        vendor,
        jumlah,
        idempotencyKey: idempotency_key,
        ipAddress: req.ip
      });

      res.redirect(`/proyek/${id}?tab=bukukas&success=` + encodeURIComponent('Belanja berhasil dicatat'));
    } catch (err) {
      res.redirect(`/proyek/${id}?error=` + encodeURIComponent(err.message));
    }
  }

  async batalkan(req, res) {
    const { id, transaksiId } = req.params;
    const { alasan } = req.body;

    try {
      await kasService.batalkanTransaksi(transaksiId, alasan, req.ip);
      res.redirect(`/proyek/${id}?tab=bukukas&success=` + encodeURIComponent('Transaksi dibatalkan'));
    } catch (err) {
      res.redirect(`/proyek/${id}?error=` + encodeURIComponent(err.message));
    }
  }

  async editTransaksi(req, res) {
    const { id, transaksiId } = req.params;
    const { uraian, vendor, jumlah } = req.body;

    try {
      await kasService.editTransaksi({
        transaksiId,
        uraian,
        vendor,
        jumlah,
        ipAddress: req.ip
      });

      res.redirect(`/proyek/${id}?tab=bukukas&success=` + encodeURIComponent('Transaksi diperbarui'));
    } catch (err) {
      res.redirect(`/proyek/${id}?error=` + encodeURIComponent(err.message));
    }
  }
}

module.exports = new TransaksiController();
