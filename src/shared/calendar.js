'use strict';

// Civil dates are represented at UTC noon for date arithmetic. Instants are
// converted to civil dates in Tehran before any calendar calculation.
const AsarCalendar = (() => {
  const timeZone = 'Asia/Tehran';
  const civilFormat = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' });
  const jalaliFormat = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' });
  const dayMilliseconds = 86_400_000;
  const starts = new Map();

  function parts(formatter, date) {
    const result = {};
    for (const { type, value } of formatter.formatToParts(date)) {
      if (type === 'year') result.y = Number(value);
      if (type === 'month') result.m = Number(value);
      if (type === 'day') result.d = Number(value);
    }
    return result;
  }

  function utcDate({ y, m, d }) {
    const date = new Date(0);
    date.setUTCFullYear(y, m - 1, d);
    date.setUTCHours(12, 0, 0, 0);
    return date;
  }

  function civilFromUtc(date) {
    return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
  }

  function toJalali(y, m, d) {
    return parts(jalaliFormat, utcDate({ y, m, d }));
  }

  function yearStart(y) {
    if (!starts.has(y)) {
      const estimate = utcDate({ y: y + 621, m: 3, d: 21 }).getTime();
      for (let i = -6; i <= 6; i++) {
        const time = estimate + i * dayMilliseconds;
        const candidate = parts(jalaliFormat, new Date(time));
        if (candidate.y === y && candidate.m === 1 && candidate.d === 1) {
          starts.set(y, time);
          break;
        }
      }
    }
    if (!starts.has(y)) throw new RangeError(`Unsupported Jalali year: ${y}`);
    return starts.get(y);
  }

  function jalaliMonthLen(y, m) {
    if (m <= 6) return 31;
    if (m <= 11) return 30;
    return (yearStart(y + 1) - yearStart(y)) / dayMilliseconds - 336;
  }

  function jalaliDate(y, m, d) {
    const offset = (m <= 6 ? (m - 1) * 31 : 186 + (m - 7) * 30) + d - 1;
    return new Date(yearStart(y) + offset * dayMilliseconds);
  }

  function jalaliToGregorian(y, m, d) {
    return civilFromUtc(jalaliDate(y, m, d));
  }

  function todayJalali(instant = new Date()) {
    const { y, m, d } = parts(civilFormat, instant);
    return toJalali(y, m, d);
  }

  function addJalaliDays({ y, m, d }, count) {
    return parts(jalaliFormat, new Date(jalaliDate(y, m, d).getTime() + count * dayMilliseconds));
  }

  function jalaliWeekday(y, m, d) {
    return jalaliDate(y, m, d).getUTCDay();
  }

  function jalaliFirstWeekday(y, m) {
    return (jalaliWeekday(y, m, 1) + 1) % 7;
  }

  function compareDays(a, b) {
    return a.y - b.y || a.m - b.m || a.d - b.d;
  }

  function dateKey({ y, m, d }) {
    return `${y}-${m}-${d}`;
  }

  return { toJalali, jalaliToGregorian, todayJalali, jalaliMonthLen, addJalaliDays, jalaliWeekday, jalaliFirstWeekday, compareDays, dateKey };
})();

if (typeof module !== 'undefined') module.exports = AsarCalendar;
