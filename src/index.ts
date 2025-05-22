import {
  ActionContext,
  Context,
  NewContext,
  Plugin,
  PluginInitParams,
  PublicAPI,
  Query,
  Result,
  WoxImage
} from "@wox-launcher/wox-plugin"
import { Feed, getFeedItems, markAsRead, markAllAsReadInFeed, markAllAsRead, start, stop } from "./rss"
import open from "open"
import dayjs from "dayjs"

let api: PublicAPI
let primaryAction: string

export const plugin: Plugin = {
  init: async (ctx: Context, initParams: PluginInitParams) => {
    api = initParams.API

    let feeds = await api.GetSetting(ctx, "feeds")
    if (feeds) {
      let feedList = JSON.parse(feeds) as Feed[]
      await api.Log(ctx, "Info", "load feeds: " + feedList.length)
      await start(ctx, feedList, api)
    }

    primaryAction = await api.GetSetting(ctx, "primaryAction") || "open"

    await api.OnSettingChanged(ctx, async (key: string, value: string) => {
      if (key === "feeds") {
        let feedList = JSON.parse(value) as Feed[]
        await api.Log(ctx, "Info", "feeds updated: " + feedList.length)
        await start(NewContext(), feedList, api)
      }
      if (key === "primaryAction") {
        primaryAction = value
      }
    })

    await api.OnUnload(ctx, async () => {
      await api.Log(ctx, "Info", "start unloading plugin")
      await stop(ctx)
    })
  },

  query: async (ctx: Context, query: Query): Promise<Result[]> => {
    let items = getFeedItems()
    items = items.filter((item) => {
      if (query.Search === "") {
        return true
      }

      return item.title.toLowerCase().includes(query.Search.toLowerCase())
    })

    const totalUnreadCount = items.filter((item) => !item.isRead).length
    const totalReadCount = items.filter((item) => item.isRead).length

    return items.map((item) => {
      //get base domain url from link
      const url = new URL(item.link)
      const domain = `${url.protocol}//${url.hostname}`
      return {
        Title: item.title,
        SubTitle: dayjs(item.date).format("YYYY-MM-DD HH:mm:ss"),
        Score: dayjs(item.date).unix(),
        Icon: {
          ImageType: "url",
          ImageData: `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${domain}&size=32`
        } as WoxImage,
        Group: item.isRead ? `Read (${totalReadCount})` : `Unread (${totalUnreadCount})`,
        GroupScore: item.isRead ? 0 : 10,
        Tails: [
          {
            Type: "text",
            Text: item.feed.title
          }
        ],
        Actions: [
          {
            Name: "Open",
            IsDefault: primaryAction === "open",
            Hotkey: primaryAction === "open" ? "Enter" : "Cmd+Enter",
            Action: async (actionContext: ActionContext) => {
              await open(item.link)
              await markAsRead(NewContext(), item.link)
              await api.ChangeQuery(ctx, {
                QueryType: "input",
                QueryText: query.RawQuery
              })
            }
          },
          {
            Name: "Mark as read",
            IsDefault: primaryAction === "mark",
            Hotkey: primaryAction === "mark" ? "Enter" : "Cmd+Enter",
            PreventHideAfterAction: true,
            Action: async (actionContext: ActionContext) => {
              await markAsRead(NewContext(), item.link)
              await api.ChangeQuery(ctx, {
                QueryType: "input",
                QueryText: query.RawQuery
              })
            }
          },
          {
            Name: `Mark all in ${item.feed.title} as read`,
            PreventHideAfterAction: true,
            Action: async () => {
              await markAllAsReadInFeed(NewContext(), item.feed.url)
              await api.ChangeQuery(ctx, {
                QueryType: "input",
                QueryText: query.RawQuery
              })
            }
          },
          {
            Name: "Mark all as read",
            PreventHideAfterAction: true,
            Action: async () => {
              await markAllAsRead(NewContext())
              await api.ChangeQuery(ctx, {
                QueryType: "input",
                QueryText: query.RawQuery
              })
            }
          }
        ]
      } as Result
    })
  }
}
