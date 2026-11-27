'use strict';

const AsarBackup = (() => {
  const rootKeys = {
    library: 'asar-library', events: 'asar-events', actualEvents: 'asar-actual-events',
    habits: 'asar-habits', goals: 'asar-goals'
  };
  const lists = new Set(['asar-library', 'asar-habits', 'asar-goals', 'asar-writer-docs']);
  const extraKeys = new Set(['asar-writer-docs', 'book-reader', 'music-player', 'video-player', 'asar-collections', 'asar-layouts', 'asar-appearance', 'asar-theme']);
  const includes = key => Object.values(rootKeys).includes(key) || extras(key);
  const extras = key => extraKeys.has(key) || /^asar-pomo-\d+-\d+-\d+$/.test(key) || /^trans_(?:u8_)?[A-Za-z0-9+/=]+_\d+$/.test(key);

  function parsed(key, stored) {
    const data = typeof stored === 'string' ? JSON.parse(stored) : stored;
    if (lists.has(key) && !Array.isArray(data)) throw new TypeError('Invalid list: ' + key);
    if (key.startsWith('asar-pomo-') && Number.isFinite(data)) return data;
    if (key.startsWith('trans_') && typeof stored === 'string') return stored;
    if (data === null || typeof data !== 'object') throw new TypeError('Invalid data: ' + key);
    return data;
  }

  function collect(storage, allowed = includes) {
    const values = {};
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (allowed(key)) values[key] = storage.getItem(key);
    }
    return values;
  }

  function parseBackup(data) {
    if (!data || typeof data !== 'object') throw new TypeError('Invalid backup');
    const values = {};
    if (data.schema === 'asar-backup' && data.version === 2 && data.storage && typeof data.storage === 'object') {
      for (const [key, value] of Object.entries(data.storage)) {
        if (!includes(key)) continue;
        const decoded = key.startsWith('trans_') ? value : parsed(key, value);
        values[key] = key.startsWith('trans_') ? String(decoded) : JSON.stringify(decoded);
      }
    } else if (!('schema' in data)) {
      for (const [name, key] of Object.entries(rootKeys)) {
        if (data[name] !== undefined) values[key] = JSON.stringify(parsed(key, data[name]));
      }
    }
    if (!Object.keys(values).length) throw new TypeError('Unreadable backup');
    return values;
  }

  function restore(storage, values) {
    const previous = Object.fromEntries(Object.keys(values).map(key => [key, storage.getItem(key)]));
    try {
      for (const [key, value] of Object.entries(values)) storage.setItem(key, value);
    } catch (error) {
      for (const [key, old] of Object.entries(previous)) {
        if (old === null) storage.removeItem(key);
        else storage.setItem(key, old);
      }
      throw error;
    }
  }

  return { rootKeys, collect, parseBackup, restore, includes, extras };
})();

if (typeof module !== 'undefined') module.exports = AsarBackup;
