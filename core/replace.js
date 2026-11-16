'use strict';
// Замена недоступных треков Яндекса: ищем тот же трек на SoundCloud и играем его под родной карточкой.
// Главный риск — сыграть не ту песню, поэтому совпадение строгое: название, исполнитель и длительность.

const MISS_TTL_MS = 7 * 24 * 3600 * 1000;
const DURATION_SLACK_MS = 4000;
/** Не больше стольких поисков за час: yt-dlp на каждый тратит несколько секунд. */
const HOURLY_LIMIT = 60;

/** Для сравнения: нижний регистр, без «(feat. …)», «[prod …]», знаков и лишних пробелов. */
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[([{][^)\]}]*(feat|ft\.|prod|remaster|official|audio|video|lyric|clip|клип)[^)\]}]*[)\]}]/g, ' ')
    .replace(/\b(feat|ft)\.?\s.*$/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
const words = (text) => new Set(normalize(text).split(' ').filter((word) => word.length > 1));
/** Доля слов из a, которые есть в b. */
function covered(a, b) {
  const need = words(a);
  if (!need.size) return 0;
  const have = words(b);
  let hit = 0;
  for (const word of need) if (have.has(word)) hit += 1;
  return hit / need.size;
}

const fs = require('fs');
const path = require('path');

module.exports = function createReplace({ soundcloud, getConfig, dataDir }) {
  const file = path.join(dataDir, 'replace.json');
  const state = { replace: {} };
  try {
    state.replace = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  const save = () => fs.writeFile(file, JSON.stringify(state.replace), () => {});
  const queue = [];
  let busy = false;
  let hour = { start: Date.now(), count: 0 };

  function score(card, candidate) {
    if (!candidate.durationMs || Math.abs(candidate.durationMs - card.durationMs) > DURATION_SLACK_MS) return 0;
    const artist = (card.artists || []).map((item) => item.name).join(' ');
    const where = `${candidate.artist} ${candidate.title}`;
    const titleScore = covered(card.title, candidate.title);
    const artistScore = covered(artist, where);
    if (titleScore < 0.8 || artistScore < 0.5) return 0;
    return titleScore + artistScore - Math.abs(candidate.durationMs - card.durationMs) / 10_000;
  }

  async function lookup(card) {
    const artist = (card.artists || [])[0]?.name || '';
    const found = await soundcloud.searchRaw(`${artist} ${card.title}`, 8);
    let best = null;
    for (const candidate of found) {
      const value = score(card, candidate);
      if (value && (!best || value > best.value)) best = { value, candidate };
    }
    return best?.candidate || null;
  }

  async function pump() {
    if (busy) return;
    busy = true;
    try {
      while (queue.length) {
        if (Date.now() - hour.start > 3600_000) hour = { start: Date.now(), count: 0 };
        if (hour.count >= HOURLY_LIMIT) break;
        hour.count += 1;
        const card = queue.shift();
        const id = String(card.id);
        let match = null;
        try {
          match = await lookup(card);
        } catch {
          // Сеть или yt-dlp: не запоминаем как «нет», попробуем в другой раз.
          continue;
        }
        state.replace[id] = { sc: match?.id || null, at: Date.now() };
        save();
      }
    } finally {
      busy = false;
    }
  }

  return {
    /** Номер трека SoundCloud для недоступного трека Яндекса или null. */
    sourceFor(id) {
      const known = state.replace[String(id)];
      return known?.sc && soundcloud.track(known.sc) ? known.sc : null;
    },
    /** Смотрит карточки из ответа /tracks: недоступные с найденной заменой становятся доступными. */
    patch(cards) {
      if (!getConfig().scReplace || !Array.isArray(cards)) return null;
      let changed = false;
      const next = cards.map((card) => {
        if (!card || card.available !== false || /^70\d{11}$/.test(String(card.id))) return card;
        const id = String(card.id);
        const known = state.replace[id];
        if (known?.sc && soundcloud.track(known.sc)) {
          changed = true;
          return { ...card, available: true, availableForPremiumUsers: true, availableFullWithoutPermission: true, overtoneSource: 'soundcloud' };
        }
        const stale = !known || (!known.sc && Date.now() - known.at > MISS_TTL_MS);
        if (stale && !queue.some((item) => String(item.id) === id) && card.title && card.durationMs) {
          queue.push(card);
        }
        return card;
      });
      pump();
      return changed ? next : null;
    },
  };
};
