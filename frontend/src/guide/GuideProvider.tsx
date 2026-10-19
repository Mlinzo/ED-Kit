import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { GuideContext } from './context'
import { GuideDialog } from './GuideDialog'
import type { TopicId } from './topics'

/** Lets any "?" in the app open the guide; the guide itself renders only while open. */
export function GuideProvider({ children }: { children: ReactNode }) {
  const [opened, setOpened] = useState<{ topic: TopicId | null } | null>(null)
  const api = useMemo(() => ({ open: (topic?: TopicId) => setOpened({ topic: topic ?? null }) }), [])
  const close = useCallback(() => setOpened(null), [])
  return (
    <GuideContext.Provider value={api}>
      {children}
      {opened && <GuideDialog topic={opened.topic} onClose={close} />}
    </GuideContext.Provider>
  )
}
