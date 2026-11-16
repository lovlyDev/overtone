'use strict';
// HTTPS-запросы через SOCKS5 с логином и паролем. Chromium такой прокси не умеет, поэтому свой клиент.
const net = require('net');
const tls = require('tls');
const https = require('https');

function readExact(socket, size) {
  return new Promise((resolve, reject) => {
    const tryRead = () => {
      const chunk = socket.read(size);
      if (chunk) {
        cleanup();
        resolve(chunk);
      }
    };
    const fail = (error) => {
      cleanup();
      reject(error || new Error('прокси закрыл соединение'));
    };
    const cleanup = () => {
      socket.off('readable', tryRead);
      socket.off('error', fail);
      socket.off('close', fail);
    };
    socket.on('readable', tryRead);
    socket.once('error', fail);
    socket.once('close', fail);
    tryRead();
  });
}

/** Открывает TCP-туннель до host:port через прокси вида socks5://user:pass@host:port. */
async function tunnel(proxyUrl, host, port) {
  const proxy = new URL(proxyUrl);
  const socket = net.connect({ host: proxy.hostname, port: Number(proxy.port) || 1080 });
  socket.setTimeout(20_000, () => socket.destroy(new Error('прокси не отвечает')));
  await new Promise((resolve, reject) => socket.once('connect', resolve).once('error', reject));
  const user = decodeURIComponent(proxy.username);
  const pass = decodeURIComponent(proxy.password);
  socket.write(Buffer.from(user ? [5, 2, 0, 2] : [5, 1, 0]));
  const [, method] = await readExact(socket, 2);
  if (method === 2) {
    socket.write(Buffer.concat([Buffer.from([1, user.length]), Buffer.from(user), Buffer.from([pass.length]), Buffer.from(pass)]));
    const [, status] = await readExact(socket, 2);
    if (status !== 0) throw new Error('прокси отклонил логин или пароль');
  } else if (method !== 0) {
    throw new Error('прокси не принял способ входа');
  }
  const name = Buffer.from(host);
  socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, name.length]), name, Buffer.from([port >> 8, port & 255])]));
  const reply = await readExact(socket, 4);
  if (reply[1] !== 0) throw new Error(`прокси не смог соединиться (код ${reply[1]})`);
  const rest = reply[3] === 1 ? 6 : reply[3] === 4 ? 18 : (await readExact(socket, 1))[0] + 2;
  await readExact(socket, rest);
  socket.setTimeout(0);
  return socket;
}

class SocksAgent extends https.Agent {
  constructor(proxyUrl) {
    super({ keepAlive: true, maxSockets: 6 });
    this.proxyUrl = proxyUrl;
  }

  createConnection(options, callback) {
    tunnel(this.proxyUrl, options.host, Number(options.port) || 443)
      .then((socket) => callback(null, tls.connect({ socket, servername: options.servername || options.host })))
      .catch(callback);
  }
}

const agents = new Map();
function agentFor(proxyUrl) {
  if (!proxyUrl) return undefined;
  if (!agents.has(proxyUrl)) agents.set(proxyUrl, new SocksAgent(proxyUrl));
  return agents.get(proxyUrl);
}

/** GET с редиректами. Возвращает { status, headers, body: Buffer }. */
function get(url, { proxy, headers = {}, redirects = 5, timeout = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { agent: agentFor(proxy), headers: { 'accept-encoding': 'identity', ...headers }, timeout }, (response) => {
      const { statusCode, headers: responseHeaders } = response;
      if (statusCode >= 300 && statusCode < 400 && responseHeaders.location && redirects > 0) {
        response.resume();
        return resolve(get(new URL(responseHeaders.location, url).href, { proxy, headers, redirects: redirects - 1, timeout }));
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: statusCode, headers: responseHeaders, body: Buffer.concat(chunks) }));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('таймаут запроса')));
    request.on('error', reject);
  });
}

module.exports = { get };
