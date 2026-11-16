'use strict';
// Локальный сервер, с которого родной плеер приложения берёт аудио SoundCloud.
// Слушает только 127.0.0.1, отдаёт только файлы из кеша, умеет Range (перемотка).
const fs = require('fs');
const http = require('http');

module.exports = function createMedia({ soundcloud }) {
  let port = 0;
  const APP = /^music-application:\/\//;

  const server = http.createServer(async (request, response) => {
    const { origin } = request.headers;
    if (origin && !APP.test(origin)) return response.writeHead(403).end();
    const cors = origin
      ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'range', 'access-control-expose-headers': 'content-length, content-range, accept-ranges', vary: 'origin' }
      : {};
    if (request.method === 'OPTIONS') return response.writeHead(204, cors).end();
    const id = /^\/sc\/(\d+)\.m4a/.exec(request.url || '')?.[1];
    if (!id) return response.writeHead(404, cors).end();
    let file;
    try {
      file = await soundcloud.file(id, { urgent: true });
    } catch {
      return response.writeHead(502, cors).end();
    }
    const { size } = fs.statSync(file);
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range || '');
    const head = { ...cors, 'content-type': 'audio/mp4', 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
    if (!range) {
      response.writeHead(200, { ...head, 'content-length': size });
      return request.method === 'HEAD' ? response.end() : fs.createReadStream(file).pipe(response);
    }
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) return response.writeHead(416, { ...cors, 'content-range': `bytes */${size}` }).end();
    response.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    return request.method === 'HEAD' ? response.end() : fs.createReadStream(file, { start, end }).pipe(response);
  });
  server.on('error', (error) => console.error('[overtone] media', error));
  server.listen(0, '127.0.0.1', () => {
    port = server.address().port;
  });

  return { url: (id) => `http://127.0.0.1:${port}/sc/${id}.m4a` };
};
