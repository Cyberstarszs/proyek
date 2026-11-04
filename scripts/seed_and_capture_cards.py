import os
import time
from playwright.sync_api import sync_playwright

ARTIFACT_DIR = r"C:\Users\HP\.gemini\antigravity-cli\brain\593b0b68-0281-4a5e-a9e5-e58956e3f839"

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 950})
        page = context.new_page()

        print("1. Login...")
        page.goto("http://localhost:3000/login")
        page.fill("#kode", "231125")
        page.wait_for_url("http://localhost:3000/")

        print("2. Mendaftarkan Proyek Menengah Jembatan...")
        projects = [
            {
                "nama": "Renovasi Rumah Minimalis",
                "jenis": "Rumah",
                "luas": "65",
                "modal": "35000000",
                "lokasi": "Denpasar Selatan"
            },
            {
                "nama": "Pembangunan Ruko 2 Lantai",
                "jenis": "Ruko",
                "luas": "180",
                "modal": "120000000",
                "lokasi": "Sudirman Square"
            },
            {
                "nama": "Jembatan Trunojoyo",
                "jenis": "Lainnya",
                "luas": "420",
                "modal": "250000000",
                "lokasi": "Jalan Trunojoyo, Panglegur, Pamekasan"
            },
            {
                "nama": "Flyover Ring Road Utara",
                "jenis": "Lainnya",
                "luas": "1200",
                "modal": "850000000",
                "lokasi": "Jalan Tol Lingkar"
            },
            {
                "nama": "Menara Sentral Metropolis",
                "jenis": "Gedung",
                "luas": "3800",
                "modal": "2500000000",
                "lokasi": "Kawasan Pusat Niaga"
            }
        ]

        proyek_ids = []
        for pr in projects:
            page.goto("http://localhost:3000/proyek/baru")
            page.fill('input[name="nama"]', pr["nama"])
            page.click(f'button.pill-jenis:has-text("{pr["jenis"]}")')
            page.fill('input[name="luas_m2"]', pr["luas"])
            page.fill('input[name="lokasi"]', pr["lokasi"])
            page.fill('input[name="modal_awal"]', pr["modal"])
            page.click('button[type="submit"]')
            page.wait_for_load_state("networkidle")
            url = page.url
            pid = url.split("?")[0].split("/")[-1]
            proyek_ids.append(pid)

        # Catat belanja pada proyek jembatan trunojoyo (id index 2)
        jembatan_id = proyek_ids[2]

        print("3. Mengambil screenshot Dasbor Desktop...")
        page.goto("http://localhost:3000/")
        page.wait_for_load_state("networkidle")
        time.sleep(0.5)
        page.screenshot(path=os.path.join(ARTIFACT_DIR, "desktop_dashboard_smartcards.png"), full_page=True)

        print("4. Mengambil screenshot Dasbor Mobile...")
        page.set_viewport_size({"width": 390, "height": 844})
        time.sleep(0.5)
        page.screenshot(path=os.path.join(ARTIFACT_DIR, "mobile_dashboard_smartcards.png"), full_page=True)

        print("5. Mengambil screenshot Detail Proyek Jembatan Menengah 250Jt...")
        page.set_viewport_size({"width": 1280, "height": 850})
        page.goto(f"http://localhost:3000/proyek/{jembatan_id}")
        time.sleep(0.5)
        page.screenshot(path=os.path.join(ARTIFACT_DIR, "desktop_detail_tier_consistency.png"), full_page=True)

        page.set_viewport_size({"width": 390, "height": 844})
        time.sleep(0.5)
        page.screenshot(path=os.path.join(ARTIFACT_DIR, "mobile_detail_tier_consistency.png"), full_page=True)

        print("6. Mengambil screenshot Laporan BI & Grafik...")
        page.set_viewport_size({"width": 1280, "height": 850})
        page.goto("http://localhost:3000/laporan")
        time.sleep(1)
        page.screenshot(path=os.path.join(ARTIFACT_DIR, "desktop_laporan_clean.png"), full_page=True)

        browser.close()
        print("OK: Seluruh screenshot berhasil diambil!")

if __name__ == "__main__":
    run()
