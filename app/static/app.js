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
const updateModal   = document.getElementById('update-modal');
const updateModalLogs = document.getElementById('update-modal-logs');
const updateModalStatus = document.getElementById('update-modal-status');
const updateModalClose = document.getElementById('update-modal-close');
const setupScreen   = document.getElementById('setup-screen');
const appShell      = document.getElementById('app-shell');
const setupForm     = document.getElementById('setup-form');
const setupStatus   = document.getElementById('setup-status');
const setupRadarrUrl = document.getElementById('setup-radarr-url');
const setupRadarrApiKey = document.getElementById('setup-radarr-api-key');
const setupMappings = document.getElementById('setup-mappings');
const setupAddMapping = document.getElementById('setup-add-mapping');

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

function setAppVisible(isVisible) {
  if (isVisible) {
    setupScreen.classList.add('hidden');
    appShell.classList.remove('hidden');
  } else {
    appShell.classList.add('hidden');
    setupScreen.classList.remove('hidden');
  }
}

function createMappingRow(source = '', target = '') {
  const row = document.createElement('div');
  row.className = 'mapping-row grid gap-3 sm:grid-cols-[1fr_1fr_auto]';
  row.innerHTML = `
    <input type="text" class="mapping-source rounded-xl border border-white/10 bg-gray-950 px-4 py-3 text-sm text-white placeholder-gray-500 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/40" placeholder="/radarr/movies" value="${esc(source)}" />
    <input type="text" class="mapping-target rounded-xl border border-white/10 bg-gray-950 px-4 py-3 text-sm text-white placeholder-gray-500 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/40" placeholder="/movies" value="${esc(target)}" />
    <button type="button" class="mapping-remove rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-gray-200 transition hover:bg-white/10">Remove</button>
  `;
  row.querySelector('.mapping-remove').addEventListener('click', () => {
    row.remove();
    if (!setupMappings.children.length) {
      setupMappings.appendChild(createMappingRow());
    }
  });
  return row;
}

function renderMappingRows(mappings = []) {
  setupMappings.innerHTML = '';
  if (!mappings.length) {
    setupMappings.appendChild(createMappingRow());
    return;
  }
  mappings.forEach(mapping => setupMappings.appendChild(createMappingRow(mapping.source, mapping.target)));
}

function collectMappings() {
  return Array.from(setupMappings.querySelectorAll('.mapping-row'))
    .map(row => ({
      source: row.querySelector('.mapping-source').value.trim(),
      target: row.querySelector('.mapping-target').value.trim(),
    }))
    .filter(mapping => mapping.source && mapping.target);
}

async function loadSetupState() {
  const state = await api('GET', '/api/setup/status');
  if (!state.setupComplete) {
    setupRadarrUrl.value = state.radarrUrl || 'http://radarr:7878';
    setupRadarrApiKey.value = '';
    setupRadarrApiKey.placeholder = state.radarrApiKeySet ? 'Leave blank to keep existing key' : 'Enter your Radarr API key';
    renderMappingRows(state.pathMappings || []);
    setAppVisible(false);
    setupStatus.textContent = 'Complete the fields below to finish setup.';
    return false;
  }

  setAppVisible(true);
  return true;
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

setupAddMapping?.addEventListener('click', () => {
  setupMappings.appendChild(createMappingRow());
});

setupForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setupStatus.textContent = 'Saving setup...';

  try {
    const payload = {
      radarr_url: setupRadarrUrl.value.trim(),
      radarr_api_key: setupRadarrApiKey.value.trim(),
      path_mappings: collectMappings(),
    };
    const state = await api('POST', '/api/setup', payload);
    setupStatus.textContent = 'Setup saved. Loading app...';
    setAppVisible(true);
    versionState = { current: '', latest: '', updateAvailable: false, updating: false };
    await loadMovies();
    await checkForUpdate();
    if (!updatePollTimer) {
      updatePollTimer = setInterval(checkForUpdate, 5 * 60 * 1000);
    }
    if (state.setupComplete) {
      showToast('Setup complete');
    }
  } catch (e) {
    setupStatus.textContent = '';
    showToast(`Setup failed: ${e.message}`, 'error');
  }
});

/* ── Version / Update ───────────────────────────────────────────────────── */
let versionState = { current: '', latest: '', updateAvailable: false, updating: false };
let updatePollTimer = null;
let updateStatusTimer = null;

function setUpdateModalVisible(isVisible) {
  if (isVisible) {
    updateModal.classList.remove('hidden');
    updateModal.classList.add('flex');
  } else {
    updateModal.classList.add('hidden');
    updateModal.classList.remove('flex');
  }
}

function renderUpdateModal(status) {
  updateModalStatus.textContent = status.inProgress
    ? 'Updating app and collecting logs...'
    : status.error
      ? `Update failed: ${status.error}`
      : 'Update finished successfully.';
  updateModalLogs.textContent = (status.logs || []).join('\n');
  updateModalLogs.scrollTop = updateModalLogs.scrollHeight;
}

async function refreshUpdateModal() {
  const status = await api('GET', '/api/update/status');
  renderUpdateModal(status);

  if (!status.inProgress && updateStatusTimer) {
    clearInterval(updateStatusTimer);
    updateStatusTimer = null;
    btnUpdate.disabled = false;
    btnUpdate.textContent = 'Upgrade';
    if (!status.error) {
      setTimeout(() => window.location.reload(), 1500);
    }
  }

  return status;
}

function startUpdatePolling() {
  if (updateStatusTimer) return;
  updateStatusTimer = setInterval(async () => {
    try {
      const status = await refreshUpdateModal();
      if (!status.inProgress && status.error) {
        showToast(`Update failed: ${status.error}`, 'error');
      }
    } catch (e) {
      console.warn('Failed to refresh update status', e);
    }
  }, 1500);
}

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
    btnUpdate.textContent = 'Upgrading';
    updateBanner.classList.remove('hidden');
    return;
  }

  if (!versionState.updateAvailable) {
    updateBanner.classList.add('hidden');
    btnUpdate.disabled = false;
    btnUpdate.textContent = 'Upgrade';
    return;
  }

  updateText.textContent = `Update available: ${versionState.current} -> ${versionState.latest}`;
  btnUpdate.disabled = false;
  btnUpdate.textContent = 'Upgrade';
  updateBanner.classList.remove('hidden');
}

async function triggerUpdate() {
  if (btnUpdate.disabled) return;

  btnUpdate.disabled = true;
  btnUpdate.textContent = 'Starting...';
  setUpdateModalVisible(true);
  updateModalStatus.textContent = 'Starting upgrade...';
  updateModalLogs.textContent = '';

  try {
    const res = await api('POST', '/api/update');
    if (!res.started) {
      showToast(res.detail || 'Update already running', 'error');
      updateModalStatus.textContent = res.detail || 'Update already running';
      await checkForUpdate();
      return;
    }

    showToast('Upgrade started. Showing server logs...');
    versionState.updating = true;
    renderUpdateBanner();
    await refreshUpdateModal();
    startUpdatePolling();
  } catch (e) {
    showToast(`Update failed to start: ${e.message}`, 'error');
    btnUpdate.disabled = false;
    btnUpdate.textContent = 'Upgrade';
    updateModalStatus.textContent = `Update failed to start: ${e.message}`;
  }
}

btnUpdate?.addEventListener('click', triggerUpdate);
updateModalClose?.addEventListener('click', () => {
  if (updateStatusTimer) return;
  setUpdateModalVisible(false);
});

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
async function bootstrap() {
  const isReady = await loadSetupState();
  if (!isReady) return;

  await loadMovies();
  await checkForUpdate();

  if (!updatePollTimer) {
    updatePollTimer = setInterval(checkForUpdate, 5 * 60 * 1000);
  }
}

bootstrap();
