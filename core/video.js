'use strict';
// Видео трека: сначала родное фоновое видео Яндекс Музыки, потом клип с YouTube через yt-dlp.
// Всё складывается в кеш на диске, странице отдаются байты.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { net } = require('electron');

const MIME = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska' };
const YT_TIMEOUT_MS = 150_000;
/** Сколько не повторять поиск для трека, у которого видео не нашлось. */
const MISS_TTL_MS = 3 * 24 * 3600 * 1000;
/** Пауза после сетевой ошибки YouTube. Смена настроек её сбрасывает. */
const RETRY_MS = 2 * 60 * 1000;

module.exports = function createVideo({ dataDir, getConfig, onChange = () => {} }) {
  const cacheDir = path.join(dataDir, 'cache', 'video');
  const indexFile = path.join(cacheDir, 'index.json');
  const pending = new Map();
  let lastError = '';
  let retryAfter = 0;
  let index = {};
  try {
    index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  } catch {}

  const saveIndex = () => {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(indexFile, JSON.stringify(index));
  };
  const keyOf = (track) =>
    track.id ? `t${String(track.id).replace(/[^\w-]/g, '_')}` : `h${crypto.createHash('sha1').update(`${track.artist}|${track.title}`).digest('hex').slice(0, 16)}`;

  function ytdlpPath() {
    const local = path.join(dataDir, 'bin', 'yt-dlp.exe');
    return fs.existsSync(local) ? local : null;
  }

  async function download(url, file) {
    const response = await net.fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }

  async function fromYandex(track, key) {
    // Номера с 70… на 13 знаков — это треки SoundCloud (см. core/api.js), у Яндекса про них спрашивать нечего.
    if (!/^\d+$/.test(String(track.id || '')) || /^70\d{11}$/.test(String(track.id))) return null;
    const response = await net.fetch(`https://api.music.yandex.net/tracks/${track.id}`);
    if (!response.ok) return null;
    const uri = (await response.json())?.result?.[0]?.backgroundVideoUri;
    if (!uri) return null;
    const file = path.join(cacheDir, `${key}.ym.mp4`);
    await download(uri, file);
    return { file, kind: 'ym' };
  }

  function fromYoutube(track, key) {
    const exe = ytdlpPath();
    if (!exe || !track.title) return Promise.resolve(null);
    const config = getConfig();
    const height = Number(config.videoHeight) || 1080;
    const seconds = Math.round((track.durationMs || 0) / 1000);
    const args = [
      `ytsearch5:${[track.artist, track.title, 'official video'].filter(Boolean).join(' ')}`,
      '--no-playlist',
      '--max-downloads', '1',
      '-f', `bv*[height<=${height}][vcodec^=avc1]/bv*[height<=${height}]/b[height<=${height}]`,
      '-o', path.join(cacheDir, `${key}.yt.%(ext)s`),
      '--no-part', '--no-simulate', '--quiet', '--no-warnings',
      '--print', 'after_move:filepath',
    ];
    // Отсекаем часовые миксы и короткие тизеры; клип обычно чуть длиннее трека.
    if (seconds) args.push('--match-filter', `duration>=${Math.max(seconds - 20, 30)} & duration<=${seconds + 150}`);
    if (config.proxy) args.push('--proxy', config.proxy);
    return new Promise((resolve, reject) => {
      const child = spawn(exe, args, { windowsHide: true });
      let out = '';
      let problems = '';
      const timer = setTimeout(() => child.kill(), YT_TIMEOUT_MS);
      child.stdout.on('data', (chunk) => (out += chunk));
      child.stderr.on('data', (chunk) => (problems += chunk));
      child.on('error', reject);
      child.on('close', () => {
        clearTimeout(timer);
        const file = out.trim().split(/\r?\n/).pop();
        if (file && fs.existsSync(file)) return resolve({ file, kind: 'yt' });
        // «Не нашлось» и «не достучались» различаем: второе нельзя запоминать как отсутствие клипа.
        const failure = problems.split(/\r?\n/).find((line) => line.startsWith('ERROR'));
        if (failure) reject(new Error(describe(failure)));
        else resolve(null);
      });
    });
  }

  function describe(failure) {
    if (/bytes missing|EOFError|SOCKS|proxy/i.test(failure)) return 'Прокси оборвал соединение. Попробуй ещё раз или проверь прокси.';
    if (/SSL|timed out|Connection|getaddrinfo|Unable to download/i.test(failure)) {
      return getConfig().proxy ? 'YouTube не ответил через прокси.' : 'YouTube недоступен напрямую. Укажи прокси в настройках.';
    }
    return failure.replace(/^ERROR:\s*/, '').slice(0, 200);
  }

  function trim() {
    const limit = (Number(getConfig().videoCacheMb) || 1024) * 1024 * 1024;
    const items = Object.entries(index)
      .filter(([, item]) => item.file)
      .map(([key, item]) => ({ key, ...item, size: fs.existsSync(item.file) ? fs.statSync(item.file).size : 0 }))
      .sort((a, b) => a.at - b.at);
    let total = items.reduce((sum, item) => sum + item.size, 0);
    for (const item of items) {
      if (total <= limit) break;
      fs.rmSync(item.file, { force: true });
      delete index[item.key];
      total -= item.size;
    }
  }

  async function find(track, key) {
    const config = getConfig();
    fs.mkdirSync(cacheDir, { recursive: true });
    let found = null;
    if (config.videoYm) found = await fromYandex(track, key).catch(() => null);
    if (!found && config.videoYoutube) {
      try {
        found = await fromYoutube(track, key);
        lastError = '';
      } catch (error) {
        // Сбой сети: в индекс не пишем, просто не дёргаем YouTube пару минут.
        lastError = error.message;
        retryAfter = Date.now() + RETRY_MS;
        return null;
      }
    }
    index[key] = found ? { ...found, at: Date.now() } : { miss: true, at: Date.now() };
    trim();
    saveIndex();
    if (found) onChange();
    return found;
  }

  function payload(item) {
    return { kind: item.kind, mime: MIME[path.extname(item.file)] || 'video/mp4', bytes: fs.readFileSync(item.file) };
  }

  return {
    async get(track) {
      if (!track || !getConfig().video) return null;
      const key = keyOf(track);
      const known = index[key];
      if (known?.rejected) return null;
      if (known?.file && fs.existsSync(known.file)) {
        known.at = Date.now();
        return payload(known);
      }
      if (known?.miss && Date.now() - known.at < MISS_TTL_MS) return null;
      if (Date.now() < retryAfter) return null;
      if (!pending.has(key)) pending.set(key, find(track, key).finally(() => pending.delete(key)));
      const found = await pending.get(key);
      return found ? payload(found) : null;
    },
    /** «Не тот клип»: удаляем файл и больше для этого трека не ищем. */
    reject(track) {
      const key = keyOf(track);
      if (index[key]?.file) fs.rmSync(index[key].file, { force: true });
      index[key] = { rejected: true, at: Date.now() };
      saveIndex();
      onChange();
    },
    /** Треки Яндекс Музыки с клипом в кеше: номер -> откуда клип ('ym' или 'yt'). */
    known() {
      return Object.fromEntries(
        Object.entries(index)
          .filter(([key, item]) => key.startsWith('t') && item.file && fs.existsSync(item.file))
          .map(([key, item]) => [key.slice(1), item.kind]),
      );
    },
    stats() {
      const files = Object.values(index).filter((item) => item.file && fs.existsSync(item.file));
      return { count: files.length, bytes: files.reduce((sum, item) => sum + fs.statSync(item.file).size, 0), ytdlp: Boolean(ytdlpPath()), error: lastError };
    },
    /** Настройки поменялись (например, прокси): пробуем YouTube снова сразу. */
    retry() {
      retryAfter = 0;
      lastError = '';
    },
    clear() {
      fs.rmSync(cacheDir, { recursive: true, force: true });
      index = {};
      onChange();
    },
  };
};
