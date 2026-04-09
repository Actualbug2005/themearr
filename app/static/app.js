/* ── State ───────────────────────────────────────────────────────────────── */
let allMovies = [];
let activeMovieId = null;

/* ── DOM refs ────────────────────────────────────────────────────────────── */
const movieList     = document.getElementById('movie-list');
const searchInput   = document.getElementById('search-input');
const btnSync       = document.getElementById('btn-sync');
const syncStatus    = document.getElementById('sync-status');
const rightEmpty    = document.getElementById('right-empty');
const rightLoading  = document.getElementById('right-loading');
const rightContent  = document.getElementById('right-content');
const movieHeading  = document.getElementById('movie-heading');
const resultsGrid   = document.getElementById('results-grid');
const statTotal     = document.getElementById('stat-total');
const statDone      = document.getElementById('stat-downloaded');
const statPending   = document.getElementById('stat-pending');
const toast         = document.getElementById('toast');
const updateBanner  = document.getElementById('update-banner');
const updateText    = document.getElementById('update-text');
const btnUpdate     = document.getElementById('btn-update');

/* ── Toast ───────────────────────────────────────────────────────────────── */
let toastTimer = null;
function showToast(msg, type = 'success') {
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.className = [
    'fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg shadow-xl text-sm font-medium',
    type === 'success'
      ? 'bg-green-600 text-white'
      : 'bg-red-600 text-white',
  ].join(' ');
  toastTimer = setTimeout(() => { toast.classList.add('hidden'); }, 4000);
}

/* ── API helpers ─────────────────────────────────────────────────────────── */
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
}

/* ── Render movie list ───────────────────────────────────────────────────── */
function renderList(filter = '') {
  const q = filter.toLowerCase();
  const filtered = allMovies.filter(m =>
    m.title.toLowerCase().includes(q) ||
    String(m.year).includes(q)
  );

  movieList.innerHTML = '';
  filtered.forEach(m => {
    const li = document.createElement('li');
    li.dataset.id = m.id;
    li.className = [
      'movie-item cursor-pointer px-4 py-3 hover:bg-gray-800 transition-colors',
      m.id === activeMovieId ? 'active' : '',
    ].join(' ');

    const badge = m.status === 'downloaded'
      ? `<span class="status-downloaded text-xs px-1.5 py-0.5 rounded-full">done</span>`
      : `<span class="status-pending text-xs px-1.5 py-0.5 rounded-full">pending</span>`;

    li.innerHTML = `
      <div class="flex items-start justify-between gap-2">
        <span class="text-sm font-medium leading-snug line-clamp-2">${esc(m.title)}</span>
        ${badge}
      </div>
      <span class="text-xs text-gray-500 mt-0.5 block">${m.year ?? ''}</span>
    `;
    li.addEventListener('click', () => selectMovie(m.id));
    movieList.appendChild(li);
  });
}

/* ── Stats bar ───────────────────────────────────────────────────────────── */
function updateStats() {
  const done    = allMovies.filter(m => m.status === 'downloaded').length;
  const pending = allMovies.filter(m => m.status === 'pending').length;
  statTotal.textContent   = `${allMovies.length} movies`;
  statDone.textContent    = `${done} done`;
  statPending.textContent = `${pending} pending`;
}

/* ── Load movies ─────────────────────────────────────────────────────────── */
async function loadMovies() {
  try {
    allMovies = await api('GET', '/api/movies');
    updateStats();
    renderList(searchInput.value);
  } catch (e) {
    showToast(`Failed to load movies: ${e.message}`, 'error');
  }
}

/* ── Version / Update ───────────────────────────────────────────────────── */
let versionState = { current: '', latest: '', updateAvailable: false, updating: false };

async function checkForUpdate() {
  try {
    versionState = await api('GET', '/api/version');
    renderUpdateBanner();
  } catch (e) {
    console.warn('Version check failed', e);
  }
}

function renderUpdateBanner() {
  if (versionState.updating) {
    updateText.textContent = 'Updating app...';
    btnUpdate.disabled = true;
    btnUpdate.textContent = 'Updating';
    updateBanner.classList.remove('hidden');
    return;
  }

  if (!versionState.updateAvailable) {
    updateBanner.classList.add('hidden');
    btnUpdate.disabled = false;
    btnUpdate.textContent = 'Update';
    return;
  }

  updateText.textContent = `Update available: ${versionState.current} -> ${versionState.latest}`;
  btnUpdate.disabled = false;
  btnUpdate.textContent = 'Update';
  updateBanner.classList.remove('hidden');
}

async function triggerUpdate() {
  if (btnUpdate.disabled) return;

  btnUpdate.disabled = true;
  btnUpdate.textContent = 'Starting...';

  try {
    const res = await api('POST', '/api/update');
    if (!res.started) {
      showToast(res.detail || 'Update already running', 'error');
      await checkForUpdate();
      return;
    }

    showToast('Update started. Waiting for service restart...');
    versionState.updating = true;
    renderUpdateBanner();
    await waitForUpdatedVersion();
  } catch (e) {
    showToast(`Update failed to start: ${e.message}`, 'error');
    btnUpdate.disabled = false;
    btnUpdate.textContent = 'Update';
  }
}

async function waitForUpdatedVersion() {
  const timeoutMs = 3 * 60 * 1000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const next = await api('GET', '/api/version');
      versionState = next;
      renderUpdateBanner();
      if (!next.updateAvailable && !next.updating && next.latest) {
        showToast(`Updated to ${next.current}`);
        setTimeout(() => window.location.reload(), 1200);
        return;
      }
    } catch (_) {
      // Service may be restarting; keep polling until timeout.
    }
    await new Promise(r => setTimeout(r, 5000));
  }

  showToast('Update timed out. Refresh and check status.', 'error');
  await checkForUpdate();
}

btnUpdate?.addEventListener('click', triggerUpdate);

/* ── Sync Radarr ─────────────────────────────────────────────────────────── */
btnSync.addEventListener('click', async () => {
  btnSync.disabled = true;
  syncStatus.textContent = 'Syncing…';
  try {
    const res = await api('POST', '/api/sync');
    syncStatus.textContent = `Synced ${res.synced} movies`;
    await loadMovies();
    showToast(`Synced ${res.synced} movies from Radarr`);
  } catch (e) {
    syncStatus.textContent = '';
    showToast(`Sync failed: ${e.message}`, 'error');
  } finally {
    btnSync.disabled = false;
  }
});

/* ── Select & search ─────────────────────────────────────────────────────── */
async function selectMovie(id) {
  activeMovieId = id;
  renderList(searchInput.value); // re-render to update active highlight

  rightEmpty.classList.add('hidden');
  rightContent.classList.add('hidden');
  rightLoading.classList.remove('hidden');

  try {
    const data = await api('GET', `/api/search/${id}`);
    renderResults(data.movie, data.results);
  } catch (e) {
    rightLoading.classList.add('hidden');
    rightEmpty.classList.remove('hidden');
    showToast(`Search failed: ${e.message}`, 'error');
  }
}

/* ── Render YouTube results ──────────────────────────────────────────────── */
function renderResults(movie, results) {
  rightLoading.classList.add('hidden');
  movieHeading.textContent = `${movie.title} (${movie.year ?? '?'})`;
  resultsGrid.innerHTML = '';

  if (!results.length) {
    resultsGrid.innerHTML = '<p class="text-gray-500 col-span-3">No results found.</p>';
  } else {
    results.forEach(v => {
      const card = document.createElement('div');
      card.className = 'bg-gray-900 rounded-xl overflow-hidden border border-gray-800 flex flex-col';
      card.innerHTML = `
        <div class="aspect-video w-full bg-black">
          <iframe
            class="w-full h-full"
            src="https://www.youtube.com/embed/${esc(v.videoId)}"
            title="${esc(v.title)}"
            frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen>
          </iframe>
        </div>
        <div class="p-3 flex flex-col gap-2 flex-1">
          <p class="text-sm font-medium text-white leading-snug line-clamp-2">${esc(v.title)}</p>
          <div class="flex items-center justify-between text-xs text-gray-500 mt-auto">
            <span>${esc(v.channel || '')}</span>
            <span>${esc(v.duration || '')}</span>
          </div>
          <button
            class="btn-download mt-2 w-full py-2 rounded-lg bg-green-600 hover:bg-green-500
                   text-sm font-semibold transition-colors flex items-center justify-center gap-2"
            data-movie-id="${movie.id}"
            data-video-id="${esc(v.videoId)}">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M5 13l4 4L19 7"/>
            </svg>
            Accept &amp; Download
          </button>
        </div>
      `;
      resultsGrid.appendChild(card);
    });
  }

  rightContent.classList.remove('hidden');

  // Attach download handlers
  resultsGrid.querySelectorAll('.btn-download').forEach(btn => {
    btn.addEventListener('click', () => handleDownload(btn));
  });
}

/* ── Download ────────────────────────────────────────────────────────────── */
async function handleDownload(btn) {
  const movieId = parseInt(btn.dataset.movieId, 10);
  const videoId = btn.dataset.videoId;

  // Disable all download buttons in grid during operation
  resultsGrid.querySelectorAll('.btn-download').forEach(b => { b.disabled = true; });

  btn.innerHTML = `
    <svg class="spinner w-4 h-4" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
    </svg>
    Downloading…
  `;

  try {
    await api('POST', '/api/download', { movie_id: movieId, video_id: videoId });
    showToast('Theme downloaded successfully!');

    // Update local state
    const m = allMovies.find(x => x.id === movieId);
    if (m) m.status = 'downloaded';
    updateStats();
    renderList(searchInput.value);

    btn.innerHTML = `
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
      </svg>
      Downloaded!
    `;
    btn.classList.replace('bg-green-600', 'bg-gray-600');
    btn.classList.replace('hover:bg-green-500', 'hover:bg-gray-600');
  } catch (e) {
    showToast(`Download failed: ${e.message}`, 'error');
    btn.innerHTML = 'Accept &amp; Download';
    resultsGrid.querySelectorAll('.btn-download').forEach(b => { b.disabled = false; });
  }
}

/* ── Search filter ───────────────────────────────────────────────────────── */
searchInput.addEventListener('input', () => renderList(searchInput.value));

/* ── Escape HTML ─────────────────────────────────────────────────────────── */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── Boot ────────────────────────────────────────────────────────────────── */
loadMovies();
checkForUpdate();
setInterval(checkForUpdate, 5 * 60 * 1000);
