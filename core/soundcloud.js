'use strict';
// SoundCloud через yt-dlp. Здесь только данные: поиск, реестр треков, лайки, файлы в кеше.
// Как эти треки попадают в интерфейс приложения, решает core/api.js.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const FORMATS = { high: 'hls_aac_160k/hls_aac_96k', low: 'hls_aac_96k/hls_aac_160k' };
const BITRATE = { high: 160, low: 96 };
const CACHE_LIMIT = 2 * 1024 * 1024 * 1024;
const SEARCH_TTL_MS = 15 * 60 * 1000;
const KEEP_TRACKS = 3000;
const KEEP_SEARCHES = 30;
const PREFETCH = 3;

module.exports = function createSoundcloud({ dataDir, getConfig, onUnavailable = () => {} }) {
  const cacheDir = path.join(dataDir, 'cache', 'audio');
  const stateFile = path.join(dataDir, 'soundcloud.json');
  const downloads = new Map();
  const failures = new Map();
  const unavailable = (id) => {
    const failure = failures.get(String(id));
    if (failure && Date.now() - failure.at < 60_000) return failure;
    failures.delete(String(id));
    return null;
  };
  const waiting = [];
  let active = 0;
  async function download(task) {
    if (active >= 2) await new Promise((resolve) => waiting.push(resolve));
    else active += 1;
    try {
      return await task();
    } finally {
      if (waiting.length) waiting.shift()();
      else active -= 1;
    }
  }
  let state = { tracks: {}, liked: [], searches: [] };
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    // Первая версия хранила просто список отмеченных треков.
    if (Array.isArray(saved)) {
      for (const track of saved) {
        state.tracks[track.id] = track;
        state.liked.push({ id: track.id, at: track.addedAt || Date.now() });
      }
    } else {
      state = { ...state, ...saved };
    }
    // Ключ поиска — 12 шестнадцатеричных знаков: из него собирается адрес страницы (см. core/api.js).
    state.searches = state.searches.filter((item) => /^[0-9a-f]{12}$/.test(item.key));
  } catch {}

  let saveTimer;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      // В реестре остаются отмеченные треки и самые свежие из поиска.
      const keep = new Set([...state.liked.map((item) => item.id), ...state.searches.flatMap((item) => item.ids)]);
      const ids = Object.keys(state.tracks);
      for (const id of ids.slice(0, Math.max(0, ids.length - KEEP_TRACKS))) if (!keep.has(id)) delete state.tracks[id];
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify(state));
    }, 300);
  };

  const exe = () => {
    const file = path.join(dataDir, 'bin', 'yt-dlp.exe');
    return fs.existsSync(file) ? file : null;
  };

  function run(args, timeout) {
    const program = exe();
    if (!program) return Promise.reject(new Error('yt-dlp не установлен'));
    const config = getConfig();
    if (config.scProxy && config.proxy) args.push('--proxy', config.proxy);
    return new Promise((resolve, reject) => {
      const child = spawn(program, [...args, '--no-warnings'], { windowsHide: true });
      let out = '';
      let problems = '';
      let expired = false;
      const timer = setTimeout(() => { expired = true; child.kill(); }, timeout);
      child.stdout.on('data', (chunk) => (out += chunk));
      child.stderr.on('data', (chunk) => (problems += chunk));
      child.on('error', () => { clearTimeout(timer); reject(new Error('Не удалось запустить yt-dlp')); });
      child.on('close', (code) => {
        clearTimeout(timer);
        const failure = problems.split(/\r?\n/).find((line) => line.startsWith('ERROR'));
        if (expired) reject(new Error('SoundCloud не ответил вовремя'));
        else if (code !== 0 && (failure || !out.trim())) reject(new Error(/private|not available|unavailable|deleted|go\+|subscription|geo.?restrict/i.test(problems) ? 'Трек недоступен в SoundCloud' : 'Не удалось загрузить из SoundCloud. Проверьте соединение'));
        else resolve(out);
      });
    });
  }

  function cover(thumbnails = []) {
    const pick = thumbnails.find((item) => item.id === 't500x500') || thumbnails.find((item) => item.id === 't300x300') || thumbnails.at(-1);
    return pick?.url || '';
  }

  const quality = () => (FORMATS[getConfig().scQuality] ? getConfig().scQuality : 'high');
  const baseName = (id, level) => `sc${String(id).replace(/\W/g, '')}.${level}`;
  function cached(id, level = quality()) {
    if (!fs.existsSync(cacheDir)) return null;
    const name = fs.readdirSync(cacheDir).find((item) => item === `${baseName(id, level)}.m4a`);
    return name && fs.statSync(path.join(cacheDir, name)).size > 0 ? path.join(cacheDir, name) : null;
  }

  function trim() {
    const files = fs
      .readdirSync(cacheDir)
      .map((name) => ({ file: path.join(cacheDir, name), stat: fs.statSync(path.join(cacheDir, name)) }))
      .sort((a, b) => a.stat.atimeMs - b.stat.atimeMs);
    let total = files.reduce((sum, item) => sum + item.stat.size, 0);
    for (const item of files) {
      if (total <= CACHE_LIMIT) break;
      fs.rmSync(item.file, { force: true });
      total -= item.stat.size;
    }
  }

  /** Путь к файлу трека; качает, если его ещё нет. Параллельные просьбы об одном треке ждут одну загрузку. */
  function file(id) {
    const level = quality();
    const ready = cached(id, level);
    if (ready) return Promise.resolve(ready);
    const failure = unavailable(id);
    if (failure) return Promise.reject(new Error(failure.message));
    const key = `${id}.${level}`;
    if (!downloads.has(key)) {
      const track = state.tracks[id];
      const job = download(async () => {
        if (!track) throw new Error('трек не найден в реестре');
        fs.mkdirSync(cacheDir, { recursive: true });
        const out = await run(
          [track.url, '-f', FORMATS[level], '-o', path.join(cacheDir, `${baseName(id, level)}.%(ext)s`), '--no-playlist', '--quiet', '--no-simulate', '--print', 'after_move:filepath'],
          25_000,
        );
        const result = out.trim().split(/\r?\n/).pop();
        if (!result || path.extname(result) !== '.m4a' || !fs.existsSync(result) || !fs.statSync(result).size) throw new Error('SoundCloud не отдал доступный AAC-трек');
        trim();
        return result;
      });
      downloads.set(key, job.catch((error) => {
        const failure = { id: String(id), message: error.message, at: Date.now() };
        failures.set(String(id), failure);
        onUnavailable(failure);
        throw error;
      }).finally(() => downloads.delete(key)));
    }
    return downloads.get(key);
  }

  /** Заранее качает несколько треков по очереди, чтобы первый запуск был мгновенным. */
  async function prefetch(ids) {
    for (const id of ids.slice(0, PREFETCH)) await file(id).catch(() => {});
  }

  async function search(query) {
    const text = String(query || '').trim();
    if (!text) throw new Error('пустой запрос');
    const known = state.searches.find((item) => item.query.toLowerCase() === text.toLowerCase());
    if (known && Date.now() - known.at < SEARCH_TTL_MS) return known;
    const out = await run([`scsearch30:${text}`, '--flat-playlist', '-j'], 40_000);
    const ids = [];
    for (const line of out.split(/\r?\n/).filter(Boolean)) {
      try {
        const item = JSON.parse(line);
        const id = String(item.id);
        if (!/^\d+$/.test(id) || !(item.webpage_url || item.url)) continue;
        state.tracks[id] = {
          id,
          title: item.title || '',
          artist: item.uploader || '',
          durationMs: Math.round((item.duration || 0) * 1000),
          cover: cover(item.thumbnails),
          url: item.webpage_url || item.url,
        };
        ids.push(id);
      } catch {}
    }
    if (!ids.length) throw new Error('ничего не нашлось');
    const entry = { key: known?.key || Date.now().toString(16).padStart(12, '0').slice(-12), query: text, ids, at: Date.now() };
    state.searches = [entry, ...state.searches.filter((item) => item.key !== entry.key)].slice(0, KEEP_SEARCHES);
    save();
    prefetch(ids);
    return entry;
  }

  return {
    search,
    file,
    prefetch,
    unavailable,
    bitrate: () => BITRATE[quality()],
    track: (id) => state.tracks[id] || null,
    searches: () => state.searches,
    liked: () => state.liked,
    isLiked: (id) => state.liked.some((item) => item.id === id),
    like(id) {
      if (!state.tracks[id] || state.liked.some((item) => item.id === id)) return;
      state.liked.unshift({ id, at: Date.now() });
      save();
    },
    unlike(id) {
      state.liked = state.liked.filter((item) => item.id !== id);
      save();
    },
  };
};
