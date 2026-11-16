'use strict';
// SoundCloud через yt-dlp. Здесь только данные: поиск, реестр треков, лайки, файлы в кеше.
// Как эти треки попадают в интерфейс приложения, решает core/api.js.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const FORMATS = { high: 'hls_aac_160k/bestaudio', low: 'hls_aac_96k/worstaudio' };
const BITRATE = { high: 160, low: 96 };
const CACHE_LIMIT = 2 * 1024 * 1024 * 1024;
const SEARCH_TTL_MS = 15 * 60 * 1000;
const KEEP_TRACKS = 3000;
const KEEP_SEARCHES = 30;
const PREFETCH = 3;

module.exports = function createSoundcloud({ dataDir, getConfig }) {
  const cacheDir = path.join(dataDir, 'cache', 'audio');
  const stateFile = path.join(dataDir, 'soundcloud.json');
  const downloads = new Map();
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
      const timer = setTimeout(() => child.kill(), timeout);
      child.stdout.on('data', (chunk) => (out += chunk));
      child.stderr.on('data', (chunk) => (problems += chunk));
      child.on('error', reject);
      child.on('close', () => {
        clearTimeout(timer);
        const failure = problems.split(/\r?\n/).find((line) => line.startsWith('ERROR'));
        if (!out.trim() && failure) reject(new Error(failure.replace(/^ERROR:\s*/, '').slice(0, 200)));
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
    const name = fs.readdirSync(cacheDir).find((item) => item.startsWith(`${baseName(id, level)}.`));
    return name ? path.join(cacheDir, name) : null;
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
    const key = `${id}.${level}`;
    if (!downloads.has(key)) {
      const track = state.tracks[id];
      const job = (async () => {
        if (!track) throw new Error('трек не найден в реестре');
        fs.mkdirSync(cacheDir, { recursive: true });
        const out = await run(
          [track.url, '-f', FORMATS[level], '-o', path.join(cacheDir, `${baseName(id, level)}.%(ext)s`), '--no-part', '--no-playlist', '--quiet', '--no-simulate', '--print', 'after_move:filepath'],
          120_000,
        );
        const result = out.trim().split(/\r?\n/).pop();
        if (!result || !fs.existsSync(result)) throw new Error('SoundCloud не отдал трек');
        trim();
        return result;
      })();
      downloads.set(key, job.finally(() => downloads.delete(key)));
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
