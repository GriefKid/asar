const test = require('node:test');
const assert = require('node:assert/strict');
const calendar = require('../src/shared/calendar');

test('Tehran changes day at local midnight, including when the host uses another zone', () => {
  assert.deepEqual(calendar.todayJalali(new Date('2026-11-26T20:29:59Z')), { y: 1405, m: 9, d: 5 });
  assert.deepEqual(calendar.todayJalali(new Date('2026-11-26T20:30:00Z')), { y: 1405, m: 9, d: 6 });
  assert.equal(calendar.jalaliWeekday(1405, 9, 6), 5);
  assert.equal(calendar.jalaliFirstWeekday(1405, 9), 1);
});

test('round trips civil dates across leap and non-leap Nowruz boundaries', () => {
  assert.equal(calendar.jalaliMonthLen(1403, 12), 30);
  assert.equal(calendar.jalaliMonthLen(1404, 12), 29);
  assert.deepEqual(calendar.toJalali(2024, 3, 20), { y: 1403, m: 1, d: 1 });
  assert.deepEqual(calendar.jalaliToGregorian(1403, 12, 30), { y: 2025, m: 3, d: 20 });
  assert.deepEqual(calendar.addJalaliDays({ y: 1403, m: 12, d: 30 }, 1), { y: 1404, m: 1, d: 1 });
  assert.deepEqual(calendar.addJalaliDays({ y: 1405, m: 1, d: 1 }, -1), { y: 1404, m: 12, d: 29 });
  for (let y = 1390; y <= 1420; y++) {
    for (let m = 1; m <= 12; m++) {
      const d = calendar.jalaliMonthLen(y, m);
      const g = calendar.jalaliToGregorian(y, m, d);
      assert.deepEqual(calendar.toJalali(g.y, g.m, g.d), { y, m, d });
    }
  }
});
