import assert from 'node:assert/strict';
import test from 'node:test';
import { browserCalendarDay, browserLocalDateTime, browserLocalDateTimeIso, formatCampusDateTime } from '../src/lib/browser-temporal';
test('browser calendar dates preserve leap days without UTC/day shifting', () => {
  assert.equal(browserCalendarDay('2028-02-29'), true);
  for (const value of ['2026-02-29', '2026-13-01', '2026-10-32', '2026-1-01', '']) assert.equal(browserCalendarDay(value), false);
});
test('device-local date/time values round-trip an exact instant including seconds and milliseconds', () => {
  const original = '2026-10-29T03:24:38.123Z'; assert.equal(browserLocalDateTimeIso(browserLocalDateTime(original)), original);
  assert.equal(browserLocalDateTime('invalid'), '');
  for (const value of ['2026-02-29T12:00', '2026-10-29T24:00', '2026-10-29T12:60', '2026-10-29T12:00:60', '2026-10-29T12:00Z', '']) assert.equal(browserLocalDateTimeIso(value), null);
});
test('browser local date/time changes preserve exact minimum and maximum boundaries', () => {
  const instant = new Date('2026-10-29T03:24:38.123Z'), local = browserLocalDateTime(instant);
  assert.equal(browserLocalDateTimeIso(local, instant, instant), instant.toISOString());
  assert.equal(browserLocalDateTimeIso(local, new Date(instant.getTime() + 1)), null);
  assert.equal(browserLocalDateTimeIso(local, undefined, new Date(instant.getTime() - 1)), null);
});
test('browser date/time refuses a nonexistent device-local DST time instead of moving the selected hour', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    assert.equal(browserLocalDateTimeIso('2026-03-08T02:30'), null);
    assert.equal(browserLocalDateTimeIso('2026-03-08T03:30'), '2026-03-08T07:30:00.000Z');
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('campus controls preserve the campus wall time and exact instant independently of device zone', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    const instant = '2026-11-12T09:00:38.123Z';
    assert.equal(browserLocalDateTime(instant, 'UTC'), '2026-11-12T09:00:38.123');
    const campus = browserLocalDateTime(instant, 'Asia/Kolkata');
    assert.equal(campus, '2026-11-12T14:30:38.123');
    assert.equal(browserLocalDateTimeIso(campus, undefined, undefined, 'Asia/Kolkata'), instant);
    assert.equal(browserLocalDateTimeIso(campus, new Date(Date.parse(instant) + 1), undefined, 'Asia/Kolkata'), null);
    assert.equal(browserLocalDateTimeIso(campus, undefined, new Date(instant), 'Asia/Kolkata'), instant);
    assert.match(formatCampusDateTime(instant, 'UTC'), /9:00.*UTC/i);
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('campus wall times reject daylight-saving gaps and repeated hours', () => {
  assert.equal(browserLocalDateTimeIso('2026-03-08T02:30', undefined, undefined, 'America/New_York'), null);
  assert.equal(browserLocalDateTimeIso('2026-11-01T01:30', undefined, undefined, 'America/New_York'), null);
  assert.equal(browserLocalDateTimeIso('2026-03-08T03:30', undefined, undefined, 'America/New_York'), '2026-03-08T07:30:00.000Z');
  assert.equal(browserLocalDateTimeIso('2026-10-04T02:15', undefined, undefined, 'Australia/Lord_Howe'), null);
  assert.equal(browserLocalDateTimeIso('2026-11-01T01:30', undefined, undefined, 'Invalid/Zone'), null);
});
