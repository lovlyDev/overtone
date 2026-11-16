'use strict';
// Главный процесс Overtone. Запускается до кода приложения.
const fs = require('fs');
const path = require('path');
const { app, session, ipcMain, BrowserWindow } = require('electron');
const createVideo = require('./video');
const createSoundcloud = require('./soundcloud');
const createMedia = require('./media');
const createApi = require('./api');

const DEFAULTS = {
  theme: 'default', // default | amoled | glass | contrast | mica | acrylic
  video: true,
  videoYm: true, // фоновое видео самой Яндекс Музыки, если оно есть у трека
  videoYoutube: true, // клип с YouTube, если своего видео нет
  videoDelay: 7, // секунд до появления клипа
  videoHeight: 1080, // 480 | 720 | 1080 | 1440 | 2160
  videoCacheMb: 1024,
  proxy: '', // например socks5://127.0.0.1:1080, только для YouTube
  scQuality: 'high', // high = AAC 160 kbps, low = AAC 96 kbps
  scProxy: false, // пускать SoundCloud через тот же прокси
};
const MATERIALS = { mica: 'mica', acrylic: 'acrylic' };
/** Страницы приложения идут по своей схеме; всё остальное (паспорт, devtools, окна других модов) не трогаем. */
const FOREIGN = /^(https?|file|devtools|about|chrome|chrome-extension|data|blob):/;

module.exports = function start({ dataDir, root }) {
  const configFile = path.join(dataDir, 'config.json');
  let config = { ...DEFAULTS };
  try {
    config = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(configFile, 'utf8')) };
  } catch {}
  const soundcloud = createSoundcloud({ dataDir, getConfig: () => config, onUnavailable: (failure) => broadcast('overtone:sc-unavailable', failure) });
  const media = createMedia({ soundcloud });
  const api = createApi({ dataDir, soundcloud, media, getConfig: () => config });
  const windows = new Set();
  const broadcast = (channel, data) => {
    for (const win of windows) if (!win.isDestroyed()) win.webContents.send(channel, data);
  };
  const video = createVideo({ dataDir, getConfig: () => config, onChange: () => broadcast('overtone:video-known', video.known()) });

  const pageDir = path.join(root, 'page');
  const readPage = () => {
    const names = fs.readdirSync(pageDir).sort();
    return {
      css: names.filter((n) => n.endsWith('.css')).map((n) => fs.readFileSync(path.join(pageDir, n), 'utf8')).join('\n'),
      // Каждый модуль выполняется отдельно: у ошибки будет своё имя файла, и она не остановит остальные.
      scripts: names
        .filter((n) => n.endsWith('.js'))
        .map((n) => ({ name: n, code: `${fs.readFileSync(path.join(pageDir, n), 'utf8')}\n//# sourceURL=overtone/${n}` })),
    };
  };

  function applyMaterial(win) {
    if (win.isDestroyed() || typeof win.setBackgroundMaterial !== 'function') return;
    const material = MATERIALS[config.theme];
    try {
      if (!win.__overtonePaint) {
        // Приложение перекрашивает окно при смене своей темы; с прозрачным материалом это ломает эффект.
        win.__overtonePaint = win.setBackgroundColor.bind(win);
        win.setBackgroundColor = (color) => win.__overtonePaint(MATERIALS[config.theme] ? '#00000000' : color);
      }
      if (material) win.__overtonePaint('#00000000');
      win.setBackgroundMaterial(material || 'none');
    } catch (error) {
      console.error('[overtone] material', error);
    }
  }

  function attach(win) {
    const contents = win.webContents;
    api.attach(contents);
    contents.on('dom-ready', () => {
      if (FOREIGN.test(contents.getURL())) return;
      windows.add(win);
      applyMaterial(win);
      try {
        const { css, scripts } = readPage();
        contents.insertCSS(css);
        scripts.reduce(
          (queue, { name, code }) =>
            queue.then(() => contents.executeJavaScript(code).catch((error) => console.error(`[overtone] ${name}`, error))),
          Promise.resolve(),
        );
      } catch (error) {
        console.error('[overtone] inject', error);
      }
    });
    win.on('closed', () => windows.delete(win));
  }

  ipcMain.on('overtone:config', (event) => {
    event.returnValue = config;
  });
  ipcMain.handle('overtone:set', (_event, patch) => {
    config = { ...config, ...patch };
    video.retry();
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
    for (const win of windows) {
      if (win.isDestroyed()) continue;
      if ('theme' in patch) applyMaterial(win);
      win.webContents.send('overtone:config', config);
    }
    return config;
  });
  ipcMain.handle('overtone:video', (_event, track) => video.get(track));
  ipcMain.handle('overtone:video-reject', (_event, track) => video.reject(track));
  // Поиск возвращает ключ страницы: приложение откроет её как обычный плейлист, а данные подставит core/api.js.
  ipcMain.handle('overtone:sc-search', async (_event, query) => api.uuidOf((await soundcloud.search(query)).key));
  ipcMain.handle('overtone:sc-recent', () => soundcloud.searches().map((item) => ({ uuid: api.uuidOf(item.key), query: item.query })));
  ipcMain.handle('overtone:api', (_event, request) => api.resolve(request));
  ipcMain.handle('overtone:video-stats', () => video.stats());
  ipcMain.handle('overtone:video-known', () => video.known());
  ipcMain.handle('overtone:video-clear', () => video.clear());

  app.whenReady().then(() => {
    const preload = { type: 'frame', id: 'overtone', filePath: path.join(root, 'core', 'preload.js') };
    try {
      session.defaultSession.registerPreloadScript(preload);
    } catch (error) {
      console.error('[overtone] preload', error);
    }
  });
  app.on('browser-window-created', (_event, win) => attach(win));
  BrowserWindow.getAllWindows().forEach(attach);
};
