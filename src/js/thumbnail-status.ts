import browser from "webextension-polyfill";
import { ThumbnailSize, HostName, UploadStatus, StatusMap, HostMaps } from "./types";
import ThumbnailPanel from "./thumbnail-panel";
import "./thumbnail-status.scss"

export default class ThumbnailStatus {
    private readonly pixivIdToElements = new Map<string, HTMLElement[]>()
    private readonly hostMaps: HostMaps = {}
    private showMarkers = true

    // Observer for a container where links to artwork posts are added and removed
    // dynamically. Updates those links and requests upload status if necessary.
    private readonly linkContainerObserver = new MutationObserver((mutationList) => {
        for (const mutation of mutationList) {
            this.handlePixivLinks(mutation.addedNodes)
            // Nodes removed during scrolling will not be reused again
            // so remove them from the mapping to prevent a memory leak
            for (const node of mutation.removedNodes) {
                Promise.resolve(this.extractPixivId(node as HTMLElement))
                .then((pixivId) => {
                    const elements = this.pixivIdToElements.get(pixivId)
                    if (elements === undefined) {
                        return  // Shouldn't happen actually
                    }
                    const newElements = elements.filter(el => el !== node)
                    if (newElements.length > 0) {
                        this.pixivIdToElements.set(pixivId, newElements)
                    } else {
                        this.pixivIdToElements.delete(pixivId)
                    }
                })
            }
        }
    })

    // Pixiv's framework sometimes changes the classList of elements even
    // when they're not supposed to be affected. Use an observer to catch
    // those cases and re-apply all modifications
    private readonly linkObserver = new MutationObserver((mutationList) => {
        for (const mutation of mutationList) {
            if (mutation.type === "attributes") {
                if (mutation.attributeName === "class") {
                    const linkElement = mutation.target as HTMLElement
                    if (!linkElement.classList.contains("handled")) {
                        linkElement.classList.add("handled")
                        const pixivId = this.extractPixivId(mutation.target as HTMLElement)
                        Promise.resolve(pixivId).then((id) => this.updateLinkElements(id))
                    }
                }
            }
        }
    })

    manage(containers: { container: HTMLElement, size: ThumbnailSize }[]) {
        this.pixivIdToElements.clear()
        this.linkContainerObserver.disconnect()
        const initialLinks = []
        for (const { container, size } of containers) {
            this.linkContainerObserver.observe(container, { childList: true })
            initialLinks.push(...container.children)
            const panel = new ThumbnailPanel(this.hostMaps, size)
            panel.attachTo(container)
            // Sometimes the container gets replaced with a new one,
            // use a childList observer on the parent to catch those cases
            const containerWrapperObserver = new MutationObserver((mutationList) => {
                for (const mutation of mutationList) {
                    for (const node of mutation.addedNodes) {
                        const element = node as HTMLElement
                        if (element.tagName != "UL") continue
                        this.linkContainerObserver.observe(element, { childList: true })
                        panel.attachTo(element)
                        this.handlePixivLinks(element.children)
                    }
                }
            })
            containerWrapperObserver.observe(container.parentElement!, { childList: true })
        }
        this.handlePixivLinks(initialLinks)
    }

    update(statusMap: StatusMap) {
        for (const pixivId in statusMap) {
            if (!this.pixivIdToElements.has(pixivId)) continue
            this.updateArtworkStatus(pixivId, statusMap[pixivId])
        }
    }

    clear() {
        for (const key in this.hostMaps) {
            const host = key as HostName
            this.hostMaps[host]!.clear()
        }
    }

    // Toggle markers on/off 
    toggle(enabled: boolean) {
        this.showMarkers = enabled
        for (const [pixivId, linkElements] of this.pixivIdToElements.entries()) {
            for (const linkElement of linkElements) {
                if (!enabled) {
                    linkElement.classList.remove("checked-uploaded", "checked-not-uploaded")
                } else {
                    this.updateLinkElements(pixivId)
                }
            }
        }
    }

    // Fully handle a list of link elements, i.e. register them, request status
    // from background page if needed, and perform modifications in the DOM
    private handlePixivLinks(linkElements: Iterable<Node | Element>) {
        const isKnownPixivId = (pixivId: string) => {
            for (const key in this.hostMaps) {
                const host = key as HostName
                const pixivIdToPostIds = this.hostMaps[host]!
                if (pixivIdToPostIds.has(pixivId)) return true
            }
            return false
        }
        const newPixivIds: string[] = []
        for (const element of linkElements) {
            const pixivId = this.registerPixivLink(element as HTMLElement)
            if (typeof pixivId === "string") {
                if (isKnownPixivId(pixivId)) {
                    this.updateLinkElements(pixivId)
                } else {
                    newPixivIds.push(pixivId)
                }
            } else {
                pixivId.then(pixivId => {
                    if (isKnownPixivId(pixivId)) {
                        this.updateLinkElements(pixivId)
                    } else {
                        this.requestUploadStatus([pixivId])
                    }
                })
            }
        }
        if (newPixivIds.length > 0) {
            this.requestUploadStatus(newPixivIds)
        }
    }

    // Request upload status from background page and update mapping
    private async requestUploadStatus(pixivIds: string[], host?: HostName) {
        if (pixivIds.length === 0) return
        const statusMap: StatusMap = await browser.runtime.sendMessage({
            type: "get-host-status",
            args: { pixivIds, host }
        })
        for (const pixivId in statusMap) {
            this.updateArtworkStatus(pixivId, statusMap[pixivId])
        }
    }

    // Update mapping from Pixiv ID to list of post IDs
    private updateArtworkStatus(pixivId: string, uploadStatus: UploadStatus) {
        for (const key in uploadStatus) {
            const host = key as HostName
            const postIds = uploadStatus[host]!
            let pixivIdToPostIds = this.hostMaps[host]
            if (!pixivIdToPostIds) {
                pixivIdToPostIds = new Map()
                this.hostMaps[host] = pixivIdToPostIds
            }
            if (!pixivIdToPostIds.has(pixivId)) {
                pixivIdToPostIds.set(pixivId, postIds)
            } else {
                const knownPostIds = pixivIdToPostIds.get(pixivId)!
                for (const postId of postIds) {
                    if (!knownPostIds.includes(postId))
                        knownPostIds.push(postId)
                }
            }
        }
        this.updateLinkElements(pixivId)
    }

    // Visually update link elements pointing to artwork with given pixiv ID
    // according to its upload status
    private updateLinkElements(pixivId: string) {
        if (!this.showMarkers) return
        const linkElements = this.pixivIdToElements.get(pixivId)
        if (linkElements === undefined) return
        let numPosts = 0
        let isChecked = false
        for (const key in this.hostMaps) {
            const host = key as HostName
            const pixivIdToPostIds = this.hostMaps[host]!
            const postIds = pixivIdToPostIds.get(pixivId)
            if (!postIds) continue
            isChecked = true
            numPosts += postIds.length
        }
        if (!isChecked) return
        for (const linkElement of linkElements) {
            // Large tiles have "size" attribute, highlight them more
            if (linkElement.hasAttribute("size")) linkElement.classList.add("large")
            linkElement.classList.toggle("checked-uploaded", numPosts > 0)
            linkElement.classList.toggle("checked-not-uploaded", numPosts === 0)
        }
    }

    // Update mapping with given link element
    private registerPixivLink(linkElement: HTMLElement): string | Promise<string> {
        const handler = (pixivId: string) => {
            if (!this.pixivIdToElements.has(pixivId)) {
                this.pixivIdToElements.set(pixivId, [])
            }
            const elements = this.pixivIdToElements.get(pixivId)!
            if (!elements.includes(linkElement)) {
                elements.push(linkElement)
                linkElement.classList.add("handled")
                this.linkObserver.observe(linkElement, { attributeFilter: ["class"] })
            }
            return pixivId
        }
        const pixivId = this.extractPixivId(linkElement)
        if (typeof pixivId === "string") {
            return handler(pixivId)
        } else {
            return pixivId.then(handler)
        }
    }

    // Extract pixiv ID from given link
    private extractPixivId(linkElement: HTMLElement): string | Promise<string> {
        let aElement = linkElement.querySelector("a")
        if (aElement !== null) return aElement.dataset.gtmValue!
        // <a> element in subtree of a link might not be present immediately,
        // in that case use an childList observer to determine when it appears
        // (NOTE: in some cases, it never appears, write code accordingly)
        return new Promise<string>((resolve) => {
            const linkLoadObserver = new MutationObserver(() => {
                const aElement = linkElement.querySelector("a")
                if (aElement !== null) {
                    linkLoadObserver.disconnect()
                    resolve(aElement.dataset.gtmValue!)
                }
            })
            linkLoadObserver.observe(linkElement, { childList: true, subtree: true })
        })
    }
}
