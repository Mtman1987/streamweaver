const byId = (id) => document.getElementById(id);
let state;
let media = [];
let jobs = [];
let mediaCache = null;
let hardware = null;
let workflowJobs = [];
let confirmations = [];

function renderStatus(status) {
  byId('status').innerHTML = Object.entries(status).map(([name, value]) =>
    `<span class="status-pill ${String(value?.state || '')}" title="${escapeHtml(value?.detail || '')}">${escapeHtml(name.replace(/([A-Z])/g, ' $1'))}: ${escapeHtml(value?.state || 'unknown')}</span>`
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
      <button data-transcode="${escapeHtml(item.name)}" data-preset="gif" class="secondary">GIF</button>
      <button data-play-media="${escapeHtml(item.name)}">Play in OBS</button></span></div>`
  ).join('') : '<p>No local media yet.</p>';
  byId('jobs').innerHTML = jobs.length ? jobs.slice().reverse().map((job) => {
    const progress = job.totalBytes ? ` · ${Math.min(100, Math.round((Number(job.bytes || 0) / Number(job.totalBytes)) * 100))}%` : job.bytes ? ` · ${Math.round(job.bytes / 1024 / 1024)} MB` : '';
    const cancel = job.status === 'running' && job.type === 'download'
      ? `<button data-cancel-job="${escapeHtml(job.id)}" class="danger">Cancel</button>`
      : `<strong>${escapeHtml(job.status)}</strong>`;
    return `<div class="media-row"><span>${escapeHtml(job.outputName || job.inputName)}<br><small>${escapeHtml(job.engine || job.type || '')}${escapeHtml(progress)}</small></span>${cancel}</div>`;
  }
  ).join('') : '';
}

function renderWorkflows() {
  byId('workflow-jobs').innerHTML = workflowJobs.length ? workflowJobs.slice().reverse().map((job) => {
    const review = job.status === 'awaiting_review'
      ? `<span><button data-review-job="${escapeHtml(job.id)}" data-approved="true">Approve</button>
          <button data-review-job="${escapeHtml(job.id)}" data-approved="false" class="danger">Reject</button></span>`
      : `<strong>${escapeHtml(job.status)}</strong>`;
    const details = job.payload?.brief || job.payload?.message || job.payload?.mediaName || '';
    return `<div class="media-row workflow-row"><span><strong>${escapeHtml(job.payload?.title || job.title || job.workflowId)}</strong>
      <br><small>${escapeHtml(job.workflowId)} · ${escapeHtml(job.source || 'local')}</small>
      ${details ? `<br><small>${escapeHtml(details)}</small>` : ''}</span>${review}</div>`;
  }).join('') : '<p>No reviewed creative jobs yet.</p>';
  byId('confirmations').innerHTML = confirmations.length ? confirmations.map((command) =>
    `<div class="media-row workflow-row"><span><strong>${escapeHtml(command.action)}</strong>
      <br><small>${escapeHtml(command.source)} · expires ${escapeHtml(command.expiresAt)}</small>
      <br><small>${escapeHtml(JSON.stringify(command.payload || {}))}</small></span>
      <span><button data-confirm-command="${escapeHtml(command.id)}" data-approved="true">Approve</button>
      <button data-confirm-command="${escapeHtml(command.id)}" data-approved="false" class="danger">Reject</button></span></div>`
  ).join('') : '<p>No cloud commands are waiting for local approval.</p>';
}

async function load() {
  state = await window.companion.getState();
  const config = state.config;
  renderStatus(state.status);
  byId('update-status').textContent = state.update?.message || `Companion ${state.update?.currentVersion || ''}`.trim();
  byId('diagnostics-status').textContent = state.diagnostics?.latest?.capturedAt
    ? `Latest production snapshot: ${state.diagnostics.latest.capturedAt} (${state.diagnostics.latest.logCount} log entries).`
    : 'Companion logs are ready. The first production snapshot will appear after the secure relay connects.';
  byId('overlay-source-status').textContent = config.windows.overlay.url
    ? 'Canonical Personal overlay connected to this Companion tenant.'
    : 'Use the tenant-linked SPMT download flow to connect the Personal overlay.';
  byId('overlay-social-url').value = config.windows.overlay.socialUrl || 'https://streamweaver-new.fly.dev/overlay/social';
  byId('overlay-social-enabled').checked = config.windows.overlay.socialEnabled !== false;
  byId('overlay-click-through').checked = config.windows.overlay.clickThrough !== false;
  byId('overlay-always-on-top').checked = config.windows.overlay.alwaysOnTop !== false;
  byId('overlay-fit-display').checked = config.windows.overlay.fitToDisplay !== false;
  byId('overlay-hotkey').value = config.windows.overlay.interactionHotkey || 'CommandOrControl+Shift+O';
  byId('popouts').innerHTML = config.windows.popouts.map(popoutCard).join('');
  byId('obs-url').value = config.obs.url;
  byId('obs-enabled').checked = config.obs.enabled;
  byId('obs-media-input').value = config.obs.mediaInputName || 'SpaceMountain Jingles';
  byId('audio-volume').value = config.audio.volume;
  byId('audio-muted').checked = config.audio.muted;
  byId('audio-output-device').value = config.audio.outputDeviceId || '';
  byId('relay-url').value = config.relay.url;
  byId('relay-device-id').value = config.relay.deviceId;
  byId('relay-enabled').checked = config.relay.enabled;
  byId('open-at-login').checked = config.startup.openAtLogin;
  byId('start-minimized').checked = config.startup.startMinimized;
  byId('library-path').textContent = config.media.libraryPath || 'Using Companion-managed media folder';
  byId('local-relay-enabled').checked = config.media.localRelayEnabled === true;
  byId('downloads-enabled').checked = config.media.downloadsEnabled === true;
  byId('cache-budget-gb').value = Math.max(0.5, Number(config.media.cacheBudgetBytes || 0) / 1024 / 1024 / 1024).toFixed(1);
  byId('transcode-engine').value = config.media.transcodeEngine || 'auto';
  media = state.media || [];
  jobs = state.jobs || [];
  mediaCache = state.mediaCache || null;
  hardware = state.hardware || null;
  byId('media-cache-status').textContent = mediaCache
    ? `Download cache: ${Math.round(Number(mediaCache.bytes || 0) / 1024 / 1024)} MB / ${Math.round(Number(mediaCache.budgetBytes || 0) / 1024 / 1024)} MB · ${mediaCache.entries?.length || 0} files`
    : 'Download cache is unavailable.';
  byId('hardware-status').textContent = hardware
    ? `${hardware.cpu} · ${hardware.logicalCores} threads · encoder ${hardware.selectedEngine} · NVENC ${hardware.encoders?.nvidia ? 'yes' : 'no'} · QSV ${hardware.encoders?.intel ? 'yes' : 'no'} · AMF ${hardware.encoders?.amd ? 'yes' : 'no'}`
    : 'Hardware detection unavailable.';
  workflowJobs = state.workflowJobs || [];
  confirmations = state.confirmations || [];
  renderMedia();
  renderWorkflows();
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
  if (target.dataset.playMedia) {
    await window.companion.playObsMedia(target.dataset.playMedia, byId('obs-media-input').value.trim());
  }
  if (target.dataset.cancelJob) {
    await window.companion.cancelMediaJob(target.dataset.cancelJob);
  }
  if (target.dataset.reviewJob) {
    await window.companion.reviewWorkflow(target.dataset.reviewJob, target.dataset.approved === 'true');
    await load();
  }
  if (target.dataset.confirmCommand) {
    await window.companion.resolveConfirmation(target.dataset.confirmCommand, target.dataset.approved === 'true');
    confirmations = confirmations.filter((item) => item.id !== target.dataset.confirmCommand);
    renderWorkflows();
  }
});

byId('save').addEventListener('click', async () => {
  const saveButton = byId('save');
  saveButton.disabled = true;
  saveButton.textContent = 'Saving...';
  byId('message').classList.remove('error');
  byId('message').textContent = '';
  const updates = {
    startup: { openAtLogin: byId('open-at-login').checked, startMinimized: byId('start-minimized').checked },
    relay: {
      url: byId('relay-url').value.trim(),
      deviceId: byId('relay-device-id').value.trim(),
      enabled: byId('relay-enabled').checked
    },
    obs: {
      url: byId('obs-url').value.trim(),
      enabled: byId('obs-enabled').checked,
      mediaInputName: byId('obs-media-input').value.trim(),
    },
    audio: {
      volume: Number(byId('audio-volume').value),
      muted: byId('audio-muted').checked,
      outputDeviceId: byId('audio-output-device').value.trim(),
    },
    media: {
      ...state.config.media,
      localRelayEnabled: byId('local-relay-enabled').checked,
      downloadsEnabled: byId('downloads-enabled').checked,
      cacheBudgetBytes: Math.round(Number(byId('cache-budget-gb').value || 20) * 1024 * 1024 * 1024),
      transcodeEngine: byId('transcode-engine').value,
    },
    windows: {
      overlay: {
        ...state.config.windows.overlay,
        socialUrl: byId('overlay-social-url').value.trim(),
        socialEnabled: byId('overlay-social-enabled').checked,
        clickThrough: byId('overlay-click-through').checked,
        alwaysOnTop: byId('overlay-always-on-top').checked,
        fitToDisplay: byId('overlay-fit-display').checked,
        interactionHotkey: byId('overlay-hotkey').value.trim()
      },
      popouts: collectPopouts()
    }
  };
  try {
    await window.companion.saveConfig(updates);
    const secrets = {};
    if (byId('obs-password').value) secrets.obsPassword = byId('obs-password').value;
    if (byId('relay-token').value) secrets.relayToken = byId('relay-token').value;
    if (Object.keys(secrets).length) await window.companion.saveSecrets(secrets);
    byId('obs-password').value = '';
    byId('relay-token').value = '';
    byId('message').textContent = 'Settings saved';
    setTimeout(() => { byId('message').textContent = ''; }, 2400);
    await load();
  } catch (error) {
    byId('message').classList.add('error');
    byId('message').textContent = `Save failed: ${error?.message || 'unknown error'}`;
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = 'Save companion settings';
  }
});

byId('import-media').addEventListener('click', async () => {
  const imported = await window.companion.importMedia();
  if (imported) await load();
});
byId('download-media').addEventListener('click', async () => {
  const url = byId('download-url').value.trim();
  if (!url) return;
  try {
    const job = await window.companion.downloadMedia({ url, fileName: byId('download-name').value.trim() });
    jobs.push(job);
    renderMedia();
  } catch (error) {
    byId('message').classList.add('error');
    byId('message').textContent = `Download failed: ${error?.message || 'unknown error'}`;
  }
});
byId('prune-media-cache').addEventListener('click', async () => {
  await window.companion.pruneMediaCache();
  await load();
});
byId('choose-library').addEventListener('click', async () => {
  const selected = await window.companion.chooseLibrary();
  if (selected) await load();
});
byId('obs-set-scene').addEventListener('click', async () => {
  const sceneName = byId('obs-scenes').value;
  if (sceneName) await window.companion.setObsScene(sceneName);
});
byId('test-workflow').addEventListener('click', async () => {
  await window.companion.testWorkflow();
  await load();
});
byId('create-song-job').addEventListener('click', async () => {
  const title = byId('song-title').value.trim();
  const brief = byId('song-brief').value.trim();
  if (!title || !brief) {
    byId('message').textContent = 'Song title and brief are required';
    return;
  }
  await window.companion.createWorkflow('song.render.request', {
    title,
    brief,
    engine: byId('song-engine').value.trim(),
    voice: byId('song-voice').value.trim(),
    genre: byId('song-genre').value.trim(),
    lyrics: byId('song-lyrics').value.trim(),
  });
  byId('song-title').value = '';
  byId('song-brief').value = '';
  byId('song-lyrics').value = '';
  await load();
});
byId('audio-volume').addEventListener('input', () => window.companion.setAudio({ volume: Number(byId('audio-volume').value) }));
byId('audio-muted').addEventListener('change', () => window.companion.setAudio({ muted: byId('audio-muted').checked }));
byId('open-spacemountain').addEventListener('click', () => window.companion.windowAction('spacemountain.show'));
byId('open-streamweaver').addEventListener('click', () => window.companion.windowAction('workspace.show'));
byId('open-spmt-workspace').addEventListener('click', () => window.companion.windowAction('spmt.worktray'));
byId('open-spmt-settings').addEventListener('click', () => window.companion.windowAction('spmt.settings'));
byId('open-spmt-overlays').addEventListener('click', () => window.companion.windowAction('spmt.overlays'));
byId('check-updates').addEventListener('click', () => window.companion.checkForUpdates());
byId('open-diagnostics').addEventListener('click', () => window.companion.openDiagnostics());
window.companion.onStatus(renderStatus);
window.companion.onMediaJob((job) => {
  const index = jobs.findIndex((item) => item.id === job.id);
  if (index >= 0) jobs[index] = job;
  else jobs.push(job);
  renderMedia();
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') void load();
});
window.companion.onWorkflowJob((job) => {
  const index = workflowJobs.findIndex((item) => item.id === job.id);
  if (index >= 0) workflowJobs[index] = job;
  else workflowJobs.push(job);
  renderWorkflows();
});
window.companion.onConfirmation((command) => {
  const index = confirmations.findIndex((item) => item.id === command.id);
  if (index >= 0) confirmations[index] = command;
  else confirmations.push(command);
  renderWorkflows();
});
window.companion.onUpdate((update) => {
  byId('update-status').textContent = update.message || `Companion ${update.currentVersion || ''}`.trim();
});

const sections = Array.from(document.querySelectorAll('main section[id]'));
const sectionLinks = Array.from(document.querySelectorAll('.app-nav a[href^="#"]'));
const sectionObserver = new IntersectionObserver((entries) => {
  const visible = entries
    .filter((entry) => entry.isIntersecting)
    .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
  if (!visible) return;
  sectionLinks.forEach((link) => link.classList.toggle('active', link.getAttribute('href') === `#${visible.target.id}`));
}, { rootMargin: '-15% 0px -70% 0px', threshold: [0.05, 0.4] });
sections.forEach((section) => sectionObserver.observe(section));

void load();
