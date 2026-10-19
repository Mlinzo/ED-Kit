import { describe, expect, it } from 'vitest'
import { en } from '../i18n/en'
import { LOOP, searchTopics, SECTIONS, SOURCES, TOPICS, type TopicId } from './topics'

const text = (id: TopicId) => {
  const topic = en.guide.topics[id]
  return [topic.title, topic.short, ...topic.body, topic.inApp].join(' ')
}

describe('guide topics', () => {
  it('puts every topic in exactly one section', () => {
    const listed = SECTIONS.flatMap((s) => [...s.topics])
    expect([...listed].sort()).toEqual([...TOPICS].sort())
  })

  it('has a text and at least one https source for every topic', () => {
    for (const id of TOPICS) {
      expect(en.guide.topics[id].title, id).toBeTruthy()
      expect(SOURCES[id].length, id).toBeGreaterThan(0)
      for (const s of SOURCES[id]) expect(s.url, id).toMatch(/^https:\/\//)
    }
  })

  it('has one topic per step of the loop', () => {
    expect(LOOP).toHaveLength(en.guide.loop.length)
  })
})

describe('searchTopics', () => {
  it('returns every topic for an empty query', () => {
    expect(searchTopics('  ', text)).toEqual([...TOPICS])
  })

  it('needs every word, in any order and case', () => {
    expect(searchTopics('colony', text)).toContain('colony')
    expect(searchTopics('RANGE colony', text)).toContain('colony')
    expect(searchTopics('colony zzzz', text)).toEqual([])
  })
})
