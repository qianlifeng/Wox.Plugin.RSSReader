import { parseFeed } from "../rss"
import { NewContext } from "@wox-launcher/wox-plugin"

test("parseFeed", async () => {
  let items = await parseFeed(NewContext(), "https://rsshub.app/v2ex/topics/hot")
  expect(items.length).toBeGreaterThan(0)
})
