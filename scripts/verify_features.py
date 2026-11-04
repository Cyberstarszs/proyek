import os
import re
import time
from playwright.sync_api import sync_playwright

ARTIFACT_DIR = r"C:\Users\HP\.gemini\antigravity-cli\brain\593b0b68-0281-4a5e-a9e5-e58956e3f839"

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        page = context.new_page()

        print("1. Membuka login...")
        page.goto("http://localhost:3000/login")
        page.fill("#kode", "231125")
        page.wait_for_url("http://localhost:3000/")

        print("2. Membuat proyek baru...")
        proj_name = f"Renovasi Ruko Sudirman {int(time.time())}"
        page.goto("http://localhost:3000/proyek/baru")
        page.fill('input[name="nama"]', proj_name)
        page.click('button.pill-jenis:has-text("Ruko")')
        page.fill('input[name="luas_m2"]', "200")
        page.fill('input[name="modal_awal"]', "100000000")
        page.click('button[type="submit"]')

        page.wait_for_url(re.compile(r"/proyek/\d+"))
        proyek_url = page.url
        print("   Proyek URL:", proyek_url)

        print("3. Membuka modal Belanja dan mengisi dengan jumlah...")
        # Belanja 1: Semen
        page.click('button:has-text("Catat Belanja")')
        page.wait_for_selector("#modal-pengeluaran", state="visible")
        page.fill("#belanja-uraian-input", "Semen Tiga Roda")
        page.fill('#modal-pengeluaran input[name="nominal"]', "500000")
        page.fill('#modal-pengeluaran input[name="jumlah"]', "10 sak")
        page.fill('#modal-pengeluaran input[name="vendor"]', "TB Sentosa Abadi")
        page.click('#modal-pengeluaran button[type="submit"]')
        page.wait_for_load_state("networkidle")

        # Belanja 2: Cat Tembok
        page.click('button:has-text("Catat Belanja")')
        page.wait_for_selector("#modal-pengeluaran", state="visible")
        page.fill("#belanja-uraian-input", "Cat Tembok Putih")
        page.select_option("#belanja-kategori-select", label="Material")
        page.fill('#modal-pengeluaran input[name="nominal"]', "350000")
        page.fill('#modal-pengeluaran input[name="jumlah"]', "2 ember")
        page.fill('#modal-pengeluaran input[name="vendor"]', "TB Sentosa Abadi")
        page.click('#modal-pengeluaran button[type="submit"]')
        page.wait_for_load_state("networkidle")

        # Belanja 3: Nasi Bungkus Tukang (Operasional)
        page.click('button:has-text("Catat Belanja")')
        page.wait_for_selector("#modal-pengeluaran", state="visible")
        page.fill("#belanja-uraian-input", "Nasi Bungkus Siang Tukang")
        page.select_option("#belanja-kategori-select", label="Operasional")
        page.fill('#modal-pengeluaran input[name="nominal"]', "100000")
        page.fill('#modal-pengeluaran input[name="jumlah"]', "5 bungkus")
        page.fill('#modal-pengeluaran input[name="vendor"]', "Warung Bu Siti")
        page.click('#modal-pengeluaran button[type="submit"]')
        page.wait_for_load_state("networkidle")

        print("4. Mengambil screenshot detail proyek (tanpa modal kas & tanpa tombol ekspor)...")
        page.screenshot(path=os.path.join(ARTIFACT_DIR, "desktop_detail_bersih.png"), full_page=True)

        print("5. Menguji filter per kategori Material...")
        page.select_option('#form-filter-bukukas select[name="kategori_id"]', label="Material")
        page.wait_for_load_state("networkidle")

        print("6. Mengambil screenshot filter per kategori aktif dengan kalkulasi subtotal...")
        page.screenshot(path=os.path.join(ARTIFACT_DIR, "desktop_filter_kategori.png"), full_page=True)

        # Mobile viewport test
        print("7. Menguji tampilan mobile detail & filter...")
        page.set_viewport_size({"width": 390, "height": 844})
        page.screenshot(path=os.path.join(ARTIFACT_DIR, "mobile_filter_kategori.png"), full_page=True)

        # Reset filter di mobile
        page.goto(proyek_url)
        page.wait_for_load_state("networkidle")
        page.screenshot(path=os.path.join(ARTIFACT_DIR, "mobile_detail_bersih.png"), full_page=True)

        # Desktop view lagi untuk akhiri proyek dan cek Histori
        print("8. Mengakhiri proyek dan mengecek Histori...")
        page.set_viewport_size({"width": 1280, "height": 800})
        page.click('button:has-text("Akhiri Proyek")')
        page.wait_for_selector("#modal-akhiri-proyek", state="visible")
        page.click('#modal-akhiri-proyek button[type="submit"]')
        page.wait_for_load_state("networkidle")

        print("9. Membuka halaman Histori...")
        page.goto("http://localhost:3000/histori")
        page.wait_for_load_state("networkidle")

        print("10. Membuka detail belanja di Histori...")
        page.click('button:has-text("Detail Belanja")')
        time.sleep(0.5)
        page.screenshot(path=os.path.join(ARTIFACT_DIR, "desktop_histori_subtotal.png"), full_page=True)

        # Mobile view Histori
        page.set_viewport_size({"width": 390, "height": 844})
        page.screenshot(path=os.path.join(ARTIFACT_DIR, "mobile_histori_subtotal.png"), full_page=True)

        # Cek Halaman Laporan BI bebas tombol ekspor
        page.goto("http://localhost:3000/laporan")
        page.screenshot(path=os.path.join(ARTIFACT_DIR, "mobile_laporan_clean.png"), full_page=True)

        browser.close()
        print("[OK] Seluruh verifikasi UI dan screenshot berhasil diselesaikan.")

if __name__ == "__main__":
    run()
