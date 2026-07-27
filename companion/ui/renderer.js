const byId = (id) => document.getElementById(id);
let state;
let media = [];
let jobs = [];

function renderStatus(status) {
  byId('status').innerHTML = Object.entries(status).map(([name, value]) =>
    `<span class="status-pill ${String(value?.state || '')}">${name}: ${value?.state || 'unknown'}</span>`
  ).join('');
}

function popoutCard(entry) {
  return `<article class="card" data-popout="${entry.id}">
    <div class="card-head"><strong>Popout ${entry.id}: ${entry.title}</strong><span>${entry.visible ? 'visible' : 'hidden'}</span></div>
    <label>Title <input data-field="title" value="${escapeHtml(entry.title)}"></label>
    <label>URL <input data-field="url" value="${escapeHtml(entry.url)}"></label>
    <div class="actions">
      <button data-popout-show="${entry.id}">Show</button>
      <button data-popout-hide="${entry.id}" class="secondary">Hide</button>
    </div>
  </article>`;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function renderMedia() {
  byId('media-list').innerHTML = media.length ? media.map((item) =>
    `<div class="media-row"><span><strong>${escapeHtml(item.name)}</strong><br><small>${Math.round(item.bytes / 1024)} KB</small></span>
      <span><button data-transcode="${escapeHtml(item.name)}" data-preset="mp4-web" class="secondary">MP4</button>
      <button data-transcode="${escapeHtml(item.name)}" data-preset="audio-mp3" class="secondary">MP3</button>
      <button data-transcode="${escapeHtml(item.name)}" data-preset="gif" class="secondary">GIF</button></span></div>`
  ).join('') : '<p>No local media yet.</p>';
  byId('jobs').innerHTML = jobs.length ? jobs.slice().reverse().map((job) =>
    `<div class="media-row"><span>${escapeHtml(job.outputName || job.inputName)}</span><strong>${escapeHtml(job.status)}</strong></div>`
  ).join('') : '';
}

async function load() {
  state = await window.companion.getState();
  const config = state.config;
  renderStatus(state.status);
  byId('overlay-url').value = config.windows.overlay.url;
  byId('overlay-click-through').checked = config.windows.overlay.clickThrough !== false;
  byId('popouts').innerHTML = config.windows.popouts.map(popoutCard).join('');
  byId('obs-url').value = config.obs.url;
  byId('obs-enabled').checked = config.obs.enabled;
  byId('audio-volume').value = config.audio.volume;
  byId('audio-muted').checked = config.audio.muted;
  byId('relay-url').value = config.relay.url;
  byId('relay-device-id').value = config.relay.deviceId;
  byId('relay-enabled').checked = config.relay.enabled;
  byId('open-at-login').checked = config.startup.openAtLogin;
  byId('start-minimized').checked = config.startup.startMinimized;
  byId('library-path').textContent = config.media.libraryPath || 'Using Companion-managed media folder';
  media = state.media || [];
  jobs = state.jobs || [];
  renderMedia();
  await refreshObsScenes();
}

async function refreshObsScenes() {
  const result = await window.companion.obsScenes().catch(() => ({ scenes: [] }));
  byId('obs-scenes').innerHTML = '<option value="">Select OBS scene</option>' +
    (result.scenes || []).map((scene) => `<option value="${escapeHtml(scene.sceneName)}">${escapeHtml(scene.sceneName)}</option>`).join('');
}

function collectPopouts() {
  return Array.from(document.querySelectorAll('[data-popout]')).map((card) => {
    const original = state.config.windows.popouts.find((entry) => Number(entry.id) === Number(card.dataset.popout));
    return {
      ...original,
      title: card.querySelector('[data-field="title"]').value.trim(),
      url: card.querySelector('[data-field="url"]').value.trim()
    };
  });
}

document.addEventListener('click', async (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.dataset.windowAction) await window.companion.windowAction(target.dataset.windowAction);
  if (target.dataset.popoutShow) await window.companion.windowAction('popout.show', Number(target.dataset.popoutShow));
  if (target.dataset.popoutHide) await window.companion.windowAction('popout.hide', Number(target.dataset.popoutHide));
  if (target.dataset.transcode) {
    const job = await window.companion.transcodeMedia(target.dataset.transcode, target.dataset.preset);
    jobs.push(job);
    renderMedia();
  }
});

byId('save').addEventListener('click', async () => {
  const updates = {
    startup: { openAtLogin: byId('open-at-login').checked, startMinimized: byId('start-minimized').checked },
    relay: {
      url: byId('relay-url').value.trim(),
      deviceId: byId('relay-device-id').value.trim(),
      enabled: byId('relay-enabled').checked
    },
    obs: { url: byId('obs-url').value.trim(), enabled: byId('obs-enabled').checked },
    audio: { volume: Number(byId('audio-volume').value), muted: byId('audio-muted').checked },
    windows: {
      overlay: { ...state.config.windows.overlay, url: byId('overlay-url').value.trim(), clickThrough: byId('overlay-click-through').checked },
      popouts: collectPopouts()
    }
  };
  await window.companion.saveConfig(updates);
  const secrets = {};
  if (byId('obs-password').value) secrets.obsPassword = byId('obs-password').value;
  if (byId('relay-token').value) secrets.relayToken = byId('relay-token').value;
  if (Object.keys(secrets).length) await window.companion.saveSecrets(secrets);
  byId('obs-password').value = '';
  byId('relay-token').value = '';
  byId('message').textContent = 'Saved';
  setTimeout(() => { byId('message').textContent = ''; }, 2000);
  await load();
});

byId('import-media').addEventListener('click', async () => {
  const imported = await window.companion.importMedia();
  if (imported) await load();
});
byId('choose-library').addEventListener('click', async () => {
  const selected = await window.companion.chooseLibrary();
  if (selected) await load();
});
byId('obs-set-scene').addEventListener('click', async () => {
  const sceneName = byId('obs-scenes').value;
  if (sceneName) await window.companion.setObsScene(sceneName);
});
byId('audio-volume').addEventListener('input', () => window.companion.setAudio({ volume: Number(byId('audio-volume').value) }));
byId('audio-muted').addEventListener('change', () => window.companion.setAudio({ muted: byId('audio-muted').checked }));
byId('open-streamweaver').addEventListener('click', () => window.companion.openExternal('http://127.0.0.1:3100/dashboard'));
window.companion.onStatus(renderStatus);
window.companion.onMediaJob((job) => {
  const index = jobs.findIndex((item) => item.id === job.id);
  if (index >= 0) jobs[index] = job;
  else jobs.push(job);
  renderMedia();
});
void load();
