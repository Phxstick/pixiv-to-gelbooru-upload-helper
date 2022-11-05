import SettingsManager from "js/settings-manager";
import browser from "webextension-polyfill";

type PixivIdToGelbooruIds = { [key in string]: string[] }

interface GelbooruPost {
    id: string | number
    source: string
}

const GELBOORU_UPLOAD_EXTENSION = "ilemnfmnoanhiapnbdjolbojmpkbhbnp"
const ID_MAP_KEY = "pixivIdToGelbooruIds"
const PIXIV_TABS_KEY = "pixivTabs"

async function getGelbooruPostsForPixivIds(pixivIds: string[]): Promise<PixivIdToGelbooruIds> {
    const localData = await browser.storage.local.get({ [ID_MAP_KEY]: {} })
    const pixivIdToGelbooruIds = localData[ID_MAP_KEY] as PixivIdToGelbooruIds
    const gelbooruIds: PixivIdToGelbooruIds = {}
    for (const pixivId of pixivIds) {
        if (pixivId in pixivIdToGelbooruIds) {
            gelbooruIds[pixivId] = pixivIdToGelbooruIds[pixivId]
        }
    }
    return gelbooruIds
}

async function getGelbooruPostsForArtistTag(artistTag: string): Promise<PixivIdToGelbooruIds> {
    let response: { error?: string, posts: GelbooruPost[] }
    try {
        response = await browser.runtime.sendMessage(GELBOORU_UPLOAD_EXTENSION, {
            type: "query-gelbooru",
            args: { tags: [artistTag] }
        })
    } catch (error) {
        throw new Error("Gelbooru query failed.")
    }
    if (response.error) throw new Error(response.error)
    const pixivIdToGelbooruIds: PixivIdToGelbooruIds = {}
    for (const post of response.posts) {
        let pixivId = ""
        try {
            const url = new URL(post.source)
            if (!url || url.host !== "www.pixiv.net") continue
            if (url.searchParams.has("illust_id")) {
                pixivId = url.searchParams.get("illust_id")!
            } else {
                const pathParts = url.pathname.split("/")
                const lastPart = pathParts[pathParts.length - 1]
                if (!isNaN(lastPart as any)) {
                    pixivId = lastPart
                }
            }
        } catch (error) {
            // console.log("ERROR parsing source URL:", post.source)
        }
        if (!pixivId) continue
        const gelbooruId = post.id.toString()
        if (pixivId in pixivIdToGelbooruIds) {
            pixivIdToGelbooruIds[pixivId].push(gelbooruId)
        } else {
            pixivIdToGelbooruIds[pixivId] = [gelbooruId]
        }
    }
    return pixivIdToGelbooruIds
}

async function getArtistTags(url: string): Promise<string[]> {
    let response: { error?: string, html: string }
    response = await browser.runtime.sendMessage(GELBOORU_UPLOAD_EXTENSION, {
        type: "query-artist-database",
        args: { url }
    })
    if (response.error) throw new Error(response.error)
    // Extract artist tags from the HTML document
    // (NOTE: DOMParser is not available in service worker in manifest v3,
    // use regex instead and risk the apocalypse)
    const regex = /<a class="tag-type-1".*?>([^<]*)<\/a>/g
    return [...response.html.matchAll(regex)].map(match => match[1].trim())
}

async function handleArtistStatusCheck(url: string) {
    const artistTags = await getArtistTags(url)
    let numPixivIds = 0
    let numGelbooruPosts = 0
    if (artistTags.length === 0) {
        return { numPixivIds, numGelbooruPosts }
    }
    const pixivIdToGelbooruIds: PixivIdToGelbooruIds = {}
    for (const artistTag of artistTags) {
        const artistStatusMap = await getGelbooruPostsForArtistTag(artistTag)
        for (const pixivId in artistStatusMap) {
            const gelbooruIds = artistStatusMap[pixivId]
            if (!(pixivId in pixivIdToGelbooruIds)) {
                pixivIdToGelbooruIds[pixivId] = gelbooruIds
                numGelbooruPosts += gelbooruIds.length
                numPixivIds++
            } else {
                for (const gelbooruId of gelbooruIds) {
                    if (!pixivIdToGelbooruIds[pixivId].includes(gelbooruId)) {
                        pixivIdToGelbooruIds[pixivId].push(gelbooruId)
                        numGelbooruPosts++
                    }
                }
            }
        }
    }
    handleUploadStatusUpdate({ pixivIdToGelbooruIds })
    return { numPixivIds, numGelbooruPosts }
}

interface StatusUpdate {
    pixivIdToGelbooruIds: PixivIdToGelbooruIds
    filenameToGelbooruIds?: { [key in string]: string[] }
}
async function handleUploadStatusUpdate(statusUpdate: StatusUpdate) {
    // Notify all opened Pixiv tabs of this status update
    const sessionData = await browser.storage.session.get({ [PIXIV_TABS_KEY]: [] })
    const pixivTabs = sessionData[PIXIV_TABS_KEY] as number[]
    const tabUpdatePromises = []
    const invalidTabs = new Set()
    for (const tabId of pixivTabs) {
        tabUpdatePromises.push(browser.tabs.sendMessage(tabId, {
            type: "pixiv-status-update",
            args: statusUpdate
        }).catch(() => {
            // Remove tabs that cannot be reached (Pixiv is no longer opened)
            invalidTabs.add(tabId)
        }))
    }
    Promise.allSettled(tabUpdatePromises).then(() => {
        const filteredTabs = pixivTabs.filter(tabId => !invalidTabs.has(tabId))
        if (pixivTabs.length !== filteredTabs.length) {
            browser.storage.session.set({ [PIXIV_TABS_KEY]: filteredTabs })
        }
    })

    // Add new data to mapping in local storage
    const localData = await browser.storage.local.get({ [ID_MAP_KEY]: {} })
    const storedPixivIdToGelbooruIds = localData[ID_MAP_KEY] as PixivIdToGelbooruIds
    const { pixivIdToGelbooruIds } = statusUpdate
    for (const pixivId in pixivIdToGelbooruIds) {
        const gelbooruIds = pixivIdToGelbooruIds[pixivId]
        if (pixivId in storedPixivIdToGelbooruIds) {
            for (const gelbooruId of gelbooruIds) {
                if (!storedPixivIdToGelbooruIds[pixivId].includes(gelbooruId)) {
                    storedPixivIdToGelbooruIds[pixivId].push(gelbooruId)
                }
            }
        } else {
            storedPixivIdToGelbooruIds[pixivId] = [...gelbooruIds]
        }
    }
    await browser.storage.local.set({ [ID_MAP_KEY]: storedPixivIdToGelbooruIds })
}

async function handleImageDownload(url: string, port: browser.Runtime.Port) {
    const imgResponse = await fetch(url)
    const reader = imgResponse.body!.getReader()
    const totalSize = parseInt(imgResponse.headers.get("Content-Length") || "0")
    port.postMessage({ type: "started", data: { totalSize }})
    const imageParts: Uint8Array[] = []
    let currentSize = 0
    while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        imageParts.push(value)
        currentSize += value.length
        port.postMessage({ type: "progress", data: { currentSize, totalSize }})
    }
    const blob = new Blob(imageParts)
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const fileReader = new FileReader()
        fileReader.onload = () => resolve(fileReader.result as string)
        fileReader.onerror = () => reject(fileReader.error)
        fileReader.readAsDataURL(blob)
    })
    port.postMessage({ type: "finished", data: { dataUrl }})
}

browser.runtime.onConnect.addListener((port) => {
    if (port.name === "image-download") {
        port.onMessage.addListener((message) => {
            if (message.type === "start-download") {
                handleImageDownload(message.data.url, port)
            }
        })
    }
})

browser.runtime.onMessage.addListener(async (request, sender) => {
    if (sender.id !== browser.runtime.id) return
    if (!request.type) return
    const args = request.args || {}
    if (request.type === "handle-artist-url") {
        return handleArtistStatusCheck(args.url)
    } else if (request.type === "pixiv-status-update") {
        handleUploadStatusUpdate(args as StatusUpdate)
    } else if (request.type === "get-gelbooru-status") {
        return getGelbooruPostsForPixivIds(args.pixivIds)
    } else if (request.type === "get-settings") {
        return SettingsManager.getAll()
    } else if (request.type === "settings-changed") {
        const sessionData = await browser.storage.session.get({ [PIXIV_TABS_KEY]: [] })
        const pixivTabs = sessionData[PIXIV_TABS_KEY] as number[]
        const settings = await SettingsManager.getAll()
        for (const tabId of pixivTabs) {
            browser.tabs.sendMessage(tabId, {
                type: "settings-changed",
                args: { settings }
            }).catch(() => {})
        }
    }
})

// Downloading images from Pixiv requires setting "referer" header
browser.runtime.onInstalled.addListener(async () => {
    const rules = [{
        id: 1,
        action: {
            type: "modifyHeaders",
            requestHeaders: [{
                header: "Referer",
                operation: "set",
                value: "https://www.pixiv.net/"
            }]
        },
        condition: {
            domains: [browser.runtime.id],
            urlFilter: "|https://i.pximg.net/",
            resourceTypes: ["xmlhttprequest"]
        }
    }]
    await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: rules.map(r => r.id),
        addRules: rules
    })
})

// Receive push updates from Gelbooru upload extension
browser.runtime.onMessageExternal.addListener((request, sender) => {
    if (!sender.id || sender.id !== GELBOORU_UPLOAD_EXTENSION) return
    if (!request && !request.type) return
    const args = request.args || {}
    if (request.type === "pixiv-status-update") {
        handleUploadStatusUpdate(args as StatusUpdate)
    }
})

// Update mapping from tab IDs to pixiv IDs when a tab is closed or its URL changes
// (NOTE: tabs where URL changes from Pixiv to a different page are not detected here,
// those tabs get deleted when a status update takes place, see further above)
browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo.url === undefined) return
    const url = new URL(changeInfo.url)
    if (url.hostname !== "www.pixiv.net") return
    const sessionData = await browser.storage.session.get({ [PIXIV_TABS_KEY]: [] })
    const pixivTabs = sessionData[PIXIV_TABS_KEY] as number[]
    if (pixivTabs.includes(tabId)) {
        browser.tabs.sendMessage(tabId, { type: "url-changed" })
    } else {
        pixivTabs.push(tabId)
        await browser.storage.session.set({ [PIXIV_TABS_KEY]: pixivTabs })
    }
})
browser.tabs.onRemoved.addListener(async (tabId) => {
    const sessionData = await browser.storage.session.get({ [PIXIV_TABS_KEY]: [] })
    const pixivTabs = sessionData[PIXIV_TABS_KEY] as number[]
    const tabIndex = pixivTabs.indexOf(tabId)
    if (tabIndex < 0) return
    pixivTabs.splice(tabIndex, 1)
    await browser.storage.session.set({ [PIXIV_TABS_KEY]: pixivTabs })
})