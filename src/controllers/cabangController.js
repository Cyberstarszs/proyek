const { db } = require('../config/database');

class CabangController {
  async index(req, res) {
    try {
      const cabangList = await db.query(`
        SELECT c.*, 
          (SELECT COUNT(*) FROM proyek p WHERE p.cabang_id = c.id) AS total_proyek,
          (SELECT COUNT(*) FROM proyek p WHERE p.cabang_id = c.id AND p.status = 'Aktif') AS proyek_aktif
        FROM cabang c
        ORDER BY c.is_active DESC, c.nama ASC
      `);

      res.render('cabang/index', {
        cabangList,
        success: req.query.success,
        error: req.query.error
      });
    } catch (err) {
      res.redirect('/?error=' + encodeURIComponent(err.message));
    }
  }

  async store(req, res) {
    const { nama, kota, catatan } = req.body;

    if (!nama || nama.trim().length < 3) {
      return res.redirect('/cabang?error=' + encodeURIComponent('Nama cabang minimal 3 karakter'));
    }

    try {
      const existing = await db.get('SELECT id FROM cabang WHERE LOWER(nama) = LOWER(?)', [nama.trim()]);
      if (existing) {
        return res.redirect('/cabang?error=' + encodeURIComponent(`Cabang dengan nama "${nama}" sudah terdaftar`));
      }

      await db.run(
        'INSERT INTO cabang (nama, kota, catatan, is_active) VALUES (?, ?, ?, 1)',
        [nama.trim(), kota?.trim() || null, catatan?.trim() || null]
      );

      res.redirect('/cabang?success=' + encodeURIComponent('Cabang baru berhasil ditambahkan'));
    } catch (err) {
      res.redirect('/cabang?error=' + encodeURIComponent(err.message));
    }
  }

  async toggleActive(req, res) {
    const { id } = req.params;
    try {
      const cabang = await db.get('SELECT * FROM cabang WHERE id = ?', [id]);
      if (!cabang) {
        return res.redirect('/cabang?error=' + encodeURIComponent('Cabang tidak ditemukan'));
      }

      const nextStatus = cabang.is_active === 1 ? 0 : 1;
      await db.run('UPDATE cabang SET is_active = ? WHERE id = ?', [nextStatus, id]);

      const statusText = nextStatus === 1 ? 'diaktifkan kembali' : 'dinonaktifkan';
      res.redirect('/cabang?success=' + encodeURIComponent(`Cabang "${cabang.nama}" berhasil ${statusText}`));
    } catch (err) {
      res.redirect('/cabang?error=' + encodeURIComponent(err.message));
    }
  }
}

module.exports = new CabangController();
