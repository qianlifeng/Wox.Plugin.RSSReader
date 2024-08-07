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
  maxItems: number // max number of items to display
}

export interface FeedItem {
  feedUrl: string
  link: string // should be unique, will be used to check if the item is already in the list
  title: string
  date: string
  isRead: boolean
}

export interface FeedItemX extends FeedItem {
  feed: Feed
}

async function parseFeed(ctx: Context, feedUrl: string): Promise<FeedItem[]> {
  let parser = new Parser({ timeout: 5000 })
  let feed = await parser.parseURL(feedUrl).catch((e) => {
    api.Log(ctx, "Error", `failed to parse feed: ${feedUrl}, error: ${e}`)
    return { title: "", items: [] }
  })
  if (feed.items.length == 0) {
    return []
  }

  await api.Log(ctx, "Info", `parsed feed: ${feed.title}, items: ${feed.items.length}`)
  return feed.items.map((item) => {
    let feedDate = item.pubDate || ""
    //check if date is valid
    if (feedDate === "" || isNaN(new Date(feedDate).getTime())) {
      feedDate = new Date().toISOString()
    }

    return {
      feedUrl: feedUrl,
      title: item.title || "",
      link: item.link || "",
      date: feedDate,
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
  let latestFeedItems = await parseFeed(ctx, feed.url)
  let newItems = latestFeedItems.filter((item) => {
    return !allItemsInFeed.some((existingItem) => existingItem.link === item.link)
  })
  if (newItems.length === 0) {
    await api.Log(ctx, "Info", `no new items in feed: ${feed.title}`)
    return
  }

  // concat new items to existing items and sort by date desc, then keep the top N items
  allItemsInFeed = allItemsInFeed.concat(newItems).sort((a, b) => {
    return new Date(b.date).getTime() - new Date(a.date).getTime()
  }).slice(0, 100)
  feedItems = feedItems.filter(item => item.feedUrl !== feed.url).concat(allItemsInFeed)
  feedItems = feedItems.sort((a, b) => {
    return new Date(b.date).getTime() - new Date(a.date).getTime()
  })

  //remove duplicate feed items
  let feedItemsMap: Map<string, FeedItem> = new Map()
  feedItems.forEach((item) => {
    feedItemsMap.set(item.link, item)
  })
  feedItems = Array.from(feedItemsMap.values())

  await saveFeedItems(ctx)
  await api.Log(ctx, "Info", `finish sync feed: ${feed.title}, total items: ${allItemsInFeed.length}`)
}

async function saveFeedItems(ctx: Context) {
  await api.SaveSetting(ctx, feedItemMapKey, JSON.stringify(feedItems), false)
}

function getFeedItems(): FeedItemX[] {
  let allItems: FeedItemX[] = []
  let feedCount = new Map<string, number>()
  feedItems.forEach((item) => {
      let feed = feeds.find((f) => f.url === item.feedUrl)
      if (feed) {
        let count = feedCount.get(feed.url) ?? 0
        feedCount.set(feed.url, count + 1)

        let currentFeedCount = feedCount.get(feed.url) ?? 0
        if (currentFeedCount > feed.maxItems) {
          return
        }

        allItems.push({
          ...item,
          feed: feed
        })
      }
    }
  )

  // sort by date desc
  allItems.sort((a, b) => {
    return new Date(b.date).getTime() - new Date(a.date).getTime()
  })
  return allItems
}

async function markAsRead(ctx: Context, link: string) {
  await api.Log(ctx, "Info", `making item as read: ${link}`)
  let item = feedItems.find((item) => item.link === link)
  if (item) {
    if (item.isRead) {
      return
    }

    item.isRead = true
    await saveFeedItems(ctx)
  } else {
    await api.Log(ctx, "Error", `failed to mark item as read, item not found: ${link}`)
  }
}

async function stop(ctx: Context) {
  // clear all schedules
  feedIntervals.forEach((interval) => {
    clearInterval(interval)
  })
  feedIntervals.clear()
  await api.Log(ctx, "Info", "stopped")
  await api.Log(ctx, "Info", `-----------------------`)
}

export { parseFeed, updateFeeds, start, getFeedItems, markAsRead, stop }
