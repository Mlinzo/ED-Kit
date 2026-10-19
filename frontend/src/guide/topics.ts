// The guide: short explanations of the game's exploration mechanics, for newcomers. The texts are
// in the dictionaries (t.guide); this module holds their order and the outside sources, which are
// the same in every language. Facts were checked on 2026-10-19 against the linked pages (game 4.4).

export const TOPICS = [
  'honk',
  'fss',
  'dss',
  'firsts',
  'valuable',
  'riches',
  'sell',
  'death',
  'bio',
  'sampling',
  'colony',
  'footfall',
  'codex',
  'scoop',
  'neutron',
  'community',
] as const

export type TopicId = (typeof TOPICS)[number]

export const SECTIONS = [
  { id: 'scan', topics: ['honk', 'fss', 'dss', 'firsts'] },
  { id: 'money', topics: ['valuable', 'riches', 'sell', 'death'] },
  { id: 'bio', topics: ['bio', 'sampling', 'colony', 'footfall', 'codex'] },
  { id: 'travel', topics: ['scoop', 'neutron'] },
  { id: 'data', topics: ['community'] },
] as const satisfies readonly { id: string; topics: readonly TopicId[] }[]

export type SectionId = (typeof SECTIONS)[number]['id']

/** The explorer's loop at the top of the guide: one topic per step (t.guide.loop). */
export const LOOP: readonly TopicId[] = ['honk', 'fss', 'dss', 'sampling', 'sell']

export interface Source {
  /** Site name, shown as the link text: the same in every language. */
  site: string
  /** What the page is about, in English (the pages are English). */
  page: string
  url: string
}

const wiki = (page: string, title = page.replaceAll('_', ' ')): Source => ({
  site: 'Elite Dangerous Wiki',
  page: title,
  url: `https://elite-dangerous.fandom.com/wiki/${page}`,
})

const EXOBIOLOGY_GUIDE: Source = {
  site: 'Frontier forums',
  page: 'An easy guide to exobiology',
  url: 'https://forums.frontier.co.uk/threads/an-easy-guide-to-elite-dangerous-exobiology.613194/',
}

export const SOURCES: Record<TopicId, readonly Source[]> = {
  honk: [wiki('Discovery_Scanner')],
  fss: [wiki('Full_Spectrum_System_Scanner')],
  dss: [wiki('Detailed_Surface_Scanner')],
  firsts: [wiki('Exploration')],
  valuable: [wiki('Earth-like_World'), wiki('Terraforming')],
  riches: [{ site: 'Spansh', page: 'Road to Riches', url: 'https://spansh.co.uk/riches' }],
  sell: [wiki('Universal_Cartographics'), wiki('Vista_Genomics'), wiki('Fleet_Carrier')],
  death: [wiki('Death')],
  bio: [{ site: 'Canonn', page: 'Codex', url: 'https://canonn.science/codex/' }, EXOBIOLOGY_GUIDE],
  sampling: [wiki('Genetic_Sampler'), EXOBIOLOGY_GUIDE],
  colony: [wiki('Genetic_Sampler')],
  footfall: [wiki('First_Footfall')],
  codex: [wiki('Codex'), wiki('Galactic_Regions')],
  scoop: [wiki('Fuel_Scoop')],
  neutron: [wiki('FSD_Supercharging'), { site: 'Spansh', page: 'Neutron plotter', url: 'https://spansh.co.uk/plotter' }],
  community: [
    { site: 'Spansh', page: 'Search and plotters', url: 'https://spansh.co.uk/' },
    { site: 'EDSM', page: 'Elite Dangerous Star Map', url: 'https://www.edsm.net/' },
    { site: 'GitHub', page: 'EDDN', url: 'https://github.com/EDCD/EDDN' },
    { site: 'GitHub', page: 'EDMC (Market Connector)', url: 'https://github.com/EDCD/EDMarketConnector' },
  ],
}

/** Topics whose title or text holds every word of the query (any order, any case). */
export function searchTopics(
  query: string,
  textOf: (id: TopicId) => string,
): TopicId[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...TOPICS]
  return TOPICS.filter((id) => {
    const text = textOf(id).toLocaleLowerCase()
    return words.every((w) => text.includes(w))
  })
}
