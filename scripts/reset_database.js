const { db } = require('../src/config/database');

async function resetAllData() {
  console.log('--- Membersihkan Seluruh Data untuk Pengujian Mandiri ---');

  // Matikan FK sementara saat truncate
  await db.run('PRAGMA foreign_keys = OFF');

  try {
    await db.transaction(async () => {
      // 1. Hapus tabel anak terlebih dahulu
      await db.run('DELETE FROM audit_logs');
      await db.run('DELETE FROM transaksi');
      await db.run('DELETE FROM anggaran_kategori');
      await db.run('DELETE FROM proyek');
      await db.run('DELETE FROM pembeli');
      await db.run('DELETE FROM cabang');
      await db.run('DELETE FROM kategori');

      // 2. Masukkan 1 cabang awal default siap pakai
      await db.run(
        "INSERT INTO cabang (id, nama, kota, catatan, is_active) VALUES (1, 'Kantor Pusat', 'Pusat', 'Cabang Utama', 1)"
      );

      // 3. Masukkan 8 kategori standar awal
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
      for (let i = 0; i < defaultCategories.length; i++) {
        await db.run(
          'INSERT INTO kategori (id, nama, is_active) VALUES (?, ?, 1)',
          [i + 1, defaultCategories[i]]
        );
      }

      // 3b. Reset jenis konstruksi default
      await db.run('DELETE FROM jenis_konstruksi');
      const defaultJenis = ['Rumah', 'Ruko', 'Renovasi', 'Gedung', 'Lainnya'];
      for (const j of defaultJenis) {
        await db.run('INSERT INTO jenis_konstruksi (nama) VALUES (?)', [j]);
      }

      // 4. Reset auto-increment SQLite sequence
      await db.run("DELETE FROM sqlite_sequence WHERE name IN ('transaksi', 'audit_logs', 'anggaran_kategori', 'proyek', 'pembeli')");
      await db.run("UPDATE sqlite_sequence SET seq = 1 WHERE name = 'cabang'");
      await db.run("UPDATE sqlite_sequence SET seq = 8 WHERE name = 'kategori'");

      // 5. Pastikan akun pemilik aktif dan PIN 231125
      await db.run(
        "UPDATE users SET kode_akses = '231125', failed_attempts = 0, locked_until = NULL WHERE id = 1"
      );

      // 6. Reset CV
      await db.run(
        "UPDATE cv SET nama = 'CV. Pembangunan Bersama', logo_path = NULL WHERE id = 1"
      );
    });
  } finally {
    await db.run('PRAGMA foreign_keys = ON');
  }

  console.log('✓ Database bersih 100%!');

  const tables = ['cabang', 'proyek', 'transaksi', 'anggaran_kategori', 'kategori', 'audit_logs', 'users'];
  for (const t of tables) {
    const res = await db.get('SELECT COUNT(*) as count FROM ' + t);
    console.log(`  - ${t}: ${res.count} baris`);
  }
}

resetAllData().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
