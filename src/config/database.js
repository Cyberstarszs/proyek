const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dbDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const uploadsDir = path.join(dbDir, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'kasproyek.db');
const rawDb = new sqlite3.Database(dbPath);

// Enable WAL mode & foreign keys
rawDb.serialize(() => {
  rawDb.run('PRAGMA journal_mode = WAL;');
  rawDb.run('PRAGMA foreign_keys = ON;');
  rawDb.run('PRAGMA busy_timeout = 5000;');
});

const db = {
  raw: rawDb,

  query(sql, params = []) {
    return new Promise((resolve, reject) => {
      rawDb.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  },

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      rawDb.get(sql, params, (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });
  },

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      rawDb.run(sql, params, function (err) {
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  },

  exec(sql) {
    return new Promise((resolve, reject) => {
      rawDb.exec(sql, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  },

  async transaction(fn) {
    await this.run('BEGIN IMMEDIATE TRANSACTION');
    try {
      const result = await fn();
      await this.run('COMMIT');
      return result;
    } catch (err) {
      await this.run('ROLLBACK');
      throw err;
    }
  }
};

// Initialize schema
async function initSchema() {
  const ddl = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      nama TEXT NOT NULL,
      failed_attempts INTEGER DEFAULT 0,
      locked_until DATETIME,
      reset_token TEXT,
      reset_token_expiry DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cv (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      nama TEXT NOT NULL,
      logo_path TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cabang (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nama TEXT NOT NULL UNIQUE COLLATE NOCASE,
      kota TEXT,
      catatan TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS proyek (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cabang_id INTEGER NOT NULL REFERENCES cabang(id),
      nama TEXT NOT NULL UNIQUE COLLATE NOCASE,
      jenis_bangunan TEXT NOT NULL,
      luas_m2 INTEGER DEFAULT 0,
      lokasi TEXT,
      tanggal_mulai DATE NOT NULL,
      tanggal_selesai DATE,
      status TEXT NOT NULL DEFAULT 'Aktif' CHECK(status IN ('Aktif', 'Selesai', 'Arsip')),
      catatan TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pembeli (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nama TEXT NOT NULL UNIQUE COLLATE NOCASE,
      kontak TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS kategori (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nama TEXT NOT NULL UNIQUE COLLATE NOCASE,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS anggaran_kategori (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proyek_id INTEGER NOT NULL REFERENCES proyek(id),
      kategori_id INTEGER NOT NULL REFERENCES kategori(id),
      pagu_anggaran INTEGER NOT NULL DEFAULT 0,
      revisi_ke INTEGER NOT NULL DEFAULT 1,
      alasan_revisi TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(proyek_id, kategori_id)
    );

    CREATE TABLE IF NOT EXISTS transaksi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idempotency_key TEXT UNIQUE,
      proyek_id INTEGER NOT NULL REFERENCES proyek(id),
      kategori_id INTEGER REFERENCES kategori(id),
      jenis_transaksi TEXT NOT NULL CHECK(jenis_transaksi IN (
        'MODAL_MASUK', 'PENARIKAN_MODAL', 'PENGELUARAN_LANGSUNG',
        'PANJAR', 'NOTA_PANJAR', 'PENGEMBALIAN_SISA', 'GANTI_TALANGAN'
      )),
      nominal INTEGER NOT NULL CHECK(nominal > 0),
      tanggal_transaksi DATE NOT NULL,
      uraian TEXT NOT NULL,
      vendor TEXT,
      jumlah TEXT,
      is_cancelled INTEGER NOT NULL DEFAULT 0,
      cancelled_at DATETIME,
      cancel_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proyek_id INTEGER REFERENCES proyek(id),
      transaksi_id INTEGER REFERENCES transaksi(id),
      aksi TEXT NOT NULL,
      keterangan TEXT NOT NULL,
      nilai_sebelum TEXT,
      nilai_sesudah TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS jenis_konstruksi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nama TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `;

  await db.exec(ddl);

  // Drop table transaksi_foto jika ada untuk mencegah data hantu
  try { await db.run('DROP TABLE IF EXISTS transaksi_foto'); } catch (e) {}

  // Tambah kolom kode_akses pada users jika belum ada
  try {
    await db.run("ALTER TABLE users ADD COLUMN kode_akses TEXT DEFAULT '231125'");
  } catch (e) {}
  try {
    await db.run("UPDATE users SET kode_akses = '231125' WHERE kode_akses IS NULL OR kode_akses = ''");
  } catch (e) {}

  // Tambah kolom tanggal_selesai pada proyek jika belum ada
  try {
    await db.run("ALTER TABLE proyek ADD COLUMN tanggal_selesai DATE");
  } catch (e) {}

  // Tambah kolom jumlah pada transaksi jika belum ada
  try {
    await db.run("ALTER TABLE transaksi ADD COLUMN jumlah TEXT");
  } catch (e) {}

  // Seed default single user if not present
  const user = await db.get('SELECT * FROM users WHERE id = 1');
  if (!user) {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash('admin12345', salt);
    await db.run(
      'INSERT INTO users (id, email, password_hash, nama, kode_akses) VALUES (1, ?, ?, ?, ?)',
      ['pemilik@kasproyek.com', hash, 'Pemilik CV', '231125']
    );
  }

  // Seed default single CV if not present
  const cv = await db.get('SELECT * FROM cv WHERE id = 1');
  if (!cv) {
    await db.run('INSERT INTO cv (id, nama) VALUES (1, ?)', ['CV. Pembangunan Bersama']);
  }

  // Seed default single cabang if not present
  const cabang = await db.get('SELECT * FROM cabang LIMIT 1');
  if (!cabang) {
    await db.run(
      "INSERT INTO cabang (nama, kota, catatan, is_active) VALUES ('Kantor Pusat', 'Pusat', 'Cabang Utama', 1)"
    );
  }

  // Seed default 8 categories (BR-16)
  const defaultCategories = [
    'Material',
    'Upah Kerja',
    'Sewa Alat',
    'Subkontraktor',
    'Transportasi',
    'Operasional',
    'Perizinan',
    'Lain-lain'
  ];

  for (const catName of defaultCategories) {
    await db.run(
      'INSERT OR IGNORE INTO kategori (nama, is_active) VALUES (?, 1)',
      [catName]
    );
  }

  // Seed default jenis konstruksi
  const defaultJenis = ['Rumah', 'Ruko', 'Renovasi', 'Gedung', 'Lainnya'];
  for (const j of defaultJenis) {
    await db.run(
      'INSERT OR IGNORE INTO jenis_konstruksi (nama) VALUES (?)',
      [j]
    );
  }
}

module.exports = {
  db,
  initSchema,
  uploadsDir
};
