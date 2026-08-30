import { ThumbnailSize, PostHost, UploadStatus, StatusMap, HostMaps, MessageType, Message, SourceHost } from "./types";
import ThumbnailPanel from "./thumbnail-panel";
import { sendInternalMessage } from "./utility";
import { SourceHostInterface } from "./source-host";
import "./thumbnail-status.scss"

export default class ThumbnailStatus {
    private readonly sourceIdToElements = new Map<string, HTMLElement[]>()
    private readonly hostMaps: HostMaps = {}
    private sourceHost: SourceHostInterface
    private postHosts: PostHost[] = []
    private showMarkers = true
    private observedContainers = new Set<HTMLElement>()

    // Observer for a container where links to artwork posts are added and removed
    // dynamically. Updates those links and requests upload status if necessary.
    private readonly linkContainerObserver = new MutationObserver((mutationList) => {
        for (const mutation of mutationList) {
            this.handleSourceLinks(mutation.addedNodes)
            // Nodes removed during scrolling will not be reused again
            // so remove them from the mapping to prevent a memory leak
            for (const node of mutation.removedNodes) {
                Promise.resolve(this.sourceHost.extractSourceId(node as HTMLElement))
                .then((sourceId) => {
                    if (!sourceId) return
                    const elements = this.sourceIdToElements.get(sourceId)
                    if (elements === undefined) {
                        return  // Shouldn't happen actually
                    }
                    const newElements = elements.filter(el => el !== node)
                    if (newElements.length > 0) {
                        this.sourceIdToElements.set(sourceId, newElements)
                    } else {
                        this.sourceIdToElements.delete(sourceId)
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
                        Promise.resolve(this.registerSourceLink(linkElement))
                               .then((id) => id && this.updateLinkElements(id))
                    }
                }
            }
        }
    })

    constructor(sourceHost: SourceHostInterface) {
        this.sourceHost = sourceHost
    }

    manage(containers: { container: HTMLElement, size: ThumbnailSize }[]) {
        if (containers.length === 0) return 
        
        // Remove containers which have been removed from the page
        let outdatedContainerExists = false
        for (const container of this.observedContainers) {
            if (container.offsetParent === null) {
                outdatedContainerExists = true
                this.observedContainers.delete(container)
                // TODO: also remove contained elements and outdated map entries
            }
        }

        // Manage newly added containers
        for (const { container, size } of containers) {
            if (container.offsetParent === null) continue
            if (this.observedContainers.has(container)) continue
            this.observedContainers.add(container)
            if (!outdatedContainerExists) {
                this.linkContainerObserver.observe(container, { childList: true })
            }
            this.manageContainer(container, size)
        }

        // Disconnect observer if a container was removed and connect remaining
        if (outdatedContainerExists) {
            this.linkContainerObserver.disconnect()
            for (const container of this.observedContainers) {
                this.linkContainerObserver.observe(container, { childList: true })
            }
        }
    }

    manageContainer(container: HTMLElement, size: ThumbnailSize) {
        const panel = new ThumbnailPanel(this.sourceHost.name, this.hostMaps, size)
        panel.attachTo(container)

        if (this.sourceHost.name === SourceHost.Pixiv) {
            // Sometimes the container gets replaced with a new one,
            // use a childList observer on the parent to catch those cases
            const containerWrapperObserver = new MutationObserver((mutationList) => {
                for (const mutation of mutationList) {
                    for (const node of mutation.addedNodes) {
                        const element = node as HTMLElement
                        if (element.tagName != "UL") continue
                        this.linkContainerObserver.observe(element, { childList: true })
                        panel.attachTo(element)
                        this.handleSourceLinks(element.children)
                    }
                }
            })
            containerWrapperObserver.observe(container.parentElement!, { childList: true })
        }

        this.handleSourceLinks(container.children)
    }

    update(statusMap: StatusMap) {
        for (const sourceId in statusMap) {
            if (!this.sourceIdToElements.has(sourceId)) continue
            this.updateArtworkStatus(sourceId, statusMap[sourceId])
        }
    }

    clear() {
        for (const key in this.hostMaps) {
            const host = key as PostHost
            this.hostMaps[host]!.clear()
        }
        this.linkContainerObserver.disconnect()
        this.sourceIdToElements.clear()
        this.observedContainers.clear()
    }

    // Toggle markers on/off 
    toggle(enabled: boolean) {
        this.showMarkers = enabled
        for (const [sourceId, linkElements] of this.sourceIdToElements.entries()) {
            if (enabled) {
                this.updateLinkElements(sourceId)
            } else {
                for (const linkElement of linkElements) {
                    linkElement.classList.remove("checked")
                }
            }
        }
    }

    setHosts(hosts: PostHost[]) {
        this.postHosts = hosts
        if (this.showMarkers) {
            this.requestUploadStatus([...this.sourceIdToElements.keys()])
        }
    }

    // Fully handle a list of link elements, i.e. register them, request status
    // from background page if needed, and perform modifications in the DOM
    private handleSourceLinks(linkElements: Iterable<Node | Element>) {
        const isCheckedSourceId = (sourceId: string) => {
            for (const host of this.postHosts) {
                const sourceIdToPostIds = this.hostMaps[host]
                if (!sourceIdToPostIds) return false
                if (!sourceIdToPostIds.has(sourceId)) return false
            }
            return true
        }
        const newSourceIds: string[] = []
        for (const element of linkElements) {
            const htmlElement = element as HTMLElement
            const sourceId = this.registerSourceLink(htmlElement)
            if (!sourceId) continue
            if (typeof sourceId === "string") {
                if (isCheckedSourceId(sourceId)) {
                    this.updateLinkElements(sourceId)
                } else {
                    newSourceIds.push(sourceId)
                }
            } else {
                sourceId.then(sourceId => {
                    if (!sourceId) return
                    if (isCheckedSourceId(sourceId)) {
                        this.updateLinkElements(sourceId)
                    } else {
                        this.requestUploadStatus([sourceId])
                    }
                })
            }
        }
        if (newSourceIds.length > 0) {
            this.requestUploadStatus(newSourceIds)
        }
    }

    // Request upload status from background page and update mapping
    private async requestUploadStatus(sourceIds: string[]) {
        if (sourceIds.length === 0) return
        const statusMap: StatusMap = await sendInternalMessage({
            type: MessageType.GetPostStatus,
            args: {
                sourceHost: this.sourceHost.name,
                sourceIds,
                postHosts: this.postHosts }
        })
        for (const sourceId in statusMap) {
            this.updateArtworkStatus(sourceId, statusMap[sourceId])
        }
    }

    // Update mapping from source ID to list of post IDs
    private updateArtworkStatus(sourceId: string, uploadStatus: UploadStatus) {
        for (const key in uploadStatus) {
            const host = key as PostHost
            const postIds = uploadStatus[host]!
            let sourceIdToPostIds = this.hostMaps[host]
            if (!sourceIdToPostIds) {
                sourceIdToPostIds = new Map()
                this.hostMaps[host] = sourceIdToPostIds
            }
            if (!sourceIdToPostIds.has(sourceId)) {
                sourceIdToPostIds.set(sourceId, postIds)
            } else {
                const knownPostIds = sourceIdToPostIds.get(sourceId)!
                for (const postId of postIds) {
                    if (!knownPostIds.includes(postId))
                        knownPostIds.push(postId)
                }
            }
        }
        this.updateLinkElements(sourceId)
    }

    // Visually update link elements pointing to artwork with given source ID
    // according to its upload status
    private updateLinkElements(sourceId: string) {
        if (!this.showMarkers) return
        let linkElements = this.sourceIdToElements.get(sourceId)
        if (linkElements === undefined) return
        // Remove outdated elements that are no longer on the page
        const filteredElements = linkElements.filter(el => el.offsetParent !== null)
        if (filteredElements.length !== linkElements.length) {
            this.sourceIdToElements.set(sourceId, filteredElements)
            if (filteredElements.length === 0) return
            linkElements = filteredElements
        }
        let numPosts = 0
        let isChecked = false
        let isSomeHostMissing = false
        let isPartiallyChecked = false
        for (const host of this.postHosts) {
            const sourceIdToPostIds = this.hostMaps[host]
            if (!sourceIdToPostIds) {
                isPartiallyChecked = true
                continue
            }
            const postIds = sourceIdToPostIds.get(sourceId)
            if (!postIds) {
                isPartiallyChecked = true
                continue
            }
            isChecked = true
            numPosts += postIds.length
            if (postIds.length === 0)
                isSomeHostMissing = true
        }
        if (!isChecked) return
        for (const linkElement of linkElements) {
            linkElement.classList.add("checked")
            linkElement.classList.toggle("partially-checked", isPartiallyChecked)
            linkElement.classList.toggle("checked-uploaded", numPosts > 0 && !isSomeHostMissing)
            linkElement.classList.toggle("checked-mixed", numPosts > 0 && isSomeHostMissing)
            linkElement.classList.toggle("checked-not-uploaded", numPosts === 0)
        }
    }

    // Update mapping with given link element
    private registerSourceLink(linkElement: HTMLElement) {
        const handler = (sourceId: string | null) => {
            if (!sourceId) return null
            if (!this.sourceIdToElements.has(sourceId)) {
                this.sourceIdToElements.set(sourceId, [])
            }
            const elements = this.sourceIdToElements.get(sourceId)!
            if (!elements.includes(linkElement)) {
                elements.push(linkElement)
                this.linkObserver.observe(linkElement, { attributeFilter: ["class"] })
            }
            this.sourceHost.setThumbnailClasses(linkElement)
            linkElement.classList.add("handled")
            return sourceId
        }
        const sourceId = this.sourceHost.extractSourceId(linkElement)
        if (typeof sourceId === "string" || sourceId === null) {
            return handler(sourceId)
        } else {
            return sourceId.then(handler)
        }
    }
}
