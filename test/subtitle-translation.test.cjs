const assert = require('node:assert/strict');
const test = require('node:test');
const { createSubtitleTranslator } = require('../src/shared/subtitle-translation.cjs');

const first = 'Where is the library?';
const second = 'What did you see?';
const persian = 'کتابخانه کجاست؟';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

test('subtitle batching sends distinct cues and maps results back to their original positions', async () => {
  const translate = createSubtitleTranslator(async url => {
    assert.equal(url.pathname, '/translate_a/t');
    assert.deepEqual(url.searchParams.getAll('q'), [first, second]);
    return json([persian, 'چه دیدی؟']);
  });
  assert.deepEqual(await translate([first, '♪', second, first]), [persian, '♪', 'چه دیدی؟', persian]);
});

test('mismatched batches, English echoes and quota responses cannot mark a cue translated', async () => {
  const translate = createSubtitleTranslator(async url => {
    const source = url.searchParams.get('q');
    if (url.pathname === '/translate_a/t') return json(['این باید کنار گذاشته شود']);
    if (url.pathname === '/translate_a/single') return json([[[source, source]]]);
    return source === first
      ? json({ responseStatus: 200, responseData: { translatedText: 'کتابخانه کجاست&#x61f;' } })
      : json({ responseStatus: 429, responseData: { translatedText: 'پایان سهمیه' } });
  });
  assert.deepEqual(await translate([first, second]), [persian, null]);
});

test('rate limits fall back to a separate provider and cool down failed endpoints', async () => {
  const paths = [];
  const translate = createSubtitleTranslator(async url => {
    paths.push(url.pathname);
    if (url.pathname !== '/get') return json(null, 429);
    return json({ responseStatus: 200, responseData: { translatedText: persian } });
  });
  assert.deepEqual(await translate([first]), [persian]);
  assert.deepEqual(await translate([first]), [persian]);
  assert.deepEqual(paths, ['/translate_a/t', '/translate_a/single', '/get', '/get']);
});
