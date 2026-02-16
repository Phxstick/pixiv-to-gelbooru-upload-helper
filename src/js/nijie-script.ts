import browser from "webextension-polyfill";
import ThumbnailStatus from "./thumbnail-status";
import ArtistCheck from "./artist-check";
import ArtworkOverlay from "./artwork-overlay";
import SettingsManager from "./settings-manager";
import { ArtworkTags, Settings, PostHost, ThumbnailSize, GetArtworkHandler, MessageType, SourceHost, Message } from "./types";
import { announceError, isEqual, parseDescription } from "./utility"
import "./pixiv-script.scss"

enum Container {
    AdjacentPics = "adjacent-pics",
    ArtistPics = "pics-by-artist",
    RelatedPics = "related-pics"
}

const thumbnailStatus = new ThumbnailStatus(SourceHost.Nijie)
const artistCheck =  new ArtistCheck(SourceHost.Nijie)

let currentSettings = SettingsManager.getDefaultValues();
const settingsLoaded = browser.runtime.sendMessage({ type: "get-settings" }).then(updateSettings)
thumbnailStatus.setHosts(currentSettings.enabledHosts as PostHost[])

function applySettings(changedSettings?: Set<keyof Settings>) {
    const hasChanged = (key: keyof Settings) => !changedSettings || changedSettings.has(key)
    if (hasChanged("hideRelatedPixivPics")) {
        const recommendationsContainer = document.getElementById("nuitahito")
        if (recommendationsContainer) {
            recommendationsContainer.style.display = currentSettings.hideRelatedPixivPics ? "none" : "block"
            if (!currentSettings.hideRelatedPixivPics) {
                for (const child of recommendationsContainer.children) {
                    const container = child as HTMLElement
                    thumbnailStatus.manage([{ container, size: "large" }])
                }
            }
        }
    }
    if (hasChanged("hidePixivHeader")) {
        const header = document.getElementById("header-Container")
        if (header) {
            header.style.display = currentSettings.hidePixivHeader ? "none" : "block"
        }
    }
    if (hasChanged("showThumbnailStatus")) {
        thumbnailStatus.toggle(currentSettings.showThumbnailStatus)
    }
    if (hasChanged("showPostScore")) {
        ArtworkOverlay.togglePostScores(currentSettings.showPostScore)
    }
    if (hasChanged("enabledHosts")) {
        thumbnailStatus.setHosts(currentSettings.enabledHosts as PostHost[])
        ArtworkOverlay.updateHosts(currentSettings.enabledHosts as PostHost[])
    }
    if (hasChanged("defaultHost")) {
        ArtworkOverlay.updateDefaultHost(currentSettings.defaultHost as PostHost)
    }
}

async function updateSettings(settings: Settings): Promise<Set<keyof Settings>> {
    const changedSettings = new Set<keyof Settings>()
    for (const setting in settings) {
        const settingKey = setting as keyof Settings
        if (!isEqual(settings[settingKey], currentSettings[settingKey])) {
            // For some reason, this line leads to a type error, no idea why
            // currentSettings[settingKey] = settings[settingKey]
            currentSettings = { ...currentSettings, [settingKey]: settings[settingKey] }
            changedSettings.add(settingKey)
        }
    }
    return changedSettings
}

function getTitleAndDescription(): { title?: string, description?: string } {
    const data: { title?: string, description?: string } = {}

    // Get title
    const titleElement = document.querySelector("#view-header .illust_title")
    if (titleElement === null) {
        throw new Error("Failed to extract artwork title!")
    }
    data.title = titleElement.textContent

    // Get description
    const descriptionElement = document.querySelector("#illust_text p")
    if (descriptionElement === null) {
        throw new Error("Failed to extract artwork description!")
    }
    data.description = parseDescription(descriptionElement)
    
    return data
}

function gatherArtworkTags(): ArtworkTags {
    const tagWrappers = document.querySelectorAll("#view-tag .tag .tag_name")
    const artworkTags: ArtworkTags = {}
    for (const tagWrapper of tagWrappers) {
        const tagName = tagWrapper.children[0].textContent
        artworkTags[tagName] = ""
    }
    return artworkTags
}

const getArtwork: GetArtworkHandler = (clickedImg) => {
    if (clickedImg.closest("#img_filter") === null) return null
    return {
        url: clickedImg.src,
        container: clickedImg.closest("#img_filter") as HTMLElement
    }
}

// Ctrl + click an image to add the original version of it to an upload tab 
function getArtworkCheckListener(getArtwork: GetArtworkHandler) {
    return async (event: MouseEvent) => {
        if (!event.ctrlKey && !event.metaKey) return
        const target = event.target as HTMLElement
        if (target.tagName !== "IMG") return
        const clickedImg = target as HTMLImageElement

        // Get URL of original image and container of preview image
        const result = getArtwork(clickedImg)
        if (result === null) return
        const { url, container: imgContainer } = result
        event.stopPropagation()
        event.preventDefault()

        // If this image was already handled before, display existing overlay
        const existingOverlay = ArtworkOverlay.getOverlay(imgContainer)
        if (existingOverlay !== undefined) {
            existingOverlay.show()
            if (event.shiftKey) existingOverlay.selectHost()
            return
        }

        // Extract artwork title, description and tags from the page
        const tags = gatherArtworkTags()
        let title: string | undefined
        let description: string | undefined
        try {
            ({ title, description } = getTitleAndDescription());
        } catch (error) {
            const message = error instanceof Error ? error.message : "<no message>"
            if (!PRODUCTION) {
                window.alert("Error parsing title or description: " + message)
            }
        }

        // Create new overlay, download and check image
        const artworkOverlay = new ArtworkOverlay(imgContainer, url, { tags, title, description })
        artworkOverlay.setHosts(currentSettings.enabledHosts as PostHost[])
        artworkOverlay.show()
        if (event.shiftKey) {
            artworkOverlay.selectHost()
        } else {
            artworkOverlay.check(event.altKey ?
                "all-hosts" : currentSettings.defaultHost as PostHost)
        }
    }
}
const artworkCheckListenerArgs = ["click", getArtworkCheckListener(getArtwork), { capture: true }] as const


function handleArtworkPage() {
    document.removeEventListener(...artworkCheckListenerArgs)
    document.addEventListener(...artworkCheckListenerArgs)
    ArtworkOverlay.clear()

    const adjacentPicsContainer = document.getElementById("content-menu")
    if (adjacentPicsContainer && !adjacentPicsContainer.id)
        adjacentPicsContainer.id = Container.AdjacentPics
    
    const relatedPicsContainer = document.getElementById("nuitahito")
    if (relatedPicsContainer && !relatedPicsContainer.id)
        relatedPicsContainer.id = Container.RelatedPics

    settingsLoaded.then(() => {
        applySettings()
        const containers: { container: HTMLElement, size: ThumbnailSize }[] = []
        if (!currentSettings.hideOtherPicsByArtist) {
            if (adjacentPicsContainer)
                containers.push({ container: adjacentPicsContainer, size: "small" })
        }
        if (!currentSettings.hideRelatedPixivPics) {
            if (relatedPicsContainer)
                containers.push({ container: relatedPicsContainer, size: "large" })
        }
        thumbnailStatus.manage(containers)
    })

    // Click containers with artist name and profile to check artist posts
    // TODO
}

function handleListingPage() {
    // TODO
    // settingsLoaded.then(() => {
    //     applySettings()
    //     thumbnailStatus.manage([{ container: listing, size: "large" }])
    // })

    // Click artist name or profile picture to check artist posts
    // TODO
}

let pageType: string | undefined

function main() {
    const url = new URL(location.href)
    console.log("Page loaded!")

    let newPageType: string | undefined
    if (url.pathname === "/view.php" || url.pathname === "/view_popup.php") {
        newPageType = "post"
    } else if (url.pathname === "/members_illust.php") {
        newPageType = "listing"
    } else if (url.pathname === "/search.php") {
        newPageType = "tag"
    }
    if (pageType === newPageType) return
    pageType = newPageType;

    if (pageType === "post") {
        announceError(() => handleArtworkPage())
    } else if (pageType === "listing" || pageType === "tag") {
        announceError(() => handleListingPage())
    }
}

browser.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== browser.runtime.id) return
    if (!message || !message.type) return
    const { type, args } = message as Message

    // Extension will send notification if an upload status changes
    if (type === MessageType.StatusUpdate) {
        const { sourceHost, sourceIdToPostIds, filenameToPostIds, posts } = args
        if (sourceHost === SourceHost.Nijie) {
            thumbnailStatus.update(sourceIdToPostIds)
            if (filenameToPostIds) {
                for (const filename in filenameToPostIds) {
                    const statusUpdate = filenameToPostIds[filename]
                    ArtworkOverlay.update(filename, statusUpdate, posts)
                }
            }
        }
    }

    else if (type === MessageType.SettingsChanged) {
        updateSettings(args.settings).then(changedSettings => {
            if (changedSettings.size) applySettings(changedSettings)
        })
    }
})

main()
