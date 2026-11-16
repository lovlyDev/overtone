'use strict';
// Всё, что живёт вне страницы: блокировка рекламы и метрики, глобальные клавиши, пауза при блокировке экрана.
const { app, session, globalShortcut, powerMonitor } = require('electron');

/** Метрика, вебвизор, реклама и чужие пиксели. Статистика прослушиваний и рекомендации не трогаются. */
const BLOCKED = [
  '*://mc.yandex.ru/*',
  '*://mc.yandex.com/*',
  '*://mc.webvisor.org/*',
  '*://mc.webvisor.com/*',
  '*://an.yandex.ru/*',
  '*://yandex.ru/ads/*',
  '*://yandex.ru/an/*',
  '*://yandex.ru/clck/*',
  '*://*.adfox.ru/*',
  '*://awaps.yandex.net/*',
  '*://yastatic.net/partner-code*',
  '*://yastatic-net.ru/s3/music-frontend-static/tag-sandbox/*',
  '*://*.googletagmanager.com/*',
  '*://*.google-analytics.com/*',
  '*://connect.facebook.net/*',
];

/** Клавиши по умолчанию; формат — как у Electron accelerator. */
const HOTKEYS = {
  playPause: 'CommandOrControl+Alt+P',
  next: 'CommandOrControl+Alt+Right',
  previous: 'CommandOrControl+Alt+Left',
  like: 'CommandOrControl+Alt+L',
  volumeUp: 'CommandOrControl+Alt+Up',
  volumeDown: 'CommandOrControl+Alt+Down',
};

module.exports = function createSystem({ getConfig, windows, broadcast }) {
  let playing = false;
  let failed = [];

  /** Своя команда плееру через тот же канал, которым пользуется само приложение (кнопки в трее и т. п.). */
  function playerAction(action) {
    for (const win of windows) {
      if (!win.isDestroyed()) win.webContents.send('desktop:player:action', action);
    }
  }

  function run(name) {
    if (name === 'playPause') return playerAction(playing ? 'PAUSE' : 'PLAY');
    if (name === 'next') return playerAction('MOVE_FORWARD');
    if (name === 'previous') return playerAction('MOVE_BACKWARD');
    // Остальное умеет только страница: лайк и громкость меняются через её элементы.
    broadcast('overtone:command', name);
  }

  function registerHotkeys() {
    globalShortcut.unregisterAll();
    failed = [];
    const config = getConfig();
    if (!config.hotkeysEnabled) return failed;
    const keys = { ...HOTKEYS, ...(config.hotkeys || {}) };
    for (const [name, accelerator] of Object.entries(keys)) {
      if (!accelerator) continue;
      let ok = false;
      try {
        ok = globalShortcut.register(accelerator, () => run(name));
      } catch {}
      // false — сочетание уже занято другой программой.
      if (!ok) failed.push(name);
    }
    return failed;
  }

  app.whenReady().then(() => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: BLOCKED }, (_details, callback) => callback({ cancel: Boolean(getConfig().blockAds) }));
    registerHotkeys();
    powerMonitor.on('lock-screen', () => {
      if (getConfig().pauseOnLock && playing) playerAction('PAUSE');
    });
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());

  return {
    HOTKEYS,
    registerHotkeys,
    failedHotkeys: () => failed,
    setPlaying: (value) => (playing = Boolean(value)),
    playerAction,
  };
};
