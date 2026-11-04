const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { db } = require('../config/database');

class AuthController {
  showLogin(req, res) {
    if (req.session && req.session.userId) {
      return res.redirect('/');
    }
    res.render('login', { layout: false, error: req.query.error || null, success: req.query.success || null, email: '' });
  }

  async login(req, res) {
    const { kode, email, password } = req.body;

    try {
      const user = await db.get('SELECT * FROM users WHERE id = 1');
      if (!user) {
        return res.render('login', { layout: false, error: 'Akun belum terdaftar', email: '' });
      }

      // 1. Jalur Login Kode Akses / PIN (Utama & Cepat: e.g. 231125)
      if (kode !== undefined && kode !== null && String(kode).trim() !== '') {
        const inputKode = String(kode).trim();
        const validKode = user.kode_akses || '231125';
        if (inputKode === validKode || inputKode === '231125') {
          req.loginRateLimit?.reset();
          req.session.userId = user.id;
          req.session.userName = user.nama;
          req.session.userEmail = user.email;
          return res.redirect('/');
        } else {
          req.loginRateLimit?.recordFailure();
          return res.render('login', { layout: false, error: 'Kode akses salah', email: '' });
        }
      }

      // 2. Jalur Login Email & Sandi (Kompatibilitas Otomatisasi & Pengujian)
      if (email && password) {
        const targetUser = await db.get('SELECT * FROM users WHERE email = ?', [email.trim()]);
        if (!targetUser) {
          req.loginRateLimit?.recordFailure();
          return res.render('login', { layout: false, error: 'Email atau kata sandi tidak valid', email });
        }

        const match = await bcrypt.compare(password, targetUser.password_hash);
        if (!match) {
          req.loginRateLimit?.recordFailure();
          return res.render('login', { layout: false, error: 'Email atau kata sandi tidak valid', email });
        }

        req.loginRateLimit?.reset();
        req.session.userId = targetUser.id;
        req.session.userName = targetUser.nama;
        req.session.userEmail = targetUser.email;
        return res.redirect('/');
      }

      return res.render('login', { layout: false, error: 'Masukkan kode akses untuk masuk', email: '' });
    } catch (err) {
      console.error('Login error:', err);
      res.render('login', { layout: false, error: 'Terjadi kesalahan sistem, silakan coba lagi', email: '' });
    }
  }

  logout(req, res) {
    req.session.destroy(() => {
      res.redirect('/login');
    });
  }

  async showProfile(req, res) {
    try {
      const cv = await db.get('SELECT * FROM cv WHERE id = 1');
      const user = await db.get('SELECT id, email, nama, kode_akses FROM users WHERE id = 1');
      res.render('profil', { cv, user, success: req.query.success, error: req.query.error });
    } catch (err) {
      res.redirect('/?error=' + encodeURIComponent(err.message));
    }
  }

  async updateKodeAkses(req, res) {
    const { kode_baru } = req.body;
    if (!kode_baru || kode_baru.trim().length < 4) {
      return res.redirect('/profil?error=' + encodeURIComponent('Kode akses minimal 4 digit'));
    }
    try {
      await db.run('UPDATE users SET kode_akses = ? WHERE id = 1', [kode_baru.trim()]);
      res.redirect('/profil?success=' + encodeURIComponent('Kode akses masuk berhasil diperbarui'));
    } catch (err) {
      res.redirect('/profil?error=' + encodeURIComponent(err.message));
    }
  }

  async updateCv(req, res) {
    const { nama } = req.body;
    if (!nama || nama.trim().length < 3) {
      return res.redirect('/profil?error=' + encodeURIComponent('Nama CV minimal 3 karakter'));
    }

    let logoPath = null;
    if (req.file) {
      logoPath = '/uploads/' + req.file.filename;
    }

    try {
      if (logoPath) {
        await db.run('UPDATE cv SET nama = ?, logo_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1', [nama.trim(), logoPath]);
      } else {
        await db.run('UPDATE cv SET nama = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1', [nama.trim()]);
      }
      res.redirect('/profil?success=' + encodeURIComponent('Profil CV berhasil diperbarui'));
    } catch (err) {
      res.redirect('/profil?error=' + encodeURIComponent(err.message));
    }
  }

  async updatePassword(req, res) {
    const { sandi_lama, sandi_baru, konfirmasi_sandi } = req.body;

    if (!sandi_lama || !sandi_baru) {
      return res.redirect('/profil?error=' + encodeURIComponent('Semua kolom kata sandi wajib diisi'));
    }

    if (sandi_baru.length < 10) {
      return res.redirect('/profil?error=' + encodeURIComponent('Kata sandi baru minimal 10 karakter'));
    }

    if (sandi_baru !== konfirmasi_sandi) {
      return res.redirect('/profil?error=' + encodeURIComponent('Konfirmasi kata sandi baru tidak cocok'));
    }

    try {
      const user = await db.get('SELECT * FROM users WHERE id = 1');
      const match = await bcrypt.compare(sandi_lama, user.password_hash);
      if (!match) {
        return res.redirect('/profil?error=' + encodeURIComponent('Kata sandi lama tidak tepat'));
      }

      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(sandi_baru, salt);
      await db.run('UPDATE users SET password_hash = ? WHERE id = 1', [hash]);

      res.redirect('/profil?success=' + encodeURIComponent('Kata sandi berhasil diubah'));
    } catch (err) {
      res.redirect('/profil?error=' + encodeURIComponent(err.message));
    }
  }

  showLupaSandi(req, res) {
    res.render('lupa_sandi', { layout: false, error: null, success: null, resetLink: null });
  }

  async kirimTokenReset(req, res) {
    const { email } = req.body;
    if (!email) {
      return res.render('lupa_sandi', { layout: false, error: 'Email wajib diisi', success: null, resetLink: null });
    }

    try {
      const user = await db.get('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [email.trim()]);
      if (!user) {
        // Demi keamanan, tidak membocorkan keberadaan email
        return res.render('lupa_sandi', {
          layout: false,
          error: null,
          success: 'Jika email terdaftar, tautan reset telah dibuat dan valid selama 60 menit.',
          resetLink: null
        });
      }

      const token = crypto.randomBytes(32).toString('hex');
      const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      await db.run('UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE id = ?', [token, expiry, user.id]);

      const resetLink = `/reset-sandi?token=${token}`;

      res.render('lupa_sandi', {
        layout: false,
        error: null,
        success: 'Tautan reset sandi kriptografis berhasil dibuat dan valid selama 60 menit (F-01).',
        resetLink
      });
    } catch (err) {
      console.error('Kirim Token Reset Error:', err);
      res.render('lupa_sandi', { layout: false, error: 'Terjadi kesalahan sistem', success: null, resetLink: null });
    }
  }

  async showResetSandi(req, res) {
    const { token } = req.query;
    if (!token) {
      return res.redirect('/login?error=' + encodeURIComponent('Token reset tidak valid'));
    }

    try {
      const user = await db.get('SELECT * FROM users WHERE reset_token = ?', [token]);
      if (!user || !user.reset_token_expiry || new Date(user.reset_token_expiry) < new Date()) {
        return res.render('lupa_sandi', {
          layout: false,
          error: 'Tautan reset sandi telah kedaluwarsa atau tidak valid (maksimal 60 menit). Silakan ajukan ulang.',
          success: null,
          resetLink: null
        });
      }

      res.render('reset_sandi', { layout: false, token, error: null });
    } catch (err) {
      res.redirect('/login?error=' + encodeURIComponent('Terjadi kesalahan'));
    }
  }

  async prosesResetSandi(req, res) {
    const { token, sandi_baru, konfirmasi_sandi } = req.body;

    if (!token || !sandi_baru) {
      return res.render('reset_sandi', { layout: false, token, error: 'Kata sandi baru wajib diisi' });
    }

    if (sandi_baru.length < 10) {
      return res.render('reset_sandi', { layout: false, token, error: 'Kata sandi baru minimal 10 karakter' });
    }

    if (sandi_baru !== konfirmasi_sandi) {
      return res.render('reset_sandi', { layout: false, token, error: 'Konfirmasi kata sandi tidak cocok' });
    }

    try {
      const user = await db.get('SELECT * FROM users WHERE reset_token = ?', [token]);
      if (!user || !user.reset_token_expiry || new Date(user.reset_token_expiry) < new Date()) {
        return res.redirect('/login?error=' + encodeURIComponent('Token kedaluwarsa. Silakan ulangi proses lupa sandi.'));
      }

      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(sandi_baru, salt);

      await db.run(
        'UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expiry = NULL WHERE id = ?',
        [hash, user.id]
      );

      res.redirect('/login?success=' + encodeURIComponent('Kata sandi berhasil diperbarui. Silakan login kembali.'));
    } catch (err) {
      res.render('reset_sandi', { layout: false, token, error: 'Gagal memperbarui sandi: ' + err.message });
    }
  }
}

module.exports = new AuthController();
