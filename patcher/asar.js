'use strict';
// Минимальная работа с app.asar без распаковки: читаем заголовок, дописываем файлы в конец,
// считаем хеш заголовка (его Electron сверяет со значением, зашитым в exe).
const fs = require('fs');
const crypto = require('crypto');

const BLOCK = 4 * 1024 * 1024;
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function readHeader(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    const headerSize = head.readUInt32LE(4);
    const jsonLength = head.readUInt32LE(12);
    const json = Buffer.alloc(jsonLength);
    fs.readSync(fd, json, 0, jsonLength, 16);
    return {
      header: JSON.parse(json.toString('utf8')),
      hash: sha256(json),
      dataOffset: 8 + headerSize,
      dataLength: fs.fstatSync(fd).size - (8 + headerSize),
    };
  } finally {
    fs.closeSync(fd);
  }
}

function readFile(file, name) {
  const { header, dataOffset } = readHeader(file);
  const entry = header.files[name];
  if (!entry) return null;
  const buf = Buffer.alloc(entry.size);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, buf, 0, entry.size, dataOffset + Number(entry.offset));
  } finally {
    fs.closeSync(fd);
  }
  return buf;
}

function entryFor(buf, offset) {
  const blocks = [];
  for (let at = 0; at < buf.length || at === 0; at += BLOCK) {
    blocks.push(sha256(buf.subarray(at, at + BLOCK)));
    if (buf.length === 0) break;
  }
  return {
    size: buf.length,
    offset: String(offset),
    integrity: { algorithm: 'SHA256', hash: sha256(buf), blockSize: BLOCK, blocks },
  };
}

function encodeHeader(header) {
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const padded = Math.ceil(json.length / 4) * 4;
  const out = Buffer.alloc(16 + padded);
  out.writeUInt32LE(4, 0);
  out.writeUInt32LE(8 + padded, 4);
  out.writeUInt32LE(4 + padded, 8);
  out.writeUInt32LE(json.length, 12);
  json.copy(out, 16);
  return { bytes: out, hash: sha256(json) };
}

/**
 * Пишет в `dst` копию `src`, где файлы из `files` (имя в корне архива -> Buffer) добавлены
 * или заменены. Старые данные не трогаются: новое дописывается в конец.
 * Возвращает хеш нового заголовка.
 */
function patch(src, dst, files) {
  const { header, dataOffset, dataLength } = readHeader(src);
  let tail = dataLength;
  const added = [];
  for (const [name, buf] of Object.entries(files)) {
    header.files[name] = entryFor(buf, tail);
    added.push(buf);
    tail += buf.length;
  }
  const encoded = encodeHeader(header);
  const input = fs.openSync(src, 'r');
  const output = fs.openSync(dst, 'w');
  try {
    fs.writeSync(output, encoded.bytes);
    const chunk = Buffer.alloc(8 * 1024 * 1024);
    let position = dataOffset;
    for (;;) {
      const read = fs.readSync(input, chunk, 0, chunk.length, position);
      if (!read) break;
      fs.writeSync(output, chunk, 0, read);
      position += read;
    }
    added.forEach((buf) => fs.writeSync(output, buf));
  } finally {
    fs.closeSync(input);
    fs.closeSync(output);
  }
  return encoded.hash;
}

module.exports = { readHeader, readFile, patch };
