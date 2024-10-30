import SettingsManager from "js/settings-manager";
import browser from "webextension-polyfill";
import { HostName, StatusMap, PixivId, PostsMap, UploadExtensionCommunicationError } from "js/types";

type PixivIdToPostIds = { [key in string]: string[] }

interface Post {
    id: string | number
    source: string
}

interface ArtistInfo {
    name: string
    isBanned: boolean
}

// const UPLOAD_EXTENSION = "ilemnfmnoanhiapnbdjolbojmpkbhbnp"
const UPLOAD_EXTENSION = "llikndljbekkdmncapkldffgliknjcdc"
const PIXIV_TABS_KEY = "pixivTabs"
const StatusMapKeys: { [key in HostName]: string } = {
    [HostName.Gelbooru]: "pixivIdToGelbooruIds",
    [HostName.Danbooru]: "pixivIdToDanbooruIds"
}
const allHosts = Object.values(HostName) as HostName[]

async function getPostsForPixivIds(pixivIds: string[], hosts?: HostName[]): Promise<StatusMap> {
    if (!hosts) hosts = allHosts
    const storageKeys = hosts.map(host => StatusMapKeys[host])
    const localData = await browser.storage.local.get(storageKeys)
    const statusMap: StatusMap = {}
    for (const pixivId of pixivIds) {
        statusMap[pixivId] = {}
        for (let i = 0; i < hosts.length; ++i) {
            if (!localData[storageKeys[i]]) continue
            const pixivIdToPostIds = localData[storageKeys[i]] as PixivIdToPostIds
            if (pixivId in pixivIdToPostIds) {
                statusMap[pixivId][hosts[i]] = pixivIdToPostIds[pixivId]
            }
        }
    }
    return statusMap
}

function getPixivIdFromUrl(urlString: string): string {
    if (!urlString) return ""
    let url
    try {
        url = new URL(urlString)
    } catch (error) {
        return ""
    }
    if (!url) return ""
    if (url.host === "www.pixiv.net") {
        if (url.searchParams.has("illust_id")) {
            return url.searchParams.get("illust_id")!
        }
        const pathParts = url.pathname.split("/")
        if (pathParts.length === 0) return "" 
        const lastPart = pathParts[pathParts.length - 1]
        if (!isNaN(lastPart as any)) return lastPart
    } else if (url.host === "i.pximg.net") {
        const match = url.pathname.match(/(\d+)_p\d+/)
        return match !== null ? match[1] : ""
    }
    return ""
}

async function getPostsForArtistTag(artistTag: string, host: HostName): Promise<PixivIdToPostIds> {
    let response: { error?: string, posts: Post[] }
    try {
        response = await browser.runtime.sendMessage(UPLOAD_EXTENSION, {
            type: "query-host",
            args: { tags: [artistTag], host }
        })
    } catch (error) {
        throw new UploadExtensionCommunicationError()
    }
    if (response.error) throw new Error(response.error)
    const pixivIdToPostIds: PixivIdToPostIds = {}
    for (const post of response.posts) {
        const pixivId = getPixivIdFromUrl(post.source)
        if (!pixivId) continue
        const postId = post.id.toString()
        if (pixivId in pixivIdToPostIds) {
            pixivIdToPostIds[pixivId].push(postId)
        } else {
            pixivIdToPostIds[pixivId] = [postId]
        }
    }
    return pixivIdToPostIds
}

async function searchForArtists(url: string): Promise<ArtistInfo[]> {
    let response: { error?: string, artists: ArtistInfo[] }
    try {
        response = await browser.runtime.sendMessage(UPLOAD_EXTENSION, {
            type: "query-artist-database",
            args: { url }
        })
    } catch (error) {
        throw new UploadExtensionCommunicationError()
    }
    if (response.error) throw new Error(response.error)
    return response.artists
}

async function handleArtistStatusCheck(url: string, hosts: HostName[]) {
    const artistInfos = await searchForArtists(url)
    if (artistInfos.length === 0) {
        return { pixivIds: [], numPosts: {} }
    }
    const pixivIdSet = new Set<PixivId>()
    const numPosts: { [key in HostName]?: number } = {}
    const statusMap: StatusMap = {}
    for (const { name, isBanned } of artistInfos) {
        for (const host of hosts) {
            numPosts[host] = 0
            const artistStatusMap = await getPostsForArtistTag(name, host)
            for (const pixivId in artistStatusMap) {
                const postIds = artistStatusMap[pixivId]
                if (!(pixivId in statusMap)) {
                    statusMap[pixivId] = { [host]: postIds }
                    pixivIdSet.add(pixivId)
                    numPosts[host]! += postIds.length
                } else {
                    if (!(host in statusMap[pixivId])) {
                        statusMap[pixivId][host] = []
                    }
                    for (const postId of postIds) {
                        if (!statusMap[pixivId][host]!.includes(postId)) {
                            statusMap[pixivId][host]!.push(postId)
                            numPosts[host]! += 1
                        }
                    }
                }
            }
        }
    }
    handleUploadStatusUpdate({ pixivIdToPostIds: statusMap })
    return { pixivIds: [...pixivIdSet], numPosts }
}

interface StatusUpdate {
    pixivIdToPostIds: StatusMap
    filenameToPostIds?: StatusMap
    posts?: PostsMap
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
    const storedMaps: { [key in HostName]?: PixivIdToPostIds } = {}
    const { pixivIdToPostIds } = statusUpdate
    for (const pixivId in pixivIdToPostIds) {
        for (const key in pixivIdToPostIds[pixivId]) {
            const host = key as HostName
            const postIds = pixivIdToPostIds[pixivId][host]!
            if (!storedMaps[host]) {
                const key = StatusMapKeys[host]
                const localData = await browser.storage.local.get({ [key]: {} })
                storedMaps[host] = localData[key] as PixivIdToPostIds
            }
            const storedMap = storedMaps[host]!
            if (pixivId in storedMap) {
                for (const postId of postIds) {
                    if (!storedMap[pixivId].includes(postId)) {
                        storedMap[pixivId].push(postId)
                    }
                }
            } else {
                storedMap[pixivId] = [...postIds]
            }
        }
    }
    const storageUpdate: any = {}
    for (const key in storedMaps) {
        const host = key as HostName
        storageUpdate[StatusMapKeys[host]] = storedMaps[host]!
    }
    await browser.storage.local.set(storageUpdate)
}

async function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const fileReader = new FileReader()
        fileReader.onload = () => resolve(fileReader.result as string)
        fileReader.onerror = () => reject(fileReader.error)
        fileReader.readAsDataURL(blob)
    })
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
    const dataUrl = await blobToDataUrl(blob)
    port.postMessage({ type: "finished", data: { dataUrl }})
}

async function downloadPixivImage(url: string): Promise<string | null> {
    try {
        const response = await fetch(url)
        const blob = await response.blob()
        return blobToDataUrl(blob)
    } catch (error) {
        return null
    }
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
    if (request.type === "prepare-upload" || request.type === "focus-tab") {
        // Just forward messages with these types to the upload extension
        return browser.runtime.sendMessage(UPLOAD_EXTENSION, request)
    } else if (request.type === "find-posts-by-artist") {
        return handleArtistStatusCheck(args.url, args.hosts)
    } else if (request.type === "pixiv-status-update") {
        handleUploadStatusUpdate(args as StatusUpdate)
    } else if (request.type === "get-host-status") {
        return getPostsForPixivIds(args.pixivIds, args.hosts)
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

// Receive push updates from the upload extension
browser.runtime.onMessageExternal.addListener((request, sender) => {
    if (!sender.id || sender.id !== UPLOAD_EXTENSION) return
    if (!request && !request.type) return
    const args = request.args || {}
    if (request.type === "pixiv-status-update") {
        handleUploadStatusUpdate(args as StatusUpdate)
    } else if (request.type === "download-pixiv-image") {
        return downloadPixivImage(args.url).then(dataUrl => ({ dataUrl }))
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
