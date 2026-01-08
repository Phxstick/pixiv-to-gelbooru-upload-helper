import browser from "webextension-polyfill";
import ThumbnailStatus from "./thumbnail-status";
import ArtistCheck from "./artist-check";
import ArtworkOverlay from "./artwork-overlay";
import SettingsManager from "./settings-manager";
import { PixivTags, Settings, HostName, ThumbnailSize } from "./types";
import { isEqual } from "./utility"
import "./pixiv-script.scss"

enum Container {
    AdjacentPics = "adjacent-pics",
    ArtistPics = "pics-by-artist",
    RelatedPics = "related-pics"
}

const thumbnailStatus = new ThumbnailStatus()
const artistCheck =  new ArtistCheck()

let currentSettings = SettingsManager.getDefaultValues();
const settingsLoaded = browser.runtime.sendMessage({ type: "get-settings" }).then(updateSettings)
thumbnailStatus.setHosts(currentSettings.enabledHosts as HostName[])

let stickyParent: HTMLElement
const stickyParentObserver = new MutationObserver(() => {
    const stickyElement = stickyParent.children[4]
    if (stickyElement) {
        (stickyElement as HTMLElement).style.position = "static"
    }
})

// Display an alert if an error occurs in the given function in development mode
function announceError(func: Function) {
    try {
        func()
    } catch (e) {
        if (PRODUCTION) return
        const message = e instanceof Error ? ` (${e.message})` : ""
        window.alert(`Error occurred!${message}`)
        throw e
    }
}

function applySettings(changedSettings?: Set<keyof Settings>) {
    const root = document.getElementById("__next") as HTMLElement
    const mainElement = document.querySelector("main")
    const hasChanged = (key: keyof Settings) => !changedSettings || changedSettings.has(key)
    if (hasChanged("hideRelatedPixivPics")) {
        const relatedPicsContainer = document.getElementById(Container.RelatedPics)
        if (relatedPicsContainer) {
            const asideElement = relatedPicsContainer.closest("aside")
            if (asideElement) {
                asideElement.style.display = currentSettings.hideRelatedPixivPics ? "none" : "block"
            }
            if (mainElement !== null && mainElement.parentElement !== null) {
                mainElement.parentElement.style.paddingBottom = currentSettings.hideRelatedPixivPics ? "0" : "56px"
            }
            if (!currentSettings.hideRelatedPixivPics) {
                thumbnailStatus.manage([{ container: relatedPicsContainer, size: "large" }])
            }
        }
    }
    if (hasChanged("hideOtherPicsByArtist")) {
        const picsByArtistContainer = document.getElementById(Container.ArtistPics)
        const adjacentPicsContainer = document.getElementById(Container.AdjacentPics)
        if (picsByArtistContainer) {
            picsByArtistContainer.parentElement!.parentElement!.classList.toggle("hidden", currentSettings.hideOtherPicsByArtist)
            if (!currentSettings.hideOtherPicsByArtist) {
                thumbnailStatus.manage([{ container: picsByArtistContainer, size: "medium" }])
            }
        }
        if (adjacentPicsContainer) {
            adjacentPicsContainer.closest("aside")!.classList.toggle("hidden", currentSettings.hideOtherPicsByArtist)
            if (!currentSettings.hideOtherPicsByArtist) {
                thumbnailStatus.manage([{ container: adjacentPicsContainer, size: "small" }])
            }
        }
    }
    if (hasChanged("hidePixivHeader")) {
        const headerWrapper = root.querySelector("div[style^='position:static']")
        if (headerWrapper) {
            const header = headerWrapper.parentElement as HTMLElement | null
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
            const stickyElement = stickyParent.children[5]
            if (stickyElement) {
                (stickyElement as HTMLElement).style.position = "static"
            }
        }
    }
    if (hasChanged("showThumbnailStatus")) {
        thumbnailStatus.toggle(currentSettings.showThumbnailStatus)
    }
    if (hasChanged("showPostScore")) {
        ArtworkOverlay.togglePostScores(currentSettings.showPostScore)
    }
    if (hasChanged("enabledHosts")) {
        thumbnailStatus.setHosts(currentSettings.enabledHosts as HostName[])
        ArtworkOverlay.updateHosts(currentSettings.enabledHosts as HostName[])
    }
    if (hasChanged("defaultHost")) {
        ArtworkOverlay.updateDefaultHost(currentSettings.defaultHost as HostName)
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

/**
 * Convert content of given HTML element to a string formatted according to
 * Danbooru's DText specification.
 */
function parseDescription(element: ChildNode): string {
    const descriptionParts = []
    for (const childNode of element.childNodes) {
        if (childNode.nodeName === "#text") {
            descriptionParts.push(childNode.textContent)
        } else if (childNode.nodeName === "BR") {
            descriptionParts.push("\n")
        } else if (childNode.nodeName === "A") {
            const linkElement = childNode as HTMLAnchorElement
            const linkText = linkElement.textContent
            let linkUrl = linkElement.href
            const pixivJumpPrefix = "https://www.pixiv.net/jump.php?"
            if (linkUrl.startsWith(pixivJumpPrefix)) {
                linkUrl = decodeURIComponent(linkUrl.slice(pixivJumpPrefix.length))
            }
            descriptionParts.push(
                linkText === linkUrl ? `<${linkUrl}>` : `[${linkText}](${linkUrl})`)
        } else if (childNode.nodeName === "STRONG") {
            descriptionParts.push("[b]" + parseDescription(childNode) + "[/b]")
        } else {
            throw new Error("Unsupported element type in description: " + childNode.nodeName)
        }
    }
    return descriptionParts.join("")
}

function getTitleAndDescription(): { title?: string, description?: string } {
    const data: { title?: string, description?: string } = {}

    // Find wrapper element (search for <footer> because tags element should always exist)
    const footerElements = document.querySelectorAll("footer")
    if (footerElements.length !== 1) {
        throw new Error("Page doesn't contain exactly one <footer> element")
    }
    const artworkDetailsWrapper = footerElements[0].parentElement!

    // Get title
    const titleElements = artworkDetailsWrapper.querySelectorAll("h1")
    if (titleElements.length > 1) {
        throw new Error("Artwork details wrapper contains more than one <h1> element")
    }
    if (titleElements.length === 1) {
        data.title = titleElements[0].textContent
    }

    // Get description
    const paragraphElements = artworkDetailsWrapper.querySelectorAll("p")
    if (paragraphElements.length > 1) {
        throw new Error("Artwork details wrapper contains more than one <p> element")
    }
    if (paragraphElements.length === 1) {
        data.description = parseDescription(paragraphElements[0])
    }
    
    return data
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

function getPreviewImage(clickedImg: HTMLImageElement): HTMLImageElement | null {
    // Check if the clicked image is already a preview
    if (!clickedImg.src.includes("img-original")
            || clickedImg.parentElement!.tagName === "A")
        return clickedImg

    // Find a preview if the given image is an original version
    clickedImg.click()  // Close original image

    // IMPORTANT: the preview and original may have different file types,
    // e.g. JPG and PNG, so a prefix-search must be used instead of equality
    const previewUrl = clickedImg.src.replace("img-original", "img-master")
        .replace(/_p(\d+)\./, "_p$1_master1200.").slice(0, -4)
    const previewImage = document.querySelector(`img[src^='${previewUrl}']`) as HTMLImageElement | null
    if (previewImage) return previewImage

    // Artwork can be a long image which is a concatention of smaller images,
    // in which case a less specific regex must be used find preview images
    const imageIdentifierMatch = clickedImg.src.match(/\/(\d+_p\d+)/)
    if (!imageIdentifierMatch) return null
    const imageIdentifier = imageIdentifierMatch[1]
    return document.querySelector(`img[src*='${imageIdentifier}']`) as HTMLImageElement | null
}

// Ctrl + click an image to add the original version of it to an upload tab 
async function artworkCheckListener(event: MouseEvent) {
    if (!event.ctrlKey && !event.metaKey) return
    const target = event.target as HTMLElement
    if (target.tagName !== "IMG") return
    const clickedImg = target as HTMLImageElement

    // Don't trigger on thumbnails
    if (clickedImg.src.includes("custom-thumb")) return
    if (clickedImg.src.includes("square")) return

    // Get preview image
    const previewImage = getPreviewImage(clickedImg)
    if (!previewImage) return
    event.stopPropagation()
    event.preventDefault()

    // Get URL of original image and container of preview image
    const url = previewImage.parentElement!.getAttribute("href")
    if (url === null || !url.includes("img-original")) return
    const imgContainer = previewImage.closest(".gtm-medium-work-expanded-view") as HTMLElement | null
                         || previewImage.parentElement!.parentElement!
    if (!imgContainer) return

    // If this image was already handled before, display existing overlay
    const existingOverlay = ArtworkOverlay.getOverlay(imgContainer)
    if (existingOverlay !== undefined) {
        existingOverlay.show()
        if (event.shiftKey) existingOverlay.selectHost()
        return
    }

    // Extract artwork title, description and tags from the page
    const tags = gatherPixivTags()
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
    artworkOverlay.setHosts(currentSettings.enabledHosts as HostName[])
    artworkOverlay.show()
    if (event.shiftKey) {
        artworkOverlay.selectHost()
    } else {
        artworkOverlay.check(event.altKey ?
            "all-hosts" : currentSettings.defaultHost as HostName)
    }
}
const artworkCheckListenerArgs = ["click", artworkCheckListener, { capture: true }] as const

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
                    announceError(() => handleArtworkPage(navElements))
                }
            }
        }
    }
})

const knownListings = new WeakSet<HTMLElement>()

// Also handle switching between listing
const listingWrapperObserver = new MutationObserver(mutationList => {
    for (const mutation of mutationList) {
        if (mutation.addedNodes.length) {
            for (const node of mutation.addedNodes) {
                const element = node as HTMLElement
                const listing = element.querySelector("ul")
                if (listing === null) continue
                if (knownListings.has(listing)) continue
                knownListings.add(listing)
                thumbnailStatus.clear()
                thumbnailStatus.manage([{ container: listing, size: "large" }])
            }
        }
    }
})

// function getListing(section: HTMLElement) {
//     if (section.firstChild === null) return null
//     const sectionHeader = section.firstChild.textContent!
//     if (!sectionHeader.startsWith("Illustrations")
//             && !sectionHeader.startsWith("Works")) return null
//     return section.querySelector("ul")
// }

function handleArtworkPage(navElements: HTMLElement[]) {
    document.removeEventListener(...artworkCheckListenerArgs)
    document.addEventListener(...artworkCheckListenerArgs)
    ArtworkOverlay.clear()

    const adjacentPicsContainer = navElements[1] as HTMLElement
    if (adjacentPicsContainer && !adjacentPicsContainer.id)
        adjacentPicsContainer.id = Container.AdjacentPics
    const picsByArtistContainer = navElements[0].children[0] as HTMLElement
    if (picsByArtistContainer && !picsByArtistContainer.id)
        picsByArtistContainer.id = Container.ArtistPics
    const listElements = [...document.querySelectorAll("aside ul")] as HTMLElement[]
    const relatedPicsContainer = listElements[listElements.length - 1]
    if (relatedPicsContainer && !relatedPicsContainer.id)
        relatedPicsContainer.id = Container.RelatedPics
    settingsLoaded.then(() => {
        applySettings()
        const containers: { container: HTMLElement, size: ThumbnailSize }[] = []
        if (!currentSettings.hideOtherPicsByArtist) {
            if (adjacentPicsContainer)
                containers.push({ container: adjacentPicsContainer, size: "small" })
            if (picsByArtistContainer)
                containers.push({ container: picsByArtistContainer, size: "medium" })
        }
        if (!currentSettings.hideRelatedPixivPics) {
            if (relatedPicsContainer)
                containers.push({ container: relatedPicsContainer, size: "large" })
        }
        thumbnailStatus.manage(containers)
    })

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
    const listingWrapper = listing.parentElement!.parentElement!.parentElement!.parentElement!
    listingWrapperObserver.disconnect()
    // Wrapper can be different on some pages, observe all possible candidates
    listingWrapperObserver.observe(listingWrapper, { childList: true })
    listingWrapperObserver.observe(listingWrapper.parentElement!, { childList: true })

    settingsLoaded.then(() => {
        applySettings()
        thumbnailStatus.manage([{ container: listing, size: "large" }])
    })

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

// Pixiv content is loaded dynamically by scripts, so use observers
// to wait for the required elements to appear before running other code
const postPageObserver = new MutationObserver((mutationList) => {
    // Some pages contain an additional hidden nav element, ignore that one
    // by filtering out elements with less than two classes
    const navElements = [...document.querySelectorAll("nav")!]
        .filter(el => el.classList.length >= 2)
    if (navElements.length < 2) return
    postPageObserver.disconnect()
    announceError(() => handleArtworkPage(navElements))
})

const listingPageObserver = new MutationObserver(mutationList => {
    for (const mutation of mutationList) {
        if (mutation.addedNodes.length) {
            for (const node of mutation.addedNodes) {
                const element = node as HTMLElement
                let listing
                if (element.tagName === "UL") {
                    listing = element
                } else if (element.tagName === "LI") {
                    // if (!element.hasAttribute("size")) continue
                    listing = element.closest("ul") as HTMLElement | null
                    if (listing === null) continue
                } else {
                    continue
                }
                if (knownListings.has(listing)) continue
                knownListings.add(listing)
                announceError(() => handleListingPage(listing))
            }
        }
    }
})

let pageType: string | undefined

function main() {
    // Check if the type of page has changed (otherwise do nothing)
    let newPageType: string | undefined
    if (location.href.includes("/artworks/")) {
        newPageType = "post"
    } else if (location.href.includes("/users/")) {
        newPageType = "listing"
    } else if (location.href.includes("/tags/")) {
        newPageType = "tag"
    }
    if (pageType === newPageType) return
    pageType = newPageType;

    // Reset data structures and connect observers in order to find link containers
    listingPageObserver.disconnect()
    postPageObserver.disconnect()
    thumbnailStatus.clear()
    artistCheck.clear()
    document.removeEventListener(...artworkCheckListenerArgs)
    const root = document.getElementById("__next") as HTMLElement
    // Root doesn't exist on 404 pages
    if (!root) return
    if (pageType === "post") {
        postPageObserver.observe(root, { childList: true, subtree: true })
    } else if (pageType === "listing" || pageType === "tag") {
        listingPageObserver.observe(root, { childList: true, subtree: true })
    }
}

browser.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== browser.runtime.id) return
    if (!message || !message.type) return

    // Extension will send notification if an upload status changes
    if (message.type === "pixiv-status-update") {
        if (!message.args) return
        const { pixivIdToPostIds, filenameToPostIds, posts } = message.args
        thumbnailStatus.update(pixivIdToPostIds)
        if (filenameToPostIds) {
            for (const filename in filenameToPostIds) {
                const statusUpdate = filenameToPostIds[filename]
                ArtworkOverlay.update(filename, statusUpdate, posts)
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
