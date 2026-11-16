'use strict';
// node patcher/cli.js install [--dev] [--app-dir <путь>] | uninstall | status | ytdlp
const fs = require('fs');
const path = require('path');
const asar = require('./asar');

const NAME = 'Overtone';
const BOOT = 'overtone-boot.js';
const PROJECT = path.resolve(__dirname, '..');
const DATA = path.join(process.env.APPDATA, NAME);
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

function locate() {
  const dir = option('--app-dir') || path.join(process.env.LOCALAPPDATA, 'Programs', 'YandexMusic');
  const archive = path.join(dir, 'resources', 'app.asar');
  if (!fs.existsSync(archive)) throw new Error(`Яндекс Музыка не найдена в ${dir}. Укажи папку через --app-dir.`);
  const exe = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.exe') && !/^(uninstall|elevate)/i.test(name))
    .map((name) => path.join(dir, name))
    .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
  if (!exe) throw new Error(`В ${dir} нет исполняемого файла приложения.`);
  return { dir, archive, exe, backup: `${archive}.overtone-bak` };
}

function assertClosed(exe) {
  try {
    fs.closeSync(fs.openSync(exe, 'r+'));
  } catch (error) {
    if (['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) {
      throw new Error('Яндекс Музыка запущена. Закрой её полностью (в том числе из трея) и повтори.');
    }
    throw error;
  }
}

/** Меняет в exe зашитый хеш заголовка архива; длина строки не меняется. */
function swapHash(exe, from, to) {
  if (from === to) return;
  const bytes = fs.readFileSync(exe);
  const at = bytes.indexOf(Buffer.from(from, 'latin1'));
  if (at < 0) throw new Error('В exe не найден хеш текущего app.asar: версия приложения устроена иначе.');
  bytes.write(to, at, 'latin1');
  fs.writeFileSync(exe, bytes);
}

function bootSource(previousMain) {
  return fs
    .readFileSync(path.join(PROJECT, 'core', 'boot.js'), 'utf8')
    .replace('__PREVIOUS_MAIN__', JSON.stringify(`./${previousMain.replace(/^\.\//, '')}`));
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const item of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, item.name);
    const target = path.join(to, item.name);
    if (item.isDirectory()) copyTree(source, target);
    else fs.copyFileSync(source, target);
  }
}

function deploy(dev) {
  fs.mkdirSync(DATA, { recursive: true });
  const devFile = path.join(DATA, 'dev-path.txt');
  if (dev) {
    fs.writeFileSync(devFile, PROJECT);
    return `код грузится прямо из ${PROJECT}`;
  }
  fs.rmSync(devFile, { force: true });
  const target = path.join(DATA, 'app');
  fs.rmSync(target, { recursive: true, force: true });
  ['core', 'page'].forEach((part) => copyTree(path.join(PROJECT, part), path.join(target, part)));
  return `код скопирован в ${target}`;
}

function packageOf(archive) {
  return JSON.parse(asar.readFile(archive, 'package.json').toString('utf8'));
}

function install() {
  const app = locate();
  assertClosed(app.exe);
  let pkg = packageOf(app.archive);
  if (pkg.overtonePreviousMain) {
    // Уже стоит: архив не трогаем, обновляем только код мода.
    console.log(`Загрузчик уже в архиве, ${deploy(flag('--dev'))}.`);
    return;
  }
  const before = asar.readHeader(app.archive).hash;
  fs.copyFileSync(app.archive, app.backup);
  const previousMain = pkg.main || 'index.js';
  pkg = { ...pkg, main: BOOT, overtonePreviousMain: previousMain };
  const patched = `${app.archive}.overtone-new`;
  const after = asar.patch(app.backup, patched, {
    [BOOT]: Buffer.from(bootSource(previousMain), 'utf8'),
    'package.json': Buffer.from(JSON.stringify(pkg, null, 2), 'utf8'),
  });
  try {
    swapHash(app.exe, before, after);
    fs.renameSync(patched, app.archive);
  } catch (error) {
    fs.rmSync(patched, { force: true });
    try {
      swapHash(app.exe, after, before);
    } catch {}
    throw error;
  }
  console.log(`Готово: точка входа ${previousMain} -> ${BOOT}, ${deploy(flag('--dev'))}.`);
  if (previousMain.replace(/^\.\//, '') !== 'index.js') console.log(`Прежний загрузчик (${previousMain}) продолжит работать: он вызывается следом.`);
}

function uninstall() {
  const app = locate();
  assertClosed(app.exe);
  const pkg = packageOf(app.archive);
  if (!pkg.overtonePreviousMain) {
    console.log('Загрузчика в архиве нет.');
  } else {
    if (!fs.existsSync(app.backup)) throw new Error('Нет резервной копии app.asar. Переустанови Яндекс Музыку с сайта.');
    const current = asar.readHeader(app.archive).hash;
    const original = asar.readHeader(app.backup).hash;
    swapHash(app.exe, current, original);
    fs.copyFileSync(app.backup, app.archive);
    fs.rmSync(app.backup, { force: true });
    console.log('Архив приложения восстановлен.');
  }
  if (flag('--remove-data')) {
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log(`Удалена папка ${DATA}.`);
  }
}

function status() {
  const app = locate();
  const pkg = packageOf(app.archive);
  const { hash } = asar.readHeader(app.archive);
  const inExe = fs.readFileSync(app.exe).includes(Buffer.from(hash, 'latin1'));
  console.log(`Приложение: ${pkg.version} в ${app.dir}`);
  console.log(`Точка входа: ${pkg.main}${pkg.overtonePreviousMain ? ` (до нас: ${pkg.overtonePreviousMain})` : ''}`);
  console.log(`Overtone: ${pkg.overtonePreviousMain ? 'установлен' : 'не установлен'}`);
  console.log(`Хеш архива совпадает с exe: ${inExe ? 'да' : 'НЕТ, приложение не запустится'}`);
  console.log(`yt-dlp: ${fs.existsSync(path.join(DATA, 'bin', 'yt-dlp.exe')) ? 'есть' : 'нет (npm run ytdlp)'}`);
}

async function ytdlp() {
  const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
  const target = path.join(DATA, 'bin', 'yt-dlp.exe');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  console.log(`Скачиваю ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GitHub ответил ${response.status}`);
  fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  console.log(`Сохранён ${target}. Обновлять потом так же, этой командой.`);
}

const commands = { install, uninstall, status, ytdlp };
const command = commands[args[0]];
if (!command) {
  console.log('Команды: install [--dev] | uninstall [--remove-data] | status | ytdlp. Общая опция: --app-dir <папка>');
  process.exit(1);
}
Promise.resolve()
  .then(command)
  .catch((error) => {
    console.error(`Ошибка: ${error.message}`);
    process.exit(1);
  });
