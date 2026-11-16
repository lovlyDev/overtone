'use strict';
// Перехват обмена приложения с API Яндекс Музыки. Здесь треки SoundCloud становятся «родными»:
// приложение получает их в плейлистах и в «Мне нравится», просит у нас адрес файла и ставит лайки,
// а до серверов Яндекса запросы про эти треки не доходят.
//
// Трек SoundCloud живёт под номером BASE + его номер на SoundCloud: у Яндекса таких номеров нет.
const fs = require('fs');
const path = require('path');

const API = 'https://api.music.yandex.net/';
const BASE = 7_000_000_000_000;
const SYNTHETIC = /\b70\d{11}\b/;
const OWNER = { uid: 70, login: 'soundcloud', name: 'SoundCloud', sex: 'unknown', verified: true };
// Приложение открывает только адреса плейлистов в виде UUID, поэтому страница поиска выглядит так.
const UUID_HEAD = '50c10ad0-0000-4000-8000-';
const PLAYLIST = new RegExp(`/playlist/${UUID_HEAD}([0-9a-f]{12})`);
const uuidOf = (key) => `${UUID_HEAD}${key}`;

const toSynthetic = (id) => String(BASE + Number(id));
const toSoundcloud = (id) => String(Number(id) - BASE);
const isSynthetic = (id) => /^70\d{11}$/.test(String(id));
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, '+00:00');

module.exports = function createApi({ dataDir, soundcloud, media, getConfig }) {
  const log = (...parts) => {
    if (!getConfig().debug) return;
    fs.appendFile(path.join(dataDir, 'api.log'), `${new Date().toISOString()} ${parts.join(' ')}\n`, () => {});
  };

  /** Обложка в формате приложения: адрес без схемы, где %% заменяется размером. У SoundCloud размер игнорируется. */
  const coverUri = (track) => (track.cover ? `${track.cover.replace(/^https?:\/\//, '')}?%%` : '');

  function richTrack(track) {
    const id = toSynthetic(track.id);
    const uri = coverUri(track);
    const artist = {
      id: Number(id), name: track.artist || 'SoundCloud', various: false, composer: false, available: true,
      cover: { type: 'from-album-cover', uri, prefix: '' }, genres: [], disclaimers: [],
    };
    return {
      id, realId: id, title: track.title, major: { id: 0, name: '-' },
      r128: { i: -14, tp: 0 }, derivedColors: { average: '#202020', waveText: '#ffffff', miniPlayer: '#303030', accent: '#ff7700' },
      available: true, availableForPremiumUsers: true, availableFullWithoutPermission: false, availableForOptions: ['bookmate'],
      disclaimers: [], storageDir: '', durationMs: track.durationMs, fileSize: 0, previewDurationMs: 30000,
      artists: [artist],
      albums: [{
        id: Number(id), title: track.title, metaType: 'music', type: 'single', coverUri: uri, ogImage: uri, genre: '',
        trackCount: 1, likesCount: 0, recent: false, veryImportant: false, artists: [artist], labels: [],
        available: true, availableForPremiumUsers: true, availableForOptions: ['bookmate'], availableForMobile: true,
        availablePartially: false, bests: [], disclaimers: [], trackPosition: { volume: 1, index: 1 },
      }],
      coverUri: uri, ogImage: uri, lyricsAvailable: false, type: 'music', rememberPosition: false,
      trackSharingFlag: 'COVER_ONLY', lyricsInfo: { hasAvailableSyncLyrics: false, hasAvailableTextLyrics: false }, trackSource: 'OWN',
    };
  }
  const richById = (id) => {
    const track = soundcloud.track(toSoundcloud(id));
    return track ? richTrack(track) : null;
  };

  function searchPlaylist(entry) {
    const tracks = entry.ids.map((id) => soundcloud.track(id)).filter(Boolean);
    const uri = coverUri(tracks.find((track) => track.cover) || {});
    return {
      owner: OWNER, playlistUuid: uuidOf(entry.key), available: true, uid: OWNER.uid, kind: parseInt(entry.key, 16),
      title: `SoundCloud: ${entry.query}`, description: 'Результаты поиска по SoundCloud. Сердечко добавляет трек в «Мне нравится».',
      revision: 1, snapshot: 1, trackCount: tracks.length, visibility: 'public', collective: false,
      created: iso(entry.at), modified: iso(entry.at), isBanner: false, isPremiere: false,
      durationMs: tracks.reduce((sum, track) => sum + track.durationMs, 0),
      cover: { type: 'pic', dir: '', uri, custom: true }, ogImage: uri,
      tracks: tracks.map((track, index) => ({
        originalIndex: index, originalShuffleIndex: index, timestamp: iso(entry.at),
        id: Number(toSynthetic(track.id)), albumId: Number(toSynthetic(track.id)),
      })),
      tags: [], likesCount: 0,
    };
  }

  /** Добавляет отмеченные треки SoundCloud в «Мне нравится», по дате вперемешку с родными. */
  function mergeLiked(playlist) {
    const mine = soundcloud.liked().filter((item) => soundcloud.track(item.id));
    if (!mine.length || !Array.isArray(playlist.tracks)) return playlist;
    const added = mine.map((item) => ({ timestamp: iso(item.at), id: Number(toSynthetic(item.id)), albumId: Number(toSynthetic(item.id)) }));
    const tracks = [...playlist.tracks, ...added]
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .map((item, index) => ({ ...item, originalIndex: index, originalShuffleIndex: index }));
    const extra = mine.reduce((sum, item) => sum + soundcloud.track(item.id).durationMs, 0);
    return { ...playlist, tracks, trackCount: (playlist.trackCount || 0) + mine.length, durationMs: (playlist.durationMs || 0) + extra };
  }

  /** Номера треков из тела запроса в исходном порядке; формат (форма или JSON) не важен. */
  const idsIn = (text) => {
    const value = String(text || '');
    if (value.startsWith('--')) return [...value.matchAll(/name="trackIds"\r\n\r\n(\d+)(?::\d+)?/g)].map((match) => match[1]);
    return [...decodeURIComponent(value).matchAll(/(\d{5,})(?::\d+)?/g)].map((match) => match[1]);
  };

  async function fileInfo(url) {
    const ids = (url.searchParams.get('trackIds') || url.searchParams.get('trackId') || '').split(',').filter(Boolean);
    const infos = await Promise.all(
      ids.map(async (raw) => {
        const id = raw.split(':')[0];
        const source = toSoundcloud(id);
        try {
          if (!isSynthetic(id) || !soundcloud.track(source)) return { trackId: id, error: 'not-found' };
          // Скачивание ждёт медиасервер; запрос адреса не задерживает запуск плеера.
          soundcloud.file(source).catch((error) => log('download failed', id, error.message));
          const address = media.url(source);
          const next = soundcloud.searches().find((entry) => entry.ids.includes(source));
          if (next) soundcloud.prefetch(next.ids.slice(next.ids.indexOf(source) + 1));
          return {
            trackId: id, quality: 'nq', codec: 'aac', bitrate: soundcloud.bitrate(),
            transport: 'raw', gain: false, urls: [address], url: address, realId: id,
          };
        } catch (error) {
          log('file-info failed', id, error.message);
          return { trackId: id, error: 'not-found' };
        }
      }),
    );
    return url.pathname.endsWith('/batch') ? { downloadInfos: infos } : { downloadInfo: infos[0] };
  }

    /** Запрос ещё не ушёл. Возвращает true, если ответили сами. */
    async function routeRequest(params, url, fulfill, postOf) {
      const { method } = params.request;
      if (method === 'OPTIONS') return false;
      const route = url.pathname;
      if (route.startsWith('/get-file-info') && SYNTHETIC.test(url.search)) {
        log('file-info', url.search.slice(0, 80));
        return fulfill(params, await fileInfo(url));
      }
      const playlist = PLAYLIST.exec(route);
      const owned = /^\/users\/70\/playlists\/(\d+)$/.exec(route);
      if (playlist || owned) {
        const entry = soundcloud.searches().find((item) => playlist ? item.key === playlist[1] : parseInt(item.key, 16) === Number(owned[1]));
        log('playlist', playlist?.[1] || owned[1], entry ? 'ok' : 'missing');
        return entry ? fulfill(params, searchPlaylist(entry)) : fulfill(params, { name: 'not-found', message: 'overtone' }, 404);
      }
      const like = /\/likes\/tracks\/(add|[^/]+\/remove)/.exec(route);
      if (like) {
        const id = (like[1] === 'add' ? url.searchParams.get('track-id') || '' : like[1]).split(/[:/]/)[0];
        if (!isSynthetic(id)) return false;
        if (like[1] === 'add') soundcloud.like(toSoundcloud(id));
        else soundcloud.unlike(toSoundcloud(id));
        log('like', like[1], id);
        return fulfill(params, { revision: Math.floor(Date.now() / 1000) });
      }
      if (route === '/tracks' && method === 'POST') {
        const ids = idsIn(await postOf(params));
        // Целиком наши треки отдаём сразу; смешанные списки дополняем на этапе ответа.
        if (ids.length && ids.every(isSynthetic)) return fulfill(params, ids.map(richById).filter(Boolean));
        return false;
      }
      if (SYNTHETIC.test(url.pathname + url.search)) {
        log('blocked', method, route);
        return fulfill(params, { name: 'not-found', message: 'overtone' }, 404);
      }
      if (route === '/plays' && SYNTHETIC.test(await postOf(params))) return fulfill(params, '"ok"');
      return false;
    }


  function attach(contents) {
    const wire = contents.debugger;
    try {
      wire.attach('1.3');
    } catch (error) {
      return console.error('[overtone] debugger', error.message);
    }
    const send = (method, params) => wire.sendCommand(method, params).catch((error) => log(method, 'failed', error.message));
    const headerOf = (request, name) => Object.entries(request.headers).find(([key]) => key.toLowerCase() === name)?.[1];
    // Заголовок Origin в перехваченном запросе не виден, а ответ без точного совпадения страница отвергнет.
    const pageOrigin = () => {
      try {
        const page = new URL(contents.getURL());
        return `${page.protocol}//${page.host}`;
      } catch {
        return '*';
      }
    };
    const fulfill = (params, body, status = 200, baseHeaders) => {
      const headers = baseHeaders
        ? baseHeaders.filter((header) => !/^content-(length|encoding)$/i.test(header.name))
        : [
            { name: 'content-type', value: 'application/json; charset=utf-8' },
            { name: 'access-control-allow-origin', value: headerOf(params.request, 'origin') || pageOrigin() },
            { name: 'access-control-allow-credentials', value: 'true' },
            { name: 'access-control-expose-headers', value: '*' },
            { name: 'vary', value: 'origin' },
          ];
      return send('Fetch.fulfillRequest', {
        requestId: params.requestId,
        responseCode: status,
        responsePhrase: status === 200 ? 'OK' : 'Not Found',
        responseHeaders: headers,
        body: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)).toString('base64'),
      });
    };
    const postOf = async (params) => {
      if (params.request.postData !== undefined) return params.request.postData;
      if (!params.request.hasPostData) return '';
      const data = await wire.sendCommand('Fetch.getRequestPostData', { requestId: params.requestId }).catch(() => null);
      return data ? (data.base64Encoded ? Buffer.from(data.postData, 'base64').toString('utf8') : data.postData) : '';
    };

    /** Ответ сервера получен, но ещё не отдан странице. Возвращает true, если подменили. */
    async function onResponse(params, url) {
      if (params.request.method === 'OPTIONS' || params.responseStatusCode !== 200) return false;
      const route = url.pathname;
      const likedPlaylist = /\/playlist\/lk\./.test(route);
      const tracks = route === '/tracks' && params.request.method === 'POST';
      const summary = route.includes('/collection/playlist-with-likes');
      if (!likedPlaylist && !tracks && !summary) return false;
      if (!soundcloud.liked().length && !tracks) return false;
      const requested = tracks ? idsIn(await postOf(params)) : [];
      if (tracks && !requested.some(isSynthetic)) return false;
      const raw = await wire.sendCommand('Fetch.getResponseBody', { requestId: params.requestId });
      const data = JSON.parse(raw.base64Encoded ? Buffer.from(raw.body, 'base64').toString('utf8') : raw.body);
      let next = data;
      if (likedPlaylist) next = mergeLiked(data);
      else if (summary && data.summary) next = { ...data, summary: { ...data.summary, count: data.summary.count + soundcloud.liked().length } };
      else if (tracks && Array.isArray(data)) {
        const byId = new Map(data.map((track) => [String(track.id), track]));
        next = requested.map((id) => byId.get(id) || (isSynthetic(id) ? richById(id) : null)).filter(Boolean);
      }
      log('merged', route);
      return fulfill(params, next, 200, params.responseHeaders);
    }

    wire.on('message', async (_event, method, params) => {
      if (method !== 'Fetch.requestPaused') return;
      const response = params.responseStatusCode !== undefined || params.responseErrorReason !== undefined;
      try {
        const url = new URL(params.request.url);
        if (await (response ? onResponse(params, url) : routeRequest(params, url, fulfill, postOf))) return;
      } catch (error) {
        log('handler', error.message);
      }
      send(response ? 'Fetch.continueResponse' : 'Fetch.continueRequest', { requestId: params.requestId });
    });
    wire.on('detach', (_event, reason) => log('detached', reason));
    send('Fetch.enable', {
      patterns: [
        { urlPattern: `${API}*`, requestStage: 'Request' },
      ],
    });
  }

  // Тот же маршрутизатор доступен странице без CDP: Electron отдаёт искусственные CDP-ответы со статусом 0.
  async function resolve(request) {
    const url = new URL(request.url);
    if (url.origin !== new URL(API).origin) return null;
    if (request.response !== undefined) {
      const data = request.response;
      if (url.pathname === '/collection/sync' && data.values?.likedTracks?.values) {
        const tracks = data.values.likedTracks;
        const mine = soundcloud.liked().filter((item) => soundcloud.track(item.id));
        const local = mine.reduce((hash, item) => (hash * 31 + item.at) % 999983, 0);
        const liked = [...tracks.values.liked.filter((item) => !isSynthetic(item.trackId)), ...mine.map((item) => ({ trackId: toSynthetic(item.id), timestamp: iso(item.at) }))];
        const revision = tracks.info.revision + (mine.length ? (local + 1) / 1000000 : 0);
        return { body: { ...data, values: { ...data.values, likedTracks: { ...tracks, info: { ...tracks.info, revision }, values: { ...tracks.values, liked } } } }, status: 200 };
      }
      if (/\/playlist\/lk\./.test(url.pathname)) return { body: mergeLiked(data), status: 200 };
      if (url.pathname.includes('/collection/playlist-with-likes') && data.summary) {
        return { body: { ...data, summary: { ...data.summary, count: data.summary.count + soundcloud.liked().length } }, status: 200 };
      }
      if (url.pathname === '/tracks' && Array.isArray(data)) {
        const byId = new Map(data.map((track) => [String(track.id), track]));
        return { body: idsIn(request.body).map((id) => isSynthetic(id) ? richById(id) : byId.get(id)).filter(Boolean), status: 200 };
      }
      return null;
    }
    if (url.pathname === '/tracks') {
      const ids = idsIn(request.body);
      if (ids.some(isSynthetic) && !ids.every(isSynthetic)) {
        return { nativeIds: ids.filter((id) => !isSynthetic(id)) };
      }
    }
    const params = { request: { method: request.method || 'GET', postData: request.body || '' } };
    const reply = (_params, body, status = 200) => ({ body, status });
    return (await routeRequest(params, url, reply, async () => params.request.postData)) || null;
  }

  return { attach, resolve, isSynthetic, uuidOf };
};
