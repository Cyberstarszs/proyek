const { db } = require('../config/database');

// Memory store untuk rate limit login sederhana
const loginAttempts = new Map();

function rateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const record = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };

  if (record.lockedUntil > now) {
    const sisaMenit = Math.ceil((record.lockedUntil - now) / 60000);
    return res.render('login', {
      error: `Terlalu banyak percobaan gagal. Akun dikunci sementara. Silakan coba lagi dalam ${sisaMenit} menit.`,
      email: req.body.email || ''
    });
  }

  req.loginRateLimit = {
    recordFailure: () => {
      record.count += 1;
      if (record.count >= 5) {
        record.lockedUntil = now + 15 * 60 * 1000; // 15 menit
      }
      loginAttempts.set(ip, record);
    },
    reset: () => {
      loginAttempts.delete(ip);
    }
  };

  next();
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(401).json({ error: 'Sesi berakhir, silakan login kembali' });
    }
    return res.redirect('/login');
  }
  next();
}

async function loadGlobalData(req, res, next) {
  try {
    const cv = await db.get('SELECT * FROM cv WHERE id = 1');
    res.locals.cv = cv || { nama: 'CV. Pembangunan Bersama' };
    res.locals.currentUser = req.session ? { id: req.session.userId, nama: req.session.userName } : null;
    res.locals.currentPath = req.path;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  rateLimiter,
  requireAuth,
  loadGlobalData
};
