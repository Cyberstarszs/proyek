// KasProyek Client Helper & Field Utilities

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// 1. Inisialisasi Saat Dokumen Siap
document.addEventListener('DOMContentLoaded', () => {
  // Idempotency Key & Form Submission Safety
  const forms = document.querySelectorAll('form[data-idempotent]');
  forms.forEach((form) => {
    let keyInput = form.querySelector('input[name="idempotency_key"]');
    if (!keyInput) {
      keyInput = document.createElement('input');
      keyInput.type = 'hidden';
      keyInput.name = 'idempotency_key';
      form.appendChild(keyInput);
    }
    keyInput.value = generateUUID();

    form.addEventListener('submit', () => {
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add('opacity-75', 'cursor-not-allowed');
      }
    });
  });

  // Pasang Format Titik Ribuan (e.g. 1.000 bukan 1000) pada seluruh input harga/nominal
  initRupiahMask();

  // Pasang Deteksi Kategori Otomatis Real-time pada Modal Belanja
  initSmartCategoryDetector();

  // Pasang Backdrop Click & Escape Listener untuk semua Modal
  initModalListeners();

  // Pasang Keyboard Shortcut (B = Belanja, M = Modal)
  initKeyboardShortcuts();

  // Auto-dismiss Notifikasi Flash (3.5 Detik)
  initFlashAutoDismiss();
});

// Auto-dismiss Flash Alerts secara halus
function initFlashAutoDismiss() {
  const successAlert = document.getElementById('flash-alert-success');
  if (successAlert) {
    setTimeout(() => {
      successAlert.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
      successAlert.style.opacity = '0';
      successAlert.style.transform = 'translateY(-6px)';
      setTimeout(() => {
        const container = successAlert.closest('.max-w-7xl');
        if (container) container.remove();
        else successAlert.remove();
      }, 400);
    }, 3500);
  }

  const errorAlert = document.getElementById('flash-alert-error');
  if (errorAlert) {
    setTimeout(() => {
      errorAlert.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
      errorAlert.style.opacity = '0';
      errorAlert.style.transform = 'translateY(-6px)';
      setTimeout(() => {
        const container = errorAlert.closest('.max-w-7xl');
        if (container) container.remove();
        else errorAlert.remove();
      }, 400);
    }, 6000);
  }
}

// 2. Format Titik Ribuan (1.000 bukan 1000)
function formatAngkaTitik(val) {
  if (val === undefined || val === null || val === '') return '';
  const clean = String(val).replace(/\D/g, '');
  if (!clean) return '';
  return Number(clean).toLocaleString('id-ID');
}

function initRupiahMask() {
  const inputs = document.querySelectorAll('input[name="nominal"], input[name="modal_awal"], input[name="pagu_anggaran"], .currency-input');
  inputs.forEach(input => {
    if (input.type === 'number') {
      input.type = 'text';
      input.inputMode = 'numeric';
    }

    input.addEventListener('input', () => {
      const cursor = input.selectionStart;
      const prevLen = input.value.length;
      const formatted = formatAngkaTitik(input.value);
      input.value = formatted;
      
      // Pertahankan posisi kursor jika memungkinkan
      const newLen = formatted.length;
      if (cursor && newLen > prevLen) {
        input.setSelectionRange(cursor + 1, cursor + 1);
      }
    });

    if (input.value) {
      input.value = formatAngkaTitik(input.value);
    }
  });
}

// 3. Tombol Cepat Nominal (+50rb, +100rb, dll)
function tambahNominal(modalId, delta) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  const input = modal.querySelector('input[name="nominal"]');
  if (!input) return;

  if (delta === 0) {
    input.value = '';
  } else {
    const raw = String(input.value || '').replace(/\D/g, '');
    const current = Number(raw || 0);
    input.value = formatAngkaTitik(current + delta);
  }

  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
}

function setNominalInput(inputId, delta) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (delta === 0) {
    input.value = '';
  } else {
    const raw = String(input.value || '').replace(/\D/g, '');
    const current = Number(raw || 0);
    input.value = formatAngkaTitik(current + delta);
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
}

// 4. Deteksi Kategori Otomatis & Pemilihan Kategori Kustom
function initSmartCategoryDetector() {
  const uraianInput = document.getElementById('belanja-uraian-input');
  const badgeEl = document.getElementById('live-kategori-badge');
  const selectKat = document.getElementById('belanja-kategori-select');
  if (!uraianInput || !badgeEl) return;

  const rules = [
    { regex: /semen|pasir|bata|hebel|besi|kawat|cat|keramik|granit|batu|koral|kayu|triplek|paku|paralon|pipa|kabel|genteng|baja|spandek|asbes|seng|nat|amplas|tiner|lem|gypsum|baut|screed|mortir/i, nama: 'Material' },
    { regex: /upah|tukang|pekerja|mandor|kenek|kernet|gaji|lembur|borongan|harian|ongkos/i, nama: 'Upah Kerja' },
    { regex: /sewa|molen|bego|excavator|jack|scaffolding|perancah|genset|vibrator|pompa|stamper|alat/i, nama: 'Sewa Alat' },
    { regex: /transport|bensin|solar|ongkir|armada|dump|angkut|tol|parkir/i, nama: 'Transportasi' },
    { regex: /makan|konsumsi|kopi|air|galon|rokok|snack|pulsa|atk|listrik|pdam/i, nama: 'Operasional' },
    { regex: /izin|pbg|imb|retribusi|koordinasi|lingkungan|amdal/i, nama: 'Perizinan' },
    { regex: /subkon|aluminium|baja ringan|plafon|kanopi|teralis|pagar|kaca/i, nama: 'Subkontraktor' }
  ];

  window.triggerKategoriDetection = () => {
    // Jika user memilih kategori spesifik atau kategori baru, jangan timpa
    if (selectKat && (selectKat.value !== '' && selectKat.value !== '__BARU__')) {
      return;
    }
    const val = (uraianInput.value || '').trim().toLowerCase();
    if (!val) {
      badgeEl.classList.add('hidden');
      badgeEl.innerHTML = '';
      return;
    }

    let match = 'Lain-lain';
    for (const r of rules) {
      if (r.regex.test(val)) {
        match = r.nama;
        break;
      }
    }

    badgeEl.classList.remove('hidden');
    badgeEl.innerHTML = `
      <span class="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
        <svg class="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>
        <span>Kategori Otomatis: <strong>${match}</strong></span>
      </span>
    `;
  };

  uraianInput.addEventListener('input', window.triggerKategoriDetection);
}

// Handler Dropdown Kategori di Form Belanja
function handleKategoriSelect(select) {
  const container = document.getElementById('container-kategori-baru');
  const inputBaru = document.getElementById('input-kategori-baru');
  const badgeEl = document.getElementById('live-kategori-badge');

  if (select.value === '__BARU__') {
    if (container) container.classList.remove('hidden');
    if (inputBaru) {
      inputBaru.required = true;
      inputBaru.focus();
    }
    if (badgeEl) badgeEl.classList.add('hidden');
  } else {
    if (container) container.classList.add('hidden');
    if (inputBaru) {
      inputBaru.required = false;
      inputBaru.value = '';
    }

    if (select.value !== '') {
      const text = select.options[select.selectedIndex].text;
      if (badgeEl) {
        badgeEl.classList.remove('hidden');
        badgeEl.innerHTML = `
          <span class="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
            <svg class="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>
            <span>Kategori: <strong>${text}</strong></span>
          </span>
        `;
      }
    } else {
      if (typeof window.triggerKategoriDetection === 'function') {
        window.triggerKategoriDetection();
      }
    }
  }
}

// 5. Modal Helper
function openModal(id) {
  const m = document.getElementById(id);
  if (m) {
    m.classList.remove('hidden');
    m.classList.add('flex');
    document.body.classList.add('overflow-hidden');

    const fab = document.getElementById('fab-catat-belanja');
    if (fab) fab.classList.add('hidden');

    setTimeout(() => {
      const firstInput = m.querySelector('input:not([type="hidden"]), select, textarea');
      if (firstInput) firstInput.focus();
    }, 50);
  }
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) {
    m.classList.add('hidden');
    m.classList.remove('flex');
    document.body.classList.remove('overflow-hidden');

    const fab = document.getElementById('fab-catat-belanja');
    if (fab) fab.classList.remove('hidden');
  }
}

function initModalListeners() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const searchInput = document.getElementById('input-cari-bukukas');
      if (document.activeElement === searchInput && searchInput.value) {
        clearBukuKasSearch();
        return;
      }
      const openModals = document.querySelectorAll('.fixed.z-50.flex:not(.hidden)');
      openModals.forEach(m => closeModal(m.id));
    }
  });

  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('fixed') && e.target.classList.contains('z-50')) {
      closeModal(e.target.id);
    }
  });
}

// 6. Keyboard Shortcuts Global
function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

    const openModals = document.querySelectorAll('.fixed.z-50.flex:not(.hidden)');
    if (openModals.length > 0) return;

    if (e.key === 'b' || e.key === 'B') {
      const modal = document.getElementById('modal-pengeluaran');
      if (modal) {
        e.preventDefault();
        openModal('modal-pengeluaran');
      }
    } else if (e.key === 'm' || e.key === 'M') {
      const modal = document.getElementById('modal-kelola-modal');
      if (modal) {
        e.preventDefault();
        openModal('modal-kelola-modal');
      }
    }
  });
}

// 7. Tab Switcher
function switchTab(tabName) {
  const tabs = document.querySelectorAll('.tab-content');
  const buttons = document.querySelectorAll('.tab-btn');

  tabs.forEach(t => t.classList.add('hidden'));
  buttons.forEach(b => {
    b.classList.remove('border-slate-900', 'text-slate-900', 'bg-slate-100');
    b.classList.add('border-transparent', 'text-slate-500');
  });

  const activeTab = document.getElementById('tab-' + tabName);
  const activeBtn = document.getElementById('btn-tab-' + tabName);

  if (activeTab) activeTab.classList.remove('hidden');
  if (activeBtn) {
    activeBtn.classList.remove('border-transparent', 'text-slate-500');
    activeBtn.classList.add('border-slate-900', 'text-slate-900');
  }
}

// 8. Pencarian Instan Baris Tabel & Kartu Mobile (Tanpa reload)
function filterTabelBukuKas(input) {
  const query = (input.value || '').toLowerCase().trim();
  const rows = document.querySelectorAll('#tabel-buku-kas tbody tr');
  const cards = document.querySelectorAll('.buku-kas-card');
  const counter = document.getElementById('search-counter');
  const clearBtn = document.getElementById('search-clear-btn');
  const noMatchMsg = document.getElementById('search-no-match');

  if (clearBtn) {
    if (query.length > 0) {
      clearBtn.classList.remove('hidden');
    } else {
      clearBtn.classList.add('hidden');
    }
  }

  let matchCount = 0;
  let totalCount = 0;

  rows.forEach(row => {
    if (row.querySelector('td[colspan]')) return;
    totalCount++;
    const text = row.innerText.toLowerCase();
    if (text.includes(query)) {
      row.style.display = '';
      matchCount++;
    } else {
      row.style.display = 'none';
    }
  });

  cards.forEach(card => {
    const text = card.innerText.toLowerCase();
    if (text.includes(query)) {
      card.style.display = '';
    } else {
      card.style.display = 'none';
    }
  });

  if (counter) {
    if (query.length > 0) {
      counter.innerText = `${matchCount} ditemukan`;
      counter.classList.remove('hidden');
    } else {
      counter.innerText = '';
      counter.classList.add('hidden');
    }
  }

  if (noMatchMsg) {
    if (query.length > 0 && matchCount === 0 && totalCount > 0) {
      noMatchMsg.classList.remove('hidden');
    } else {
      noMatchMsg.classList.add('hidden');
    }
  }
}

function clearBukuKasSearch() {
  const input = document.getElementById('input-cari-bukukas');
  if (input) {
    input.value = '';
    filterTabelBukuKas(input);
    input.focus();
  }
}

// 9. Pencarian Instan Kartu Proyek di Dasbor
function filterProyekCards(input) {
  const query = (input.value || '').toLowerCase().trim();
  const cards = document.querySelectorAll('.proyek-card');
  const sections = document.querySelectorAll('.cabang-section');

  cards.forEach(card => {
    const text = card.innerText.toLowerCase();
    if (text.includes(query)) {
      card.style.display = '';
    } else {
      card.style.display = 'none';
    }
  });

  sections.forEach(sec => {
    const visibleCards = sec.querySelectorAll('.proyek-card:not([style*="display: none"])');
    if (visibleCards.length === 0 && query.length > 0) {
      sec.style.display = 'none';
    } else {
      sec.style.display = '';
    }
  });
}

// 10. Traking Lokasi GPS Otomatis & Akurat
let sedangMelacakLokasi = false;

async function lacakLokasiGPS(targetId = 'lokasi') {
  if (sedangMelacakLokasi) return;
  const input = document.getElementById(targetId);
  const statusEl = document.getElementById('status-gps') || document.getElementById(`status-gps-${targetId}`);
  const labelGps = document.getElementById('label-gps') || document.getElementById(`label-gps-${targetId}`);

  if (!navigator.geolocation) {
    if (statusEl) {
      statusEl.textContent = 'GPS tidak didukung pada peramban ini.';
      statusEl.className = 'text-[10px] text-rose-500 mt-1 block';
    }
    return;
  }

  sedangMelacakLokasi = true;
  if (labelGps) labelGps.textContent = 'Melacak...';
  if (statusEl) {
    statusEl.textContent = 'Mencari sinyal GPS akurat...';
    statusEl.className = 'text-[10px] text-slate-400 mt-1 block animate-pulse';
  }

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const akurasi = Math.round(pos.coords.accuracy);

      let namaAlamat = '';

      // Terjemahkan via reverse-geocoding OpenStreetMap Nominatim
      try {
        if (statusEl) statusEl.textContent = 'Mendeteksi alamat...';
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        const resp = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`,
          { signal: ctrl.signal, headers: { 'Accept-Language': 'id' } }
        );
        clearTimeout(timer);

        if (resp.ok) {
          const data = await resp.json();
          const addr = data.address || {};
          const jalan = addr.road || addr.street || addr.pedestrian || addr.building || '';
          const kel = addr.village || addr.suburb || addr.neighbourhood || addr.quarter || '';
          const kota = addr.city || addr.town || addr.county || addr.municipality || addr.city_district || '';
          
          const komponen = [jalan, kel, kota].filter(Boolean);
          if (komponen.length > 0) {
            namaAlamat = komponen.join(', ');
          } else if (data.display_name) {
            namaAlamat = data.display_name.split(',').slice(0, 3).join(',').trim();
          }
        }
      } catch (e) {
        // Fallback offline / timeout aman
      }

      if (!namaAlamat) {
        namaAlamat = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
      }

      if (input) {
        input.value = namaAlamat;
        input.focus();
      }

      if (labelGps) labelGps.textContent = 'GPS';
      if (statusEl) {
        statusEl.textContent = `Lokasi terpasang (±${akurasi}m)`;
        statusEl.className = 'text-[10px] text-emerald-600 mt-1 block font-medium';
        setTimeout(() => {
          if (statusEl) statusEl.classList.add('hidden');
        }, 4000);
      }
      sedangMelacakLokasi = false;
    },
    (err) => {
      sedangMelacakLokasi = false;
      if (labelGps) labelGps.textContent = 'GPS';
      if (statusEl) {
        let pesan = 'Gagal mendeteksi lokasi.';
        if (err.code === 1) pesan = 'Izin akses lokasi ditolak.';
        else if (err.code === 2) pesan = 'Sinyal lokasi tidak dapat diperoleh.';
        else if (err.code === 3) pesan = 'Waktu deteksi lokasi habis.';
        statusEl.textContent = pesan;
        statusEl.className = 'text-[10px] text-amber-600 mt-1 block';
      }
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    }
  );
}

// Ekspor ke window global
window.lacakLokasiGPS = lacakLokasiGPS;
