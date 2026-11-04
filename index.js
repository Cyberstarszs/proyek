const app = require('./src/app');
const { initSchema } = require('./src/config/database');

const PORT = process.env.PORT || 3000;

async function bootstrap() {
  try {
    await initSchema();
    app.listen(PORT, () => {
      console.log(`================================================================`);
      console.log(`KasProyek Server Aktif di http://localhost:${PORT}`);
      console.log(`Zona Waktu: WIB (UTC+7) | Database: SQLite (WAL Mode)`);
      console.log(`================================================================`);
    });
  } catch (err) {
    console.error('Inisialisasi aplikasi gagal:', err);
    process.exit(1);
  }
}

bootstrap();
