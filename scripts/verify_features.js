const { chromium } = require('playwright');
const path = require('path');

const ARTIFACT_DIR = 'C:/Users/HP/.gemini/antigravity-cli/brain/593b0b68-0281-4a5e-a9e5-e58956e3f839';

async function verify() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  console.log('1. Membuka login...');
  await page.goto('http://localhost:3000/login');
  await page.fill('#input-kode-akses', '231125');
  await page.click('button[type="submit"]');
  await page.waitForURL('http://localhost:3000/');

  console.log('2. Membuat proyek baru...');
  await page.goto('http://localhost:3000/proyek/baru');
  await page.fill('input[name="nama"]', 'Renovasi Ruko Sudirman');
  await page.selectOption('select[name="jenis_bangunan"]', 'Ruko');
  await page.fill('input[name="luas_m2"]', '200');
  await page.fill('input[name="modal_awal"]', '100000000');
  await page.click('button[type="submit"]');

  await page.waitForURL(/\/proyek\/\d+/);
  const proyekUrl = page.url();
  console.log('   Proyek URL:', proyekUrl);

  console.log('3. Membuka modal Belanja dan mengisi dengan jumlah...');
  // Klik Catat Belanja
  await page.click('button:has-text("Catat Belanja")');
  await page.waitForSelector('#modal-pengeluaran', { state: 'visible' });

  // Belanja 1: Semen
  await page.fill('#belanja-uraian-input', 'Semen Tiga Roda');
  await page.fill('#modal-pengeluaran input[name="nominal"]', '500000');
  await page.fill('#modal-pengeluaran input[name="jumlah"]', '10 sak');
  await page.fill('#modal-pengeluaran input[name="vendor"]', 'TB Sentosa Abadi');
  await page.click('#modal-pengeluaran button[type="submit"]');
  await page.waitForLoadState('networkidle');

  // Belanja 2: Cat Tembok
  await page.click('button:has-text("Catat Belanja")');
  await page.waitForSelector('#modal-pengeluaran', { state: 'visible' });
  await page.fill('#belanja-uraian-input', 'Cat Tembok Putih');
  await page.selectOption('#belanja-kategori-select', { label: 'Material' });
  await page.fill('#modal-pengeluaran input[name="nominal"]', '350000');
  await page.fill('#modal-pengeluaran input[name="jumlah"]', '2 ember');
  await page.fill('#modal-pengeluaran input[name="vendor"]', 'TB Sentosa Abadi');
  await page.click('#modal-pengeluaran button[type="submit"]');
  await page.waitForLoadState('networkidle');

  // Belanja 3: Nasi Bungkus Tukang (Operasional)
  await page.click('button:has-text("Catat Belanja")');
  await page.waitForSelector('#modal-pengeluaran', { state: 'visible' });
  await page.fill('#belanja-uraian-input', 'Nasi Bungkus Siang Tukang');
  await page.selectOption('#belanja-kategori-select', { label: 'Operasional' });
  await page.fill('#modal-pengeluaran input[name="nominal"]', '100000');
  await page.fill('#modal-pengeluaran input[name="jumlah"]', '5 bungkus');
  await page.fill('#modal-pengeluaran input[name="vendor"]', 'Warung Bu Siti');
  await page.click('#modal-pengeluaran button[type="submit"]');
  await page.waitForLoadState('networkidle');

  console.log('4. Mengambil screenshot detail proyek (tanpa modal kas & tanpa tombol ekspor)...');
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'desktop_detail_bersih.png'), fullPage: true });

  console.log('5. Menguji filter per kategori Material...');
  // Pilih kategori Material di select
  const materialOpt = await page.$eval('select[name="kategori_id"] option:has-text("Material")', el => el.value);
  await page.selectOption('select[name="kategori_id"]', materialOpt);
  await page.waitForLoadState('networkidle');

  console.log('6. Mengambil screenshot filter per kategori aktif dengan kalkulasi subtotal...');
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'desktop_filter_kategori.png'), fullPage: true });

  // Mobile viewport test
  console.log('7. Menguji tampilan mobile detail & filter...');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mobile_filter_kategori.png'), fullPage: true });

  // Reset filter di mobile
  await page.goto(proyekUrl);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mobile_detail_bersih.png'), fullPage: true });

  // Desktop view lagi untuk akhiri proyek dan cek Histori
  console.log('8. Mengakhiri proyek dan mengecek Histori...');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.click('button:has-text("Akhiri Proyek")');
  await page.waitForSelector('#modal-akhiri-proyek', { state: 'visible' });
  await page.click('#modal-akhiri-proyek button[type="submit"]');
  await page.waitForURL('http://localhost:3000/histori');

  console.log('9. Membuka detail belanja di Histori...');
  await page.click('button:has-text("Detail Belanja")');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'desktop_histori_subtotal.png'), fullPage: true });

  // Mobile view Histori
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mobile_histori_subtotal.png'), fullPage: true });

  // Cek Halaman Laporan BI bebas tombol ekspor
  await page.goto('http://localhost:3000/laporan');
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mobile_laporan_clean.png'), fullPage: true });

  await browser.close();
  console.log('[OK] Seluruh verifikasi UI dan screenshot berhasil diselesaikan.');
}

verify().catch(err => {
  console.error('Error saat verifikasi:', err);
  process.exit(1);
});
