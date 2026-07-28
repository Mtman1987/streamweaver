'use strict';

function createUpdateManager({
  updater,
  dialog,
  isPackaged,
  currentVersion,
  getWindow = () => undefined,
  onStatus = () => {},
  log = () => {},
  initialDelayMs = 15_000,
  intervalMs = 6 * 60 * 60 * 1000
}) {
  let timer = null;
  let interval = null;
  let manualCheck = false;
  let status = {
    state: isPackaged ? 'idle' : 'development',
    currentVersion
  };

  function publish(next) {
    status = { ...status, ...next, currentVersion };
    onStatus({ ...status });
  }

  async function notify(options) {
    const window = getWindow();
    return window
      ? dialog.showMessageBox(window, options)
      : dialog.showMessageBox(options);
  }

  async function check({ manual = false } = {}) {
    if (!isPackaged) {
      publish({ state: 'development', message: 'Updates are available in packaged builds.' });
      if (manual) {
        await notify({
          type: 'info',
          title: 'Companion updates',
          message: 'Update checks are only available in an installed Companion build.'
        });
      }
      return null;
    }

    manualCheck = manual;
    publish({ state: 'checking', message: 'Checking for updates…' });
    try {
      return await updater.checkForUpdates();
    } catch (error) {
      publish({ state: 'error', message: error instanceof Error ? error.message : String(error) });
      log('Companion update check failed', error);
      if (manual) {
        await notify({
          type: 'error',
          title: 'Update check failed',
          message: 'Companion could not check for updates.',
          detail: error instanceof Error ? error.message : String(error)
        });
      }
      return null;
    }
  }

  function start() {
    if (!isPackaged) return;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.allowPrerelease = false;
    updater.on('checking-for-update', () => publish({ state: 'checking', message: 'Checking for updates…' }));
    updater.on('update-available', (info) => publish({
      state: 'downloading',
      availableVersion: String(info?.version || ''),
      message: `Downloading Companion ${info?.version || 'update'}…`
    }));
    updater.on('update-not-available', async () => {
      publish({ state: 'current', availableVersion: null, message: 'Companion is up to date.' });
      if (manualCheck) {
        manualCheck = false;
        await notify({
          type: 'info',
          title: 'Companion is up to date',
          message: `You are running SpaceMountain Companion ${currentVersion}.`
        });
      }
    });
    updater.on('download-progress', (progress) => publish({
      state: 'downloading',
      percent: Math.max(0, Math.min(100, Math.round(Number(progress?.percent) || 0))),
      message: `Downloading update… ${Math.max(0, Math.min(100, Math.round(Number(progress?.percent) || 0)))}%`
    }));
    updater.on('error', (error) => {
      publish({ state: 'error', message: error instanceof Error ? error.message : String(error) });
      log('Companion updater error', error);
    });
    updater.on('update-downloaded', async (info) => {
      publish({
        state: 'ready',
        availableVersion: String(info?.version || ''),
        percent: 100,
        message: `Companion ${info?.version || 'update'} is ready to install.`
      });
      const result = await notify({
        type: 'info',
        title: 'Companion update ready',
        message: `SpaceMountain Companion ${info?.version || 'update'} is ready.`,
        detail: 'Restart now to install the signed update, or install it automatically when Companion exits.',
        buttons: ['Restart and install', 'Later'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      });
      if (result.response === 0) updater.quitAndInstall(false, true);
    });

    timer = setTimeout(() => void check(), initialDelayMs);
    interval = setInterval(() => void check(), intervalMs);
    timer.unref?.();
    interval.unref?.();
  }

  function stop() {
    if (timer) clearTimeout(timer);
    if (interval) clearInterval(interval);
    timer = null;
    interval = null;
  }

  return {
    check,
    start,
    stop,
    snapshot: () => ({ ...status })
  };
}

module.exports = { createUpdateManager };
