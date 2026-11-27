const MAX_CUES = 32;
const MAX_QUERY_LENGTH = 3500;
const PERSIAN_LETTER = /[\u0621-\u063a\u0641-\u064a\u067e\u0686\u0698\u06a9\u06af\u06cc]/;
const LATIN_LETTER = /\p{Script=Latin}/u;

function decodeEntities(text) {
  const entities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (match, entity) => {
    if (!entity.startsWith('#')) return entities[entity.toLowerCase()];
    const hex = entity[1].toLowerCase() === 'x';
    const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    return point <= 0x10ffff ? String.fromCodePoint(point) : match;
  });
}

function usableTranslation(value) {
  if (typeof value !== 'string') return null;
  const text = decodeEntities(value).trim();
  return PERSIAN_LETTER.test(text) ? text : null;
}

function createSubtitleTranslator(request = fetch) {
  const retryAfter = new Map();

  async function getJson(provider, url) {
    if (Date.now() < (retryAfter.get(provider) || 0)) return null;
    try {
      const response = await request(url, { signal: AbortSignal.timeout(8000) });
      if (response.status === 429 || response.status === 403 || response.status >= 500) {
        retryAfter.set(provider, Date.now() + 30_000);
      }
      return response.ok ? await response.json() : null;
    } catch {
      retryAfter.set(provider, Date.now() + 30_000);
      return null;
    }
  }

  async function translateSingle(source) {
    const direct = new URL('https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=fa&dt=t');
    direct.searchParams.set('q', source);
    if (direct.search.length > MAX_QUERY_LENGTH) return null;
    const google = await getJson('google-single', direct);
    const segments = Array.isArray(google?.[0]) ? google[0] : [];
    const result = usableTranslation(segments.map(segment => segment?.[0]).join(''));
    if (result) return result;

    // MyMemory accepts up to 500 UTF-8 bytes per request and reports quota errors in the body.
    if (Buffer.byteLength(source) > 500) return null;
    const memory = new URL('https://api.mymemory.translated.net/get');
    memory.searchParams.set('langpair', 'en|fa');
    memory.searchParams.set('q', source);
    const alternative = await getJson('mymemory', memory);
    return Number(alternative?.responseStatus) === 200
      ? usableTranslation(alternative.responseData?.translatedText)
      : null;
  }

  return async function translateSubtitleCues(cues) {
    if (!Array.isArray(cues) || cues.length > MAX_CUES) return [];
    const translations = cues.map(() => null);
    const pending = new Map();
    cues.forEach((value, index) => {
      if (typeof value !== 'string' || value.length > MAX_QUERY_LENGTH || !value.trim()) return;
      const source = decodeEntities(value).trim();
      if (!LATIN_LETTER.test(source) || /^(?:[A-Z]\.){2,}$/.test(source)) {
        translations[index] = source;
        return;
      }
      if (!pending.has(source)) pending.set(source, []);
      pending.get(source).push(index);
    });

    const url = new URL('https://translate.googleapis.com/translate_a/t?client=dict-chrome-ex&sl=en&tl=fa');
    const batch = [];
    // Each q parameter is a separate translation. A mismatched response cannot be assigned by index.
    for (const source of pending.keys()) {
      const param = new URLSearchParams({ q: source });
      if (url.search.length + param.toString().length + 1 > MAX_QUERY_LENGTH) continue;
      url.searchParams.append('q', source);
      batch.push(source);
    }

    function assign(source, translation) {
      if (!translation) return;
      for (const index of pending.get(source)) translations[index] = translation;
      pending.delete(source);
    }

    if (batch.length) {
      const data = await getJson('google-batch', url);
      if (Array.isArray(data) && data.length === batch.length) {
        batch.forEach((source, index) => assign(source, usableTranslation(data[index])));
      }
    }

    const missing = [...pending.keys()];
    for (let index = 0; index < missing.length; index += 4) {
      const group = missing.slice(index, index + 4);
      await Promise.all(group.map(async source => assign(source, await translateSingle(source))));
    }
    return translations;
  };
}

module.exports = { createSubtitleTranslator };
