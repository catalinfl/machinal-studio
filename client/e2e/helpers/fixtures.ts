import { expect, test as base } from '@playwright/test'

// Media bin previews fetch every scrub proxy from the server (~80 MB per page
// load) just to render thumbnails, which saturates the single-threaded API
// server and burns CPU decoding video. Tests only need the ready cards, so
// abort these downloads. In proxy mode /download is used exclusively for
// previews; drop/scrub flows use /scrub-proxy and are unaffected.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route('**/download?*', (route) => route.abort())
    await use(page)
  },
})

export { expect }
