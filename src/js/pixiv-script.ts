import browser from "webextension-polyfill";
import ThumbnailStatus from "./thumbnail-status";
import ArtistCheck from "./artist-check";
import ArtworkOverlay from "./artwork-overlay";
import SettingsManager from "./settings-manager";
import { PixivTags, Settings } from "./types";
import "./pixiv-script.scss"

const root = document.getElementById("root") as HTMLElement

const thumbnailStatus = new ThumbnailStatus()
const artistCheck =  new ArtistCheck()

const currentSettings = SettingsManager.getDefaultValues();
const settingsLoaded = browser.runtime.sendMessage({ type: "get-settings" }).then(updateSettings)

let stickyParent: HTMLElement
const stickyParentObserver = new MutationObserver(() => {
    const stickyElement = stickyParent.children[4]
    if (stickyElement) {
        (stickyElement as HTMLElement).style.position = "static"
    }
})

function applySettings(changedSettings?: Set<keyof Settings>) {
    const mainElement = document.querySelector("main")
    const hasChanged = (key: keyof Settings) => changedSettings ? changedSettings.has(key) : currentSettings[key]
    if (hasChanged("hideRelatedPixivPics")) {
        const listElements = [...root.querySelectorAll("aside ul")] as HTMLElement[]
        const relatedPicsContainer = listElements[listElements.length - 1]
        if (relatedPicsContainer) {
            const asideElement = relatedPicsContainer.closest("aside")
            if (asideElement) {
                asideElement.style.display = currentSettings.hideRelatedPixivPics ? "none" : "block"
            }
            if (mainElement !== null && mainElement.parentElement !== null) {
                mainElement.parentElement.style.paddingBottom = currentSettings.hideRelatedPixivPics ? "0" : "56px"
            }
        }
    }
    if (hasChanged("hidePixivHeader")) {
        if (root.children[1]) {
            const header = root.children[1].querySelector(":scope > div > div > div[style]") as HTMLElement | null
            if (header) {
                header.style.display = currentSettings.hidePixivHeader ? "none" : "block"
            }
            if (mainElement !== null && mainElement.parentElement !== null) {
                mainElement.parentElement.style.marginTop = currentSettings.hidePixivHeader ? "0" : "24px"
            }
        }
        // Make the bar below the pictures non-sticky
        const stickyParentElement = mainElement?.firstChild?.firstChild?.firstChild
        if (stickyParentElement) {
            stickyParent = stickyParentElement as HTMLElement
            stickyParentObserver.observe(stickyParent, { childList: true })
            const stickyElement = stickyParent.children[4]
            if (stickyElement) {
                (stickyElement as HTMLElement).style.position = "static"
            }
        }
    }
    if (hasChanged("showThumbnailStatus")) {
        thumbnailStatus.toggle(currentSettings.showThumbnailStatus)
    }
}

async function updateSettings(settings: Settings): Promise<Set<keyof Settings>> {
    const changedSettings = new Set<keyof Settings>()
    for (const setting in settings) {
        const settingKey = setting as keyof Settings
        if (settings[settingKey] !== currentSettings[settingKey]) {
            currentSettings[settingKey] = settings[settingKey]
            changedSettings.add(settingKey)
        }
    }
    return changedSettings
}

function gatherPixivTags(): PixivTags {
    const tagWrappers = document.querySelectorAll("footer ul > li > span")
    const pixivTags: PixivTags = {}
    for (const tagWrapper of tagWrappers) {
        let originalTag
        let translatedTag = ""
        if (tagWrapper.children[0].tagName === "A") {
            originalTag = tagWrapper.children[0].textContent!
        } else {
            originalTag = tagWrapper.children[0].children[0].textContent!
            if (tagWrapper.children.length > 1) {
                translatedTag = tagWrapper.children[1].children[0].textContent!
            }
        }
        pixivTags[originalTag] = translatedTag
    }
    return pixivTags
}

// Ctrl + click an image to add the original version of it to a Gelbooru upload tab 
document.addEventListener("click", async (event) => {
    if (!event.ctrlKey) return
    const target = event.target as HTMLElement
    if (target.tagName !== "IMG") return
    let img = target as HTMLImageElement

    // Find URL of the original version of the clicked image
    let url: string
    if (img.src.includes("img-original")) {
        url = img.src
        // Close the view with the original-size image
        img.click()
        // Add overlay to the resized preview instead (NOTE: the preview and original may have
        // different file types, e.g. JPG and PNG, so use a prefix-search to find preview img)
        const previewUrl = url.replace("img-original", "img-master")
            .replace(/_p(\d+)\./, "_p$1_master1200.").slice(0, -4)
        const previewImage = document.querySelector(`img[src^='${previewUrl}']`)
        if (previewImage === null) return
        img = previewImage as HTMLImageElement
    } else if (img.parentElement) {
        const href = img.parentElement.getAttribute("href")
        if (href !== null && href.includes("img-original")) {
            url = href
        } else {
            return
        }
    } else {
        return
    }
    event.stopPropagation()
    event.preventDefault()

    // If this image was already handled before, just display existing overlay
    const existingOverlay = ArtworkOverlay.getOverlay(img.parentElement!)
    if (existingOverlay !== undefined) {
        existingOverlay.show()
        return
    }

    // Otherwise create new overlay, download and check image
    const artworkOverlay = new ArtworkOverlay(img)
    artworkOverlay.show()
    const dataUrl = await artworkOverlay.downloadImage(url)
    const pixivTags = gatherPixivTags()
    artworkOverlay.conductCheck(dataUrl, url, pixivTags)
}, { capture: true })

// When a pixiv post from a different artist is clicked, the container with pictures
// from the current artist will be replaced, observe an ancestor to handle this case
const picsByArtistWrapperObserver = new MutationObserver(mutationList => {
    for (const mutation of mutationList) {
        if (mutation.addedNodes.length) {
            for (const node of mutation.addedNodes) {
                const element = node as HTMLElement
                if (element.querySelector("nav") !== null) {
                    const navElements = [...document.querySelectorAll("nav")!]
                    thumbnailStatus.clear()
                    handleArtworkPage(navElements)
                }
            }
        }
    }
})
// Also handle switching between listing
const listingWrapperObserver = new MutationObserver(mutationList => {
    for (const mutation of mutationList) {
        if (mutation.addedNodes.length) {
            for (const node of mutation.addedNodes) {
                const element = node as HTMLElement
                const section = element.querySelector("section")
                if (section === null) continue
                const listing = getListing(section)
                if (listing === null) continue
                thumbnailStatus.clear()
                thumbnailStatus.manage([{ container: listing, size: "large" }])
            }
        }
    }
})

function getListing(section: HTMLElement) {
    if (section.firstChild === null) return null
    const sectionHeader = section.firstChild.textContent!
    if (!sectionHeader.startsWith("Illustrations")
            && !sectionHeader.startsWith("Works")) return null
    return section.querySelector("ul")
}

function handleArtworkPage(navElements: HTMLElement[]) {
    settingsLoaded.then(() => applySettings())
    ArtworkOverlay.clear()

    const adjacentPicsContainer = navElements[1] as HTMLElement
    const picsByArtistContainer = navElements[0].children[0] as HTMLElement
    const relatedPicsContainer = document.querySelector("aside ul") as HTMLElement
    thumbnailStatus.manage([
        { container: adjacentPicsContainer, size: "small" },
        { container: picsByArtistContainer, size: "medium" },
        { container: relatedPicsContainer, size: "large" }
    ])

    const picsByArtistWrapper = navElements[0].parentElement!.parentElement!
    picsByArtistWrapperObserver.disconnect()
    picsByArtistWrapperObserver.observe(picsByArtistWrapper, { childList: true })

    // Click containers with artist name and profile to check artist posts
    const artistContainers = [...document.querySelectorAll("section h2 > div")].map(container => {
        const artistLinks = [...container.querySelectorAll("a[data-gtm-value]")] as HTMLAnchorElement[]
        const element = artistLinks[0].parentElement!
        const artistUrl = artistLinks[0].href
        return { element, artistUrl }
    })
    artistCheck.handleContainers(artistContainers)
}

function handleListingPage(listing: HTMLElement) {
    const listingWrapper = listing.closest("section")!.parentElement!.parentElement!
    listingWrapperObserver.disconnect()
    // Wrapper can be different on some pages, observe all possible candidates
    listingWrapperObserver.observe(listingWrapper, { childList: true })
    listingWrapperObserver.observe(listingWrapper.parentElement!, { childList: true })

    settingsLoaded.then(() => applySettings())
    thumbnailStatus.manage([{ container: listing, size: "large" }])

    // Click artist name or profile picture to check artist posts
    const artistNameDiv = document.querySelector("h1")!
    if (artistNameDiv !== null) {
        artistNameDiv.dataset.gtmValue = ""
        const artistImage = document.querySelectorAll("[role='img']")[1].parentElement as HTMLElement
        const artistUrl = window.location.href
        artistCheck.handleContainers([
            { element: artistNameDiv.parentElement!, artistUrl },
            { element: artistImage, artistUrl }
        ])
    }
}

// Pixiv content is loaded dynamically by scripts, so use  observers
// to wait for the required elements to appear before running other code
const postPageObserver = new MutationObserver((mutationList) => {
    // Some pages contain an additional hidden nav element, ignore that one
    // by filtering out elements with less than two classes
    const navElements = [...document.querySelectorAll("nav")!]
        .filter(el => el.classList.length >= 2)
    if (navElements.length < 2) return
    postPageObserver.disconnect()
    handleArtworkPage(navElements)
})
const listingPageObserver = new MutationObserver(() => {
    const sections = document.querySelectorAll("section")
    for (const section of sections) {
        const listing = getListing(section)
        if (listing === null) continue
        listingPageObserver.disconnect()
        handleListingPage(listing)
        return
    }
})

let pageType: string | undefined

function main() {
    if (location.href.includes("/artworks/")) {
        if (pageType === "post") return
        pageType = "post"
        postPageObserver.observe(root, { childList: true, subtree: true })
    } else if (location.href.includes("/users/")) {
        if (pageType === "listing") return
        pageType = "listing"
        listingPageObserver.observe(root, { childList: true, subtree: true })
    } else if (location.href.includes("/tags/")) {
        if (pageType === "tag") return
        pageType = "tag"
        listingPageObserver.observe(root, { childList: true, subtree: true })
    } else {
        pageType = undefined
    }
}

browser.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== browser.runtime.id) return
    if (!message || !message.type) return

    // Extension will send notification if an upload status on Gelbooru changes
    if (message.type === "pixiv-status-update") {
        if (!message.args) return
        thumbnailStatus.update(message.args.pixivIdToGelbooruIds)
        const fileMap = message.args.filenameToGelbooruIds
        if (fileMap) {
            for (const filename in fileMap) {
                ArtworkOverlay.update(filename, fileMap[filename])
            }
        }
    }

    // When clicking on a Pixiv link, it doesn't load an entirely new page,
    // so the content script is not executed again. Therefore, the background
    // page tells the content script when the URL in its page has changed
    else if (message.type === "url-changed") {
        main()
    }

    else if (message.type === "settings-changed") {
        if (!message.args) return
        updateSettings(message.args.settings).then(changedSettings => {
            if (changedSettings.size) applySettings(changedSettings)
        })
    }
})

main()