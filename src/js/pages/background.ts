import SettingsManager from "js/settings-manager";
import browser from "webextension-polyfill";
import { PostHost, StatusMap, SourceId, UploadExtensionCommunicationError, StatusUpdate, MessageType, Message, SourceHost, PostId } from "js/types";
import { capitalize } from "js/utility";

type SourceIdToPostIds = { [key in SourceId]: PostId[] }

interface Post {
    id: string | number
    source: string
}

interface ArtistInfo {
    name: string
    isBanned: boolean
}

const UPLOAD_EXTENSION_STORE_ID = "ilemnfmnoanhiapnbdjolbojmpkbhbnp"
const UPLOAD_EXTENSION = PRODUCTION ? UPLOAD_EXTENSION_STORE_ID :
    (UPLOAD_EXTENSION_ID || UPLOAD_EXTENSION_STORE_ID)

const sourceTabsKeys: Record<SourceHost, string> = {} as any // TODO: remove workaround
const statusMapKeys: Record<SourceHost, Record<PostHost, string>> = {} as any  // TODO: remove workaround
for (const sourceHost of Object.values(SourceHost)) {
    sourceTabsKeys[sourceHost] = `${sourceHost}Tabs`
    statusMapKeys[sourceHost] = {} as any  // TODO: remove workaround
    for (const destinationHost of Object.values(PostHost)) {
        statusMapKeys[sourceHost][destinationHost] =
            `${sourceHost}IdTo${capitalize(destinationHost)}Ids`
    }
}

const sourceHostnames: Record<string, SourceHost> = {
    "www.pixiv.net": SourceHost.Pixiv,
    "nijie.info": SourceHost.Nijie
}

const allSourceHosts = Object.values(SourceHost) as SourceHost[]
const allPostHosts = Object.values(PostHost) as PostHost[]

async function getPostsForSourceIds(sourceHost: SourceHost, sourceIds: string[], postHosts?: PostHost[]): Promise<StatusMap> {
    if (!postHosts) postHosts = allPostHosts
    const storageKeys = postHosts.map(host => statusMapKeys[sourceHost][host])
    const localData = await browser.storage.local.get(storageKeys)
    const statusMap: StatusMap = {}
    for (const sourceId of sourceIds) {
        statusMap[sourceId] = {}
        for (let i = 0; i < postHosts.length; ++i) {
            if (!localData[storageKeys[i]]) continue
            const sourceIdToPostIds = localData[storageKeys[i]] as SourceIdToPostIds
            if (sourceId in sourceIdToPostIds) {
                statusMap[sourceId][postHosts[i]] = sourceIdToPostIds[sourceId]
            }
        }
    }
    return statusMap
}

function getPixivIdFromUrl(url: URL): string {
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

function getNijieIdFromUrl(url: URL): string {
    if (url.host === "nijie.info") {
        if (url.pathname === "/view.php" || url.pathname === "/view_popup.php") {
            return url.searchParams.get("id") || ""
        }
    }
    return ""
}

function getSourceIdFromUrl(sourceHost: SourceHost, urlString: string): string {
    if (!urlString) return ""
    let url
    try {
        url = new URL(urlString)
    } catch (error) {
        return ""
    }
    switch (sourceHost) {
        case SourceHost.Pixiv: return getPixivIdFromUrl(url)
        case SourceHost.Nijie: return getNijieIdFromUrl(url)
        default: throw new Error()
    }
}

async function getPostsForArtistTag(sourceHost: SourceHost, artistTag: string, host: PostHost): Promise<SourceIdToPostIds> {
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
    const sourceIdToPostIds: SourceIdToPostIds = {}
    for (const post of response.posts) {
        const sourceId = getSourceIdFromUrl(sourceHost, post.source)
        if (!sourceId) continue
        const postId = post.id.toString()
        if (sourceId in sourceIdToPostIds) {
            sourceIdToPostIds[sourceId].push(postId)
        } else {
            sourceIdToPostIds[sourceId] = [postId]
        }
    }
    return sourceIdToPostIds
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

async function handleArtistStatusCheck(sourceHost: SourceHost, url: string, hosts: PostHost[]) {
    const artistInfos = await searchForArtists(url)
    if (artistInfos.length === 0) {
        return { sourceIds: [], numPosts: {} }
    }
    const sourceIdSet = new Set<SourceId>()
    const numPosts: { [key in PostHost]?: number } = {}
    const statusMap: StatusMap = {}
    for (const { name, isBanned } of artistInfos) {
        for (const host of hosts) {
            numPosts[host] = 0
            const artistStatusMap = await getPostsForArtistTag(sourceHost, name, host)
            for (const sourceId in artistStatusMap) {
                const postIds = artistStatusMap[sourceId]
                if (!(sourceId in statusMap)) {
                    statusMap[sourceId] = { [host]: postIds }
                    sourceIdSet.add(sourceId)
                    numPosts[host]! += postIds.length
                } else {
                    if (!(host in statusMap[sourceId])) {
                        statusMap[sourceId][host] = []
                    }
                    for (const postId of postIds) {
                        if (!statusMap[sourceId][host]!.includes(postId)) {
                            statusMap[sourceId][host]!.push(postId)
                            numPosts[host]! += 1
                        }
                    }
                }
            }
        }
    }
    handleUploadStatusUpdate({ sourceHost, sourceIdToPostIds: statusMap })
    return { sourceIds: [...sourceIdSet], numPosts }
}

async function handleUploadStatusUpdate(statusUpdate: StatusUpdate) {
    const { sourceHost, sourceIdToPostIds } = statusUpdate
    const sourceTabsKey = sourceTabsKeys[sourceHost]

    // Notify all opened source tabs of this status update
    const sessionData = await browser.storage.session.get({ [sourceTabsKey]: [] })
    const sourceTabs = sessionData[sourceTabsKey] as number[]
    const tabUpdatePromises = []
    const invalidTabs = new Set()
    for (const tabId of sourceTabs) {
        tabUpdatePromises.push(browser.tabs.sendMessage(tabId, {
            type: MessageType.StatusUpdate,
            args: statusUpdate
        }).catch(() => {
            // Remove tabs that cannot be reached (if source site is no longer open)
            invalidTabs.add(tabId)
        }))
    }
    Promise.allSettled(tabUpdatePromises).then(() => {
        const filteredTabs = sourceTabs.filter(tabId => !invalidTabs.has(tabId))
        if (sourceTabs.length !== filteredTabs.length) {
            browser.storage.session.set({ [sourceTabsKey]: filteredTabs })
        }
    })

    // Add new data to mapping in local storage
    const storedMaps: { [key in PostHost]?: SourceIdToPostIds } = {}
    for (const sourceId in sourceIdToPostIds) {
        for (const key in sourceIdToPostIds[sourceId]) {
            const postHost = key as PostHost
            const postIds = sourceIdToPostIds[sourceId][postHost]!
            if (!storedMaps[postHost]) {
                const statusMapKey = statusMapKeys[sourceHost][postHost]
                const localData = await browser.storage.local.get({ [statusMapKey]: {} })
                storedMaps[postHost] = localData[statusMapKey] as SourceIdToPostIds
            }
            const storedMap = storedMaps[postHost]!
            if (sourceId in storedMap) {
                for (const postId of postIds) {
                    if (!storedMap[sourceId].includes(postId)) {
                        storedMap[sourceId].push(postId)
                    }
                }
            } else {
                storedMap[sourceId] = [...postIds]
            }
        }
    }
    const storageUpdate: any = {}
    for (const key in storedMaps) {
        const postHost = key as PostHost
        storageUpdate[statusMapKeys[sourceHost][postHost]] = storedMaps[postHost]!
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
    const imageParts: Uint8Array<ArrayBuffer>[] = []
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

async function downloadImage(url: string): Promise<string | null> {
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
    } else if (request.type === MessageType.FindPostsByArtist) {
        return handleArtistStatusCheck(args.sourceHost, args.url, args.hosts)
    } else if (request.type === MessageType.StatusUpdate) {
        handleUploadStatusUpdate(args as StatusUpdate)
    } else if (request.type === MessageType.GetPostStatus) {
        return getPostsForSourceIds(args.sourceHost, args.sourceIds, args.postHosts)
    } else if (request.type === "get-settings") {
        return SettingsManager.getAll()
    } else if (request.type === MessageType.SettingsChanged) {
        for (const sourceHost of allSourceHosts) {
            const sourceTabKey = sourceTabsKeys[sourceHost]
            const sessionData = await browser.storage.session.get({ [sourceTabKey]: [] })
            const sourceTabs = sessionData[sourceTabKey] as number[]
            const settings = await SettingsManager.getAll()
            for (const tabId of sourceTabs) {
                browser.tabs.sendMessage(tabId, {
                    type: MessageType.SettingsChanged,
                    args: { settings }
                }).catch(() => {})
            }
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
    const { type, args } = request as Message
    if (type === MessageType.StatusUpdate) {
        handleUploadStatusUpdate(args)
    } else if (type === MessageType.DownloadImage) {
        return downloadImage(args.url).then(dataUrl => ({ dataUrl }))
    }
})

// Update mapping from tab IDs to source IDs when a tab is closed or its URL changes
// (NOTE: tabs where URL changes from a source to a different page are not detected here,
// those tabs get deleted when a status update takes place, see further above)
browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo.url === undefined) return
    const url = new URL(changeInfo.url)
    const sourceHost = sourceHostnames[url.hostname]
    if (!sourceHost) return
    // TODO: handle case where URL changes from one source to a different source
    const sourceTabsKey = sourceTabsKeys[sourceHost]
    const sessionData = await browser.storage.session.get({ [sourceTabsKey]: [] })
    const sourceTabs = sessionData[sourceTabsKey] as number[]
    if (sourceTabs.includes(tabId)) {
        browser.tabs.sendMessage(tabId, { type: MessageType.UrlChanged })
    } else {
        sourceTabs.push(tabId)
        await browser.storage.session.set({ [sourceTabsKey]: sourceTabs })
    }
})
browser.tabs.onRemoved.addListener(async (tabId) => {
    // TODO: merge storage access for all sources to reduce overhead
    for (const sourceHost of allSourceHosts) {
        const sourceTabsKey = sourceTabsKeys[sourceHost]
        const sessionData = await browser.storage.session.get({ [sourceTabsKey]: [] })
        const sourceTabs = sessionData[sourceTabsKey] as number[]
        const tabIndex = sourceTabs.indexOf(tabId)
        if (tabIndex < 0) continue
        sourceTabs.splice(tabIndex, 1)
        await browser.storage.session.set({ [sourceTabsKey]: sourceTabs })
    }
})
