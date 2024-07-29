import Parser from "rss-parser"
import { Context, NewContext, PublicAPI } from "@wox-launcher/wox-plugin"

let feeds: Feed[] = []
let feedItems: FeedItem[] = []
let feedIntervals: Map<string, NodeJS.Timeout> = new Map()
let api: PublicAPI
const feedItemMapKey = "feedItems"

export interface Feed {
  title: string
  url: string
  refreshInterval: number // in minutes
  maxItems: number // max number of items to keep
}

export interface FeedItem {
  feedUrl: string
  link: string // should be unique, will be used to check if the item is already in the list
  title: string
  date: string
  summary: string
  isRead: boolean
}

export interface FeedItemX extends FeedItem {
  feed: Feed
}

async function parseFeed(ctx: Context, feedUrl: string): Promise<FeedItem[]> {
  let parser = new Parser()
  let feed = await parser.parseURL(feedUrl)
  await api.Log(ctx, "Info", `parsed feed: ${feed.items.length} items`)
  return feed.items.map((item) => {
    return {
      feedUrl: feedUrl,
      title: item.title || "",
      link: item.link || "",
      date: item.pubDate || "",
      summary: item.contentSnippet || "",
      isRead: false
    }
  })
}

function updateFeeds(f: Feed[]) {
  feeds = f
}

async function start(ctx: Context, f: Feed[], woxAPI: PublicAPI) {
  api = woxAPI

  let existingFeedItems = await api.GetSetting(ctx, feedItemMapKey)
  if (existingFeedItems) {
    try {
      feedItems = JSON.parse(existingFeedItems) as FeedItem[]
      // if feedItems is not an array, reset it
      if (!Array.isArray(feedItems)) {
        await api.Log(ctx, "Info", "existing feed items is not an array, reset it")
        feedItems = []
      }
      await api.Log(ctx, "Info", `loaded existing feed items: ${feedItems.length}`)
    } catch (e) {
      await api.Log(ctx, "Error", "failed to parse existing feed items: " + e)
    }
  }

  updateFeeds(f)
  startSchedule()
}

function startSchedule() {
  // cancel previous schedules
  // schedule new schedules
  feeds.forEach((feed) => {
    // clear previous schedule
    let interval = feedIntervals.get(feed.url)
    if (interval) {
      clearInterval(interval)
    }

    // sync immediately and then schedule the next sync
    syncFeeds(NewContext(), feed)
    let newInterval = setInterval(async () => {
      await syncFeeds(NewContext(), feed)
    }, feed.refreshInterval * 60 * 1000)
    feedIntervals.set(feed.url, newInterval)
  })
}

async function syncFeeds(ctx: Context, feed: Feed) {
  await api.Log(ctx, "Info", `start sync feed: ${feed.title}`)
  let allItemsInFeed = feedItems.filter(item => item.feedUrl === feed.url)
  let newItems = (await parseFeed(ctx, feed.url)).filter((item) => {
    return !allItemsInFeed.some((existingItem) => existingItem.link === item.link)
  })
  // concat new items to existing items and sort by date desc, then keep the top N items
  allItemsInFeed = allItemsInFeed.concat(newItems).sort((a, b) => {
    return new Date(b.date).getTime() - new Date(a.date).getTime()
  }).slice(0, feed.maxItems)
  feedItems = feedItems.filter(item => item.feedUrl !== feed.url).concat(allItemsInFeed)
  feedItems = feedItems.sort((a, b) => {
    return new Date(b.date).getTime() - new Date(a.date).getTime()
  })
  await api.SaveSetting(ctx, feedItemMapKey, JSON.stringify(feedItems), false)
  await api.Log(ctx, "Info", `finish sync feed: ${feed.title}, total items: ${allItemsInFeed.length}`)
}

function getFeedItems(): FeedItemX[] {
  let allItems: FeedItemX[] = []
  feedItems.forEach((item) => {
      let feed = feeds.find((f) => f.url === item.feedUrl)
      if (feed) {
        allItems.push({
          ...item,
          feed: feed
        })
      }
    }
  )
  return allItems
}

async function markAsRead(ctx: Context, link: string) {
  let item = feedItems.find((item) => item.link === link)
  if (item) {
    item.isRead = true
    await api.SaveSetting(ctx, feedItemMapKey, JSON.stringify(feedItems), false)
  }
}

export { parseFeed, updateFeeds, start, getFeedItems, markAsRead }
