import { tool } from 'ai'
import { z } from 'zod'
import { loadConfig, writeConfigSection } from '@/core/config.js'
import type { NewsCollector } from '@/domain/news/index.js'
import type { RSSFeedConfig } from '@/domain/news/types.js'

export { createNewsArchiveTools } from '@/domain/news/query/archive.js'

function splitCategories(input: string | undefined): string[] | undefined {
  const categories = input?.split(',').map((s) => s.trim()).filter(Boolean)
  return categories && categories.length > 0 ? categories : undefined
}

async function updateFeeds(
  mutate: (feeds: RSSFeedConfig[]) => RSSFeedConfig[],
  collector: NewsCollector | null,
): Promise<RSSFeedConfig[]> {
  const config = await loadConfig()
  const feeds = mutate(config.news.feeds)
  const next = { ...config.news, feeds }
  await writeConfigSection('news', next)
  collector?.updateFeeds(feeds)
  return feeds
}

export function createNewsSourceTools(getCollector: () => NewsCollector | null) {
  return {
    rssSourceList: tool({
      description: 'List configured RSS/Atom feed sources and whether each is enabled.',
      inputSchema: z.object({}),
      execute: async () => {
        const config = await loadConfig()
        return config.news.feeds.map((f) => ({
          source: f.source,
          name: f.name,
          url: f.url,
          enabled: f.enabled !== false,
          categories: f.categories ?? [],
          description: f.description ?? '',
        }))
      },
    }),
    rssSourceAdd: tool({
      description: 'Add a configured RSS/Atom feed source. Source must be unique.',
      inputSchema: z.object({
        name: z.string().min(1).describe('Human-readable feed name.'),
        url: z.string().url().describe('RSS or Atom feed URL.'),
        source: z.string().min(1).describe('Stable source tag stored on ingested articles.'),
        categories: z.string().optional().describe('Comma-separated category tags.'),
        description: z.string().optional().describe('Short human-readable description.'),
        enabled: z.boolean().optional().describe('Whether to fetch this feed. Defaults to true.'),
      }),
      execute: async ({ name, url, source, categories, description, enabled }) => {
        const feed: RSSFeedConfig = {
          name,
          url,
          source,
          ...(splitCategories(categories) ? { categories: splitCategories(categories) } : {}),
          ...(description ? { description } : {}),
          enabled: enabled ?? true,
        }
        const feeds = await updateFeeds((current) => {
          if (current.some((f) => f.source === source)) throw new Error(`RSS source already exists: ${source}`)
          return [...current, feed]
        }, getCollector())
        return { ok: true, source, count: feeds.length }
      },
    }),
    rssSourceRemove: tool({
      description: 'Remove a configured RSS/Atom feed source by source tag.',
      inputSchema: z.object({
        source: z.string().min(1).describe('Source tag to remove.'),
      }),
      execute: async ({ source }) => {
        const feeds = await updateFeeds((current) => {
          if (!current.some((f) => f.source === source)) throw new Error(`RSS source not found: ${source}`)
          return current.filter((f) => f.source !== source)
        }, getCollector())
        return { ok: true, source, count: feeds.length }
      },
    }),
    rssSourceEnable: tool({
      description: 'Enable a configured RSS/Atom feed source by source tag.',
      inputSchema: z.object({
        source: z.string().min(1).describe('Source tag to enable.'),
      }),
      execute: async ({ source }) => {
        await updateFeeds((current) => {
          if (!current.some((f) => f.source === source)) throw new Error(`RSS source not found: ${source}`)
          return current.map((f) => f.source === source ? { ...f, enabled: true } : f)
        }, getCollector())
        return { ok: true, source, enabled: true }
      },
    }),
    rssSourceDisable: tool({
      description: 'Disable a configured RSS/Atom feed source by source tag.',
      inputSchema: z.object({
        source: z.string().min(1).describe('Source tag to disable.'),
      }),
      execute: async ({ source }) => {
        await updateFeeds((current) => {
          if (!current.some((f) => f.source === source)) throw new Error(`RSS source not found: ${source}`)
          return current.map((f) => f.source === source ? { ...f, enabled: false } : f)
        }, getCollector())
        return { ok: true, source, enabled: false }
      },
    }),
  }
}
