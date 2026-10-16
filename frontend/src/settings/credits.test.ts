import { describe, expect, it } from 'vitest'
import { shortCredits } from './credits'

describe('shortCredits', () => {
  it('formats thresholds compactly', () => {
    expect(shortCredits(0)).toBe('0')
    expect(shortCredits(750_000)).toBe('750k')
    expect(shortCredits(2_000_000)).toBe('2M')
    expect(shortCredits(1_500_000)).toBe('1.5M')
  })
})
