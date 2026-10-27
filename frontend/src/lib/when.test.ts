import { describe, expect, it } from 'vitest'
import { eventDate, tidyDate } from './when'

describe('tidyDate', () => {
  it('drops abbreviation dots and the year marker word', () => {
    expect(tidyDate('16 окт. 2025 г.')).toBe('16 окт 2025')
    expect(tidyDate('16 жовт. 2025 р.')).toBe('16 жовт 2025')
    expect(tidyDate('16 окт., 20:48')).toBe('16 окт, 20:48')
  })
  it('keeps the "р." that ends a Ukrainian month', () => {
    expect(tidyDate('28 вер.')).toBe('28 вер')
    expect(tidyDate('28 вер. 2025 р.')).toBe('28 вер 2025')
  })
  it('uses three-letter English months', () => {
    expect(tidyDate('4 Sept')).toBe('4 Sep')
    expect(tidyDate('16 Oct 2025')).toBe('16 Oct 2025')
  })
})

describe('eventDate', () => {
  // Tests run in English (en-GB); local noon, so the day does not depend on the time zone.
  const now = new Date(2026, 9, 27, 12).getTime()
  it('gives day and month, with the year only for another year', () => {
    expect(eventDate(new Date(2026, 9, 7, 12).toISOString(), now)).toBe('07/10')
    expect(eventDate(new Date(2025, 9, 7, 12).toISOString(), now)).toBe('07/10/25')
    expect(eventDate(null, now)).toBeNull()
  })
})
