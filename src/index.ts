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
import { Feed, getFeedItems, markAsRead, start } from "./rss"
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
  },

  query: async (ctx: Context, query: Query): Promise<Result[]> => {
    let items = getFeedItems()
    // sort by date desc
    items.sort((a, b) => {
      return new Date(b.date).getTime() - new Date(a.date).getTime()
    })

    items = items.filter((item) => {
      if (query.Search === "") {
        return true
      }

      return item.title.includes(query.Search)
    })

    const totalUnreadCount = items.filter((item) => !item.isRead).length
    const totalReadCount = items.filter((item) => item.isRead).length

    return items.map((item) => {
      return {
        Title: item.title,
        SubTitle: dayjs(item.date).format("YYYY-MM-DD HH:mm:ss"),
        Score: dayjs(item.date).unix(),
        Icon: {
          ImageType: "relative",
          ImageData: "images/app.png"
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
            Action: (actionContext: ActionContext) => {
              open(item.link)
              markAsRead(NewContext(), item.link)
              api.ChangeQuery(ctx, {
                QueryType: "input",
                QueryText: query.RawQuery
              })
            }
          },
          {
            Name: "Mark as Read",
            IsDefault: primaryAction === "mark",
            PreventHideAfterAction: true,
            Action: (actionContext: ActionContext) => {
              markAsRead(NewContext(), item.link)
              api.ChangeQuery(ctx, {
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
