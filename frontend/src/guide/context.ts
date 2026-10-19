import { createContext, useContext } from 'react'
import type { TopicId } from './topics'

export interface GuideApi {
  /** Opens the guide, at the topic if one is given. */
  open: (topic?: TopicId) => void
}

export const GuideContext = createContext<GuideApi>({ open: () => {} })

export const useGuide = () => useContext(GuideContext)
