'use strict';

const AsarPlanner = (() => {
  const minuteCount = 24 * 60;

  function activityKey(event) {
    return String(event.title || '').normalize('NFKC').toLocaleLowerCase('fa')
      .replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[\u200c\s]+/g, ' ').trim();
  }

  function interval(event) {
    if (!/^\d{2}:\d{2}$/.test(event.time || '')) return null;
    const [hours, minutes] = event.time.split(':').map(Number);
    const length = Number(event.duration);
    if (hours > 23 || minutes > 59 || !Number.isInteger(length) || length <= 0) return null;
    const start = hours * 60 + minutes;
    return [start, Math.min(start + length, minuteCount)];
  }

  function activities(events) {
    const result = new Map();
    for (const event of events) {
      const name = activityKey(event);
      const range = interval(event);
      if (!range || !name || ['idle', 'note'].includes(event.type) || /^(هیچ کاری|بیکاری|بدون فعالیت|هیچ کار|هیچ|nothing|idle)$/.test(name)) continue;
      if (!result.has(name)) result.set(name, new Uint8Array(minuteCount));
      result.get(name).fill(1, ...range);
    }
    return result;
  }

  function compare(plan, actual) {
    const planned = activities(plan);
    const happened = activities(actual);
    let total = 0;
    let onTime = 0;
    let anotherTime = 0;
    for (const [name, plannedSlots] of planned) {
      const actualSlots = happened.get(name);
      let plannedMinutes = 0;
      let actualMinutes = 0;
      let overlap = 0;
      for (let minute = 0; minute < minuteCount; minute++) {
        plannedMinutes += plannedSlots[minute];
        actualMinutes += actualSlots?.[minute] || 0;
        if (plannedSlots[minute] && actualSlots?.[minute]) overlap++;
      }
      total += plannedMinutes;
      onTime += overlap;
      anotherTime += Math.min(plannedMinutes, actualMinutes) - overlap;
    }
    return { planned: total, onTime, anotherTime, complete: planned.size > 0 && happened.size > 0 };
  }

  function score(plan, actual, doneHab, totalHab, dayStatus) {
    const minutes = compare(plan, actual);
    if (!minutes.complete || dayStatus > 0) {
      return { ...minutes, pending: dayStatus >= 0, score: 0, adherence: 0, habit: 0, bonus: 0 };
    }
    const adherence = (minutes.onTime + 0.8 * minutes.anotherTime) / minutes.planned * 50;
    const habit = totalHab > 0 ? (doneHab / totalHab) * 30 : 0;
    const base = adherence + habit;
    const bonus = base >= 65 ? 20 : base >= 40 ? 10 : 0;
    return { ...minutes, pending: false, score: Math.round(base + bonus), adherence, habit, bonus };
  }

  return { activityKey, interval, compare, score };
})();

if (typeof module !== 'undefined') module.exports = AsarPlanner;
