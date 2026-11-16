'use strict';
// Единственный файл Overtone внутри app.asar. Грузит мод снаружи и передаёт управление дальше.
// Если мода нет или он упал, приложение запускается как обычно.
try {
  const fs = require('fs');
  const path = require('path');
  const dataDir = path.join(process.env.APPDATA || require('electron').app.getPath('appData'), 'Overtone');
  let root = path.join(dataDir, 'app');
  try {
    const dev = fs.readFileSync(path.join(dataDir, 'dev-path.txt'), 'utf8').trim();
    if (dev && fs.existsSync(dev)) root = dev;
  } catch {}
  const main = path.join(root, 'core', 'main.js');
  if (fs.existsSync(main)) require(main)({ dataDir, root });
} catch (error) {
  console.error('[overtone] boot failed', error);
}
require(__PREVIOUS_MAIN__);
