'use strict';
// Собирает ошибки консоли страницы за N секунд. node tools/console.js <секунд> ["js для запуска"]
(async () => {
  const [seconds = '6', script] = process.argv.slice(2);
  const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
  const page = targets.find((t) => t.type === 'page' && t.url.startsWith('music-application:'));
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => ((socket.onopen = resolve), (socket.onerror = reject)));
  let id = 0;
  const send = (method, params = {}) => socket.send(JSON.stringify({ id: (id += 1), method, params }));
  const text = (arg) => arg.value ?? arg.description ?? arg.preview?.properties?.map((p) => `${p.name}:${p.value}`).join(', ') ?? arg.type;
  socket.addEventListener('message', (event) => {
    const { method, params } = JSON.parse(event.data);
    if (method === 'Runtime.exceptionThrown') console.log('EXCEPTION', params.exceptionDetails.exception?.description?.slice(0, 600) || params.exceptionDetails.text);
    if (method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(params.type)) console.log(params.type.toUpperCase(), params.args.map(text).join(' ').slice(0, 700));
    if (method === 'Log.entryAdded' && params.entry.level === 'error') console.log('LOG', params.entry.text.slice(0, 300), params.entry.url || '');
  });
  send('Runtime.enable');
  send('Log.enable');
  if (script) send('Runtime.evaluate', { expression: script, awaitPromise: true });
  await new Promise((resolve) => setTimeout(resolve, Number(seconds) * 1000));
  socket.close();
})().catch((error) => (console.error(error.message), process.exit(1)));
