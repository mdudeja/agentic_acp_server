import { Temporal } from 'temporal-polyfill'

/** Returns the current instant in time. */
const getNow = (): Temporal.Instant => {
  return Temporal.Now.instant()
}

/** Returns the current time in milliseconds. */
const getNowMillis = (): number => {
  return Temporal.Now.instant().epochMilliseconds
}

/** Returns the number of milliseconds representing the start of the given dates day. */
const getStartOfDayMillis = (date: Temporal.PlainDateLike): number => {
  const plainDate = Temporal.PlainDate.from(date)
  const startOfDay = plainDate.toPlainDateTime({
    hour: 0,
    minute: 0,
    second: 0,
  })
  const zonedDateTime = startOfDay.toZonedDateTime(Temporal.Now.timeZoneId())
  return zonedDateTime.toInstant().epochMilliseconds
}

/** Gets the number of milliseconds until the end of the day for the given date. */
const getEndOfDayMillis = (date: Temporal.PlainDateLike): number => {
  const plainDate = Temporal.PlainDate.from(date)
  const endOfDay = plainDate.toPlainDateTime({
    hour: 23,
    minute: 59,
    second: 59,
    millisecond: 999,
  })
  const zonedDateTime = endOfDay.toZonedDateTime(Temporal.Now.timeZoneId())
  return zonedDateTime.toInstant().epochMilliseconds
}

/** Converts milliseconds into a formatted time duration string (e.g., mm:ss). */
const formatTimeDuration = (durationMs: number): string => {
  const totalSeconds = Math.floor(durationMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const parts: string[] = []
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`)

  return parts.join(' ')
}

/** Converts a timestamp in milliseconds to a formatted date string. */
const formatDateTime = (millis: number): string => {
  const instant = Temporal.Instant.fromEpochMilliseconds(millis)
  const zonedDateTime = instant.toZonedDateTimeISO(Temporal.Now.timeZoneId())
  return zonedDateTime.toString({ fractionalSecondDigits: 0 })
}

export {
  getNow,
  getNowMillis,
  getStartOfDayMillis,
  getEndOfDayMillis,
  formatTimeDuration,
  formatDateTime,
}
