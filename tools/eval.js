'use strict';
// Выполняет выражение в странице запущенной Яндекс Музыки (нужен запуск с --remote-debugging-port=9333).
// node tools/eval.js "<js>"  |  node tools/eval.js --shot файл.png
(async () => {
  const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
  const page = targets.find((t) => t.type === 'page' && t.url.startsWith('music-application:'));
  if (!page) throw new Error('страница приложения не найдена');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => ((socket.onopen = resolve), (socket.onerror = reject)));
  let id = 0;
  const call = (method, params) =>
    new Promise((resolve) => {
      const mine = (id += 1);
      const listen = (event) => {
        const message = JSON.parse(event.data);
        if (message.id !== mine) return;
        socket.removeEventListener('message', listen);
        resolve(message.result || message.error);
      };
      socket.addEventListener('message', listen);
      socket.send(JSON.stringify({ id: mine, method, params }));
    });
  if (process.argv[2] === '--shot') {
    const { data } = await call('Page.captureScreenshot', { format: 'png' });
    require('fs').writeFileSync(process.argv[3], Buffer.from(data, 'base64'));
    console.log('saved', process.argv[3]);
  } else {
    const expression = process.argv[2] === '--file' ? require('fs').readFileSync(process.argv[3], 'utf8') : process.argv[2];
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    console.log(JSON.stringify(result.exceptionDetails ? result.exceptionDetails.exception?.description || result.exceptionDetails : result.result.value, null, 1));
  }
  socket.close();
})().catch((error) => (console.error(error.message), process.exit(1)));
