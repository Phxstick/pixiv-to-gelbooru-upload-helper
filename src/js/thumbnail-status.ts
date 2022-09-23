import browser from "webextension-polyfill";
import { PixivIdToGelbooruIds, ThumbnailSize } from "./types";
import ThumbnailPanel from "./thumbnail-panel";
import "./thumbnail-status.scss"

export default class ThumbnailStatus {
    private readonly pixivIdToElements = new Map<string, HTMLElement[]>()
    private readonly pixivIdToGelbooruIds: PixivIdToGelbooruIds = new Map()
    private showMarkers = true

    // Observer for a container where links to artwork posts are added and removed
    // dynamically. Updates those links and requests Gelbooru status if necessary.
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
            const panel = new ThumbnailPanel(this.pixivIdToGelbooruIds, size)
            panel.attachTo(container)
        }
        this.handlePixivLinks(initialLinks)
    }

    update(statusMap: { [key in string]: string[] }) {
        for (const pixivId in statusMap) {
            if (!this.pixivIdToElements.has(pixivId)) continue
            this.updateArtworkStatus(pixivId, statusMap[pixivId])
        }
    }

    clear() {
        this.pixivIdToGelbooruIds.clear()
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
        const newPixivIds: string[] = []
        for (const element of linkElements) {
            const pixivId = this.registerPixivLink(element as HTMLElement)
            if (typeof pixivId === "string") {
                if (this.pixivIdToGelbooruIds.has(pixivId)) {
                    this.updateLinkElements(pixivId)
                } else {
                    newPixivIds.push(pixivId)
                }
            } else {
                pixivId.then(pixivId => {
                    if (this.pixivIdToGelbooruIds.has(pixivId)) {
                        this.updateLinkElements(pixivId)
                    } else {
                        this.requestGelbooruStatus([pixivId])
                    }
                })
            }
        }
        if (newPixivIds.length > 0) {
            this.requestGelbooruStatus(newPixivIds)
        }
    }

    // Request Gelbooru status from background page and update mapping
    private async requestGelbooruStatus(pixivIds: string[]) {
        if (pixivIds.length === 0) return
        const statusMap = await browser.runtime.sendMessage({
            type: "get-gelbooru-status",
            args: { pixivIds }
        })
        for (const pixivId in statusMap) {
            this.updateArtworkStatus(pixivId, statusMap[pixivId])
        }
    }

    // Update mapping from Pixiv ID to list of Gelbooru IDs
    private updateArtworkStatus(pixivId: string, gelbooruIds: string[]) {
        if (!this.pixivIdToGelbooruIds.has(pixivId)) {
            this.pixivIdToGelbooruIds.set(pixivId, gelbooruIds)
        } else {
            const knownGelbooruIds = this.pixivIdToGelbooruIds.get(pixivId)!
            for (const gelbooruId of gelbooruIds) {
                if (!knownGelbooruIds.includes(gelbooruId))
                    knownGelbooruIds.push(gelbooruId)
            }
        }
        this.updateLinkElements(pixivId)
    }

    // Visually update link elements pointing to artwork with given pixiv ID
    // according to its Gelbooru status
    private updateLinkElements(pixivId: string) {
        if (!this.showMarkers) return
        const linkElements = this.pixivIdToElements.get(pixivId)
        const gelbooruIds = this.pixivIdToGelbooruIds.get(pixivId)
        if (linkElements === undefined) return
        if (gelbooruIds === undefined) return
        for (const linkElement of linkElements) {
            // Large tiles have "size" attribute, highlight them more
            if (linkElement.hasAttribute("size")) linkElement.classList.add("large")
            linkElement.classList.toggle("checked-uploaded", gelbooruIds.length > 0)
            linkElement.classList.toggle("checked-not-uploaded", gelbooruIds.length === 0)
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