import { describe, test, expect, afterEach } from 'bun:test'
import {
  getNow,
  getNowMillis,
  getStartOfDayMillis,
  getEndOfDayMillis,
  formatTimeDuration,
  formatDateTime,
} from '../../src/utils/datetime'
import { Temporal } from 'temporal-polyfill'

describe('Utils.Datetime', () => {
  afterEach(() => {
    // Restore any mocks
  })

  test('getNow returns a Temporal.Instant', () => {
    const now = getNow()
    expect(now).toBeInstanceOf(Temporal.Instant)
  })

  test('getNowMillis returns a number close to Date.now()', () => {
    const nowMillis = getNowMillis()
    const jsNow = Date.now()
    expect(typeof nowMillis).toBe('number')
    expect(Math.abs(nowMillis - jsNow)).toBeLessThan(100)
  })

  test('getStartOfDayMillis returns start of the localized day', () => {
    // Pick a date without time
    const date = Temporal.PlainDate.from('2026-03-11')
    const startMillis = getStartOfDayMillis(date)

    const zdt = Temporal.Instant.fromEpochMilliseconds(
      startMillis,
    ).toZonedDateTimeISO(Temporal.Now.timeZoneId())

    expect(zdt.hour).toBe(0)
    expect(zdt.minute).toBe(0)
    expect(zdt.second).toBe(0)
    expect(zdt.millisecond).toBe(0)
  })

  test('getEndOfDayMillis returns end of the localized day', () => {
    const date = Temporal.PlainDate.from('2026-03-11')
    const endMillis = getEndOfDayMillis(date)

    const zdt = Temporal.Instant.fromEpochMilliseconds(
      endMillis,
    ).toZonedDateTimeISO(Temporal.Now.timeZoneId())

    expect(zdt.hour).toBe(23)
    expect(zdt.minute).toBe(59)
    expect(zdt.second).toBe(59)
    expect(zdt.millisecond).toBe(999)
  })

  describe('formatTimeDuration', () => {
    test('formats seconds only', () => {
      expect(formatTimeDuration(45000)).toBe('45s')
    })

    test('formats minutes and seconds', () => {
      // 2 mins, 30 secs
      expect(formatTimeDuration(150000)).toBe('2m 30s')
    })

    test('formats hours, minutes, and seconds', () => {
      // 1 hour, 15 mins, 5 secs = 3600 + 900 + 5 = 4505 seconds
      expect(formatTimeDuration(4505000)).toBe('1h 15m 5s')
    })

    test('handles exactly 0 ms', () => {
      expect(formatTimeDuration(0)).toBe('0s')
    })

    test('omits zero-value components (e.g. exactly 1 hour)', () => {
      expect(formatTimeDuration(3600000)).toBe('1h')
    })
  })

  describe('formatDateTime', () => {
    test('formats epoch millis properly', () => {
      // Just check that it returns a non-empty string which includes some basic structure.
      const formatted = formatDateTime(1773178675935)
      expect(typeof formatted).toBe('string')
      expect(formatted.length).toBeGreaterThan(0)
    })
  })
})
