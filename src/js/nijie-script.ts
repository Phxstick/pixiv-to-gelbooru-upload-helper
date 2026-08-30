import browser from "webextension-polyfill";
import ThumbnailStatus from "./thumbnail-status";
import ArtistCheck from "./artist-check";
import ArtworkOverlay from "./artwork-overlay";
import SettingsManager from "./settings-manager";
import { ArtworkTags, Settings, PostHost, ThumbnailSize, GetArtworkHandler, MessageType, SourceHost, Message } from "./types";
import { announceError, isEqual, parseDescription } from "./utility"
import "./base.scss"
import "./nijie.scss"
import { Nijie } from "./nijie";

enum Container {
    AdjacentPics = "adjacent-pics",
    ArtistPics = "pics-by-artist",
    RelatedPics = "related-pics"
}

const nijieInterface = new Nijie()
const thumbnailStatus = new ThumbnailStatus(nijieInterface)
const artistCheck =  new ArtistCheck(SourceHost.Nijie)

let currentSettings = SettingsManager.getDefaultValues();
const settingsLoaded = browser.runtime.sendMessage({ type: "get-settings" }).then(updateSettings)
thumbnailStatus.setHosts(currentSettings.enabledHosts as PostHost[])

function handleSublists(container: HTMLElement, size: ThumbnailSize) {
    const containers = []
    for (const child of container.children) {
        containers.push({ container: child as HTMLElement, size })
    }
    thumbnailStatus.manage(containers)
}

function handleOtherPicsByArtist() {
    const wrappers = document.querySelectorAll("#nuitahito")
    const picsByArtistContainer = wrappers.length > 1 ? wrappers[0] as HTMLElement : null
    if (picsByArtistContainer) {
        picsByArtistContainer.classList.toggle("hidden", currentSettings.hideOtherPicsByArtist)
        if (!currentSettings.hideOtherPicsByArtist) {
            handleSublists(picsByArtistContainer, "large")
        }
    }
    const headers = document.querySelectorAll("#nuitahito_index")
    const picsByArtistHeader = headers.length > 1 ? headers[0] as HTMLElement : null
    if (picsByArtistHeader) {
        picsByArtistHeader.classList.toggle("hidden", currentSettings.hideOtherPicsByArtist)
    }
    const adjacentPicsContainer = document.getElementById("content-menu")
    if (adjacentPicsContainer) {
        adjacentPicsContainer.classList.toggle("hidden", currentSettings.hideOtherPicsByArtist)
        if (!currentSettings.hideOtherPicsByArtist) {
            thumbnailStatus.manage([{ container: adjacentPicsContainer, size: "small" }])
        }
    }
}

function handleRecommendations() {
    const wrappers = document.querySelectorAll("#nuitahito")
    const recommendationsContainer = wrappers[wrappers.length - 1] as HTMLElement
    const headers = document.querySelectorAll("#nuitahito_index")
    const recommendationsHeader = headers[headers.length - 1] as HTMLElement

    if (!recommendationsContainer || !recommendationsHeader) return
    if (recommendationsContainer) {
        recommendationsContainer.classList.toggle("hidden", currentSettings.hideRelatedPixivPics)
        if (!currentSettings.hideRelatedPixivPics) {
            handleSublists(recommendationsContainer, "large")
        }
    }
    if (recommendationsHeader) {
        recommendationsHeader.classList.toggle("hidden", currentSettings.hideRelatedPixivPics)
    }
}

function applySettings(changedSettings?: Set<keyof Settings>) {
    const hasChanged = (key: keyof Settings) => !changedSettings || changedSettings.has(key)
    if (hasChanged("hideRelatedPixivPics")) {
        handleRecommendations()
    }
    if (hasChanged("hideOtherPicsByArtist")) {
        handleOtherPicsByArtist()
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

    // Make image expand further and highlight it according to upload status
    const imgFilter = document.getElementById("img_filter") as HTMLElement | null
    if (imgFilter) {
        imgFilter.style.height = "100vh"
        const image = imgFilter.querySelector("img") as HTMLElement | null
        if (image) {
            image.style.maxHeight = "100vh"
            image.style.maxWidth = "unset"
            // Don't fade out image upon hovering
            image.style.setProperty("opacity", "1", "important")
        }
        thumbnailStatus.manage([{ container: imgFilter, size: "huge" }])
        // Add a gap between the main image and its variants
        const variantsContainer = document.getElementById("img_diff")
        if (variantsContainer) variantsContainer.style.marginTop = "10px"
    }

    // Move title, tags and buttons below the picture (in the same order as on Pixiv)
    const detailsContainers = document.querySelectorAll("#view-middle")
    const lowerContainer = detailsContainers[detailsContainers.length - 1]
    if (lowerContainer) {
        const titleElement = document.getElementById("view-header")
        const tagsContainer = document.getElementById("view-tag")
        const buttonsContainer = document.getElementById("view-center-button")
        const dateElement = document.querySelector("#view-honbun :first-child") as HTMLElement | null
        if (titleElement) {
            lowerContainer.prepend(titleElement)
            titleElement.style.textAlign = "left"
        }
        if (buttonsContainer) lowerContainer.prepend(buttonsContainer)
        if (tagsContainer) {
            lowerContainer.appendChild(tagsContainer)
            tagsContainer.style.marginBottom = "0"
        }
        if (dateElement) {
            lowerContainer.appendChild(dateElement)
            dateElement.style.textAlign = "left"
            dateElement.style.marginLeft = "15px"
        }
    }

    // Move adjacent pics below the image details
    const adjacentPicsContainer = document.getElementById("content-menu")
    const mainContainer = document.getElementById("view-center")
    if (mainContainer && adjacentPicsContainer) {
        mainContainer.appendChild(adjacentPicsContainer)
    }

    // Remove comments
    const commentBlock = document.getElementById("member_comment_block")
    commentBlock?.remove()
    const comments = document.querySelectorAll(".members_comment_block")
    for (const comment of comments) {
        comment.remove()
    }

    // Remove footer
    document.getElementById("bottom")?.remove()

    settingsLoaded.then(() => {
        applySettings()
        handleOtherPicsByArtist()
        handleRecommendations()
    })

    // Click containers with artist name and profile to check artist posts
    // TODO
}

function handleListingPage() {
    settingsLoaded.then(() => {
        applySettings()
        const listings = [...document.querySelectorAll(".mem-index")] as HTMLElement[]
        thumbnailStatus.manage(listings.map(container => ({ container, size: "medium" })))
    })

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
    } else if (["/members.php", "/members_illust.php"].includes(url.pathname)) {
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
