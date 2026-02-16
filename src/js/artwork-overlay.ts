import browser from "webextension-polyfill";
import anime from "animejs"
import { ArtworkTags, PostHost, UploadStatus, BooruPost, PostsMap } from "./types"
import { createPostLink, E } from "./utility"
import "./artwork-overlay.scss"

interface ArtworkDetails {
    tags: ArtworkTags
    title?: string
    description?: string
}

interface CheckResult {
    postIds?: number[]
    error?: string
    posts?: { [key in number]: BooruPost }
}

export default class ArtworkOverlay {
    private readonly imgElements: HTMLImageElement[]
    private readonly imgContainer: HTMLElement

    private readonly url: string
    private readonly details: ArtworkDetails

    // Settings
    private hosts: PostHost[] = []
    private defaultHost: PostHost | "all-hosts" = "all-hosts"
    private static showPostScores = false

    // State variables
    private downloading = false
    private showingProgressBar = false
    private showingDownloadStatus = false
    private downloadPromise: Promise<string> | undefined
    private checkResults = new Map<PostHost, Promise<CheckResult>>()

    // Overlay elements
    private readonly imageFilter = E("div", { class: "image-filter" })
    private readonly innerProgressBar = E("div", { class: "progress-bar-inner" })
    private readonly progressBar = E("div", { class: "progress-bar" }, [ this.innerProgressBar ])
    private readonly statusMessage = E("div", { class: "status-message" })
    private readonly uploadPageButton = E("button", { class: "upload-page-button" }, "Go to upload page")
    private readonly retryButton = E("button", { class: "retry-button" }, "Retry")
    private readonly postLinksContainer = E("div", { class: "post-links" })
    private readonly hostButtonsContainer = E("div", { class: "host-buttons" })
    private readonly multiStatusContainer = E("div", { class: "multi-status-container" })
    private readonly selectHostWrapper = E("div", { class: "select-host-wrapper" }, [
        E("div", { class: "select-host-message" }, "Select a site"),
        this.hostButtonsContainer
    ])
    private readonly singleStatusContainer = E("div", { class: "status-container" }, [
        this.statusMessage,
        this.retryButton,
        this.progressBar,
        this.uploadPageButton,
        this.postLinksContainer,
    ])
    private readonly contentWrapper = E("div", { class: "content-wrapper" }, [
        this.selectHostWrapper,
        this.singleStatusContainer,
        this.multiStatusContainer
    ])
    private readonly overlayContainer = E("div", { class: "artwork-overlay" }, [
        this.imageFilter,
        this.contentWrapper
    ])

    // Remember overlay instance for each image
    private static readonly imageContainerToOverlay = new Map<HTMLElement, ArtworkOverlay>()
    private static readonly filenameToOverlay = new Map<string, ArtworkOverlay>()
    static getOverlay(imageContainer: HTMLElement): ArtworkOverlay | undefined {
        return this.imageContainerToOverlay.get(imageContainer)
    }

    // Remove overlays when different images get displayed
    private static readonly imageContainerObserver = new MutationObserver((mutationList) => {
        for (const mutation of mutationList) {
            if (mutation.removedNodes.length === 0) continue
            const element = mutation.removedNodes[0] as HTMLElement
            if (element.tagName !== "IMG") continue
            ArtworkOverlay.clear()
        }
    })
    static clear() {
        for (const overlayInstance of ArtworkOverlay.imageContainerToOverlay.values()) {
            overlayInstance.remove()
        }
        ArtworkOverlay.filenameToOverlay.clear()
        ArtworkOverlay.imageContainerToOverlay.clear()
        ArtworkOverlay.imageContainerObserver.disconnect()
    }

    // Update status of overlay for image with given filename
    static update(filename: string, uploadStatus: UploadStatus, postsMap?: PostsMap) {
        const overlay = ArtworkOverlay.filenameToOverlay.get(filename)
        if (!overlay) return
        const updatePromises: Promise<boolean>[] = []
        for (const key in uploadStatus) {
            const host = key as PostHost
            const postIds = uploadStatus[host]!.map(id => parseInt(id))
            const posts = postsMap ? postsMap[host] : undefined
            const promise = overlay.checkResults.get(host)
            if (!promise) {
                overlay.checkResults.set(host, Promise.resolve({ postIds, host, posts }))
                updatePromises.push(Promise.resolve(true))
                continue
            }
            updatePromises.push(promise.then(checkResult => {
                let updated = false
                if (posts && Object.keys(posts).length > 0) {
                    if (!checkResult.posts) {
                        checkResult.posts = posts
                        updated = true
                    } else {
                        for (const postId in posts) {
                            if (!(postId in checkResult.posts)) {
                                checkResult.posts[postId] = posts[postId]
                                updated = true
                            }
                        }
                    }
                }
                if (!checkResult.postIds) {
                    checkResult.postIds = postIds
                    updated = true
                } else {
                    for (const postId of postIds) {
                        if (!checkResult.postIds.includes(postId)) {
                            checkResult.postIds.push(postId)
                            updated = true
                        }
                    }
                }
                return updated
            }))
        }
        Promise.all(updatePromises).then(updates => {
            if (updates.every(updated => !updated)) return
            if (overlay.hosts.length === 1) {
                overlay.showSingleCheckResult(overlay.hosts[0])
            } else {
                for (const key in uploadStatus) {
                    overlay.handleStatusUpdate(key as PostHost)
                }
                overlay.updateImageFilter()
            }
        })
    }

    static updateHosts(hosts: PostHost[]) {
        for (const overlayInstance of ArtworkOverlay.imageContainerToOverlay.values()) {
            overlayInstance.setHosts(hosts)
        }
    }

    static updateDefaultHost(host: PostHost | "all-hosts") {
        for (const overlayInstance of ArtworkOverlay.imageContainerToOverlay.values()) {
            overlayInstance.setDefaultHost(host)
        }
    }

    static togglePostScores(enabled: boolean) {
        ArtworkOverlay.showPostScores = enabled
    }

    constructor(imgContainer: HTMLElement, url: string, details: ArtworkDetails) {
        this.imgContainer = imgContainer
        this.imgElements = [...imgContainer.querySelectorAll("img")]
        this.url = url
        this.details = details

        this.reset()
        this.overlayContainer.style.display = "none"
        this.overlayContainer.style.opacity = "0"

        // Add overlay to image container
        imgContainer.style.position = "relative"
        imgContainer.appendChild(this.overlayContainer)
        ArtworkOverlay.imageContainerToOverlay.set(imgContainer, this)
        ArtworkOverlay.imageContainerObserver.observe(imgContainer, { childList: true }) 

        // Click overlay to hide it
        this.overlayContainer.addEventListener("click", async (event) => {
            const target = event.target as HTMLElement
            if (target.tagName === "BUTTON" || target.tagName === "A") return
            event.stopPropagation()
            event.preventDefault()
            this.hide()
        }, { capture: true })

        // Use capturing listener for clicking buttons/links, otherwise Pixiv's
        // listener for zooming in on the image will fire instead
        this.overlayContainer.addEventListener("click", (event) => {
            const target = event.target as HTMLElement
            if (target.classList.contains("post-link")) {
                const url = (target as HTMLAnchorElement).href
                window.open(url, "_blank")?.focus()
            } else if (target.classList.contains("host-button")) {
                this.check(target.dataset.value as PostHost | "all-hosts")
            } else return
            event.stopImmediatePropagation()
            event.preventDefault()
        }, { capture: true })

        // Add listener for retrying status check
        this.retryButton.addEventListener("click", (event) => {
            event.stopImmediatePropagation()
            event.preventDefault()
            this.statusMessage.classList.remove("check-failed")
            this.imageFilter.classList.remove("check-failed")
            anime({ targets: this.retryButton,
                opacity: 0, duration: 200, easing: "linear" })
            anime({ targets: this.imageFilter,
                opacity: 0, duration: 200, easing: "linear" })
            this.checkResults.delete(this.hosts[0])
            this.check(this.hosts[0])
        }, { capture: true })
    }

    show() {
        /**
         * Artwork pages with multiple pictures contain navigation areas which might
         * mask some interactive elements of the overlay, making them unclickable.
         * The bottom area is especially large, so make it a little bit smaller.
         */
        const figure = this.overlayContainer.closest("figure")
        if (figure) {
            const navigationAreas = figure.querySelectorAll("button[type='button']")
            if (navigationAreas.length === 2) {
                const bottomArea = navigationAreas[1] as HTMLElement
                bottomArea.style.height = "25vh"
                bottomArea.style.top = "calc(100% - 25vh)"
            }
        }
        // Fade out image and fade in overlay
        this.overlayContainer.style.display = "flex";
        anime({ targets: this.imgElements, opacity: 0.4, duration: 200, easing: "linear" })
        return anime({ targets: this.overlayContainer, opacity: 1, duration: 200, easing: "linear" }).finished
    }

    hide() {
        anime({ targets: this.imgElements, opacity: 1, duration: 180, easing: "linear" })
        return anime({ targets: this.overlayContainer, opacity: 0.0, duration: 180, easing: "linear" })
            .finished.then(() => { this.overlayContainer.style.display = "none" })
    }

    remove() {
        this.overlayContainer.remove()
    }

    setHosts(hosts: PostHost[]) {
        this.hosts = hosts
        this.hostButtonsContainer.innerHTML = ""
        for (const host of hosts) {
            const button = E("button", {
                class: "host-button",
                dataset: { value: host }
            }, host[0].toUpperCase() + host.slice(1))
            this.hostButtonsContainer.appendChild(button)
        }
        const allHostsButton = E("button", {
            class: "host-button",
            dataset: { value: "all-hosts" }
        }, "All hosts")
        this.hostButtonsContainer.appendChild(allHostsButton)
    }

    setDefaultHost(host: PostHost | "all-hosts") {
        this.defaultHost = host
    }

    async selectHost() {
        this.reset()
        this.selectHostWrapper.style.display = "block"
        this.selectHostWrapper.style.opacity = "1"
    }

    async check(host?: PostHost | "all-hosts") {
        if (!host) host = this.defaultHost
        this.statusMessage.textContent = ""
        anime({ targets: this.selectHostWrapper,
            opacity: 0, duration: 160, easing: "linear"
        }).finished.then(() => { this.selectHostWrapper.style.display = "none" })
        if (!this.downloadPromise) {
            this.downloadPromise = this.downloadImage(this.url)
        }
        if (this.downloading) {
            this.showDownloadStatus()
        }
        const dataUrl = await this.downloadPromise;
        const hosts = host === "all-hosts" ? this.hosts : [host]
        for (const host of hosts) {
            if (!this.checkResults.has(host)) {
                this.checkResults.set(host, this.conductCheck(dataUrl, host))
            }
        }
        const imageWidth = this.imgElements[0].offsetWidth
        const containerWidth = this.imgContainer.offsetWidth
        const imageOffset = (containerWidth - imageWidth) / 2
        
        this.imageFilter.style.width = `${imageWidth}px`
        this.imageFilter.style.left = `${imageOffset}px`
        const urlParts = this.url.split("/")
        const filename = urlParts[urlParts.length - 1]
        ArtworkOverlay.filenameToOverlay.set(filename, this)
        if (this.hosts.length === 1) {
            const promise = this.checkResults.get(hosts[0])
            if (!promise) {
                throw new Error(`Check for host "${hosts[0]}" hasn't been initiated.`)
            }
            this.singleStatusContainer.style.display = "block"
            this.statusMessage.textContent = "Checking..."
            const checkResult = await promise
            this.showSingleCheckResult(hosts[0], checkResult)
        } else {
            const promises = this.hosts.map(host => this.showCheckStatus(host))
            Promise.all(promises).then(() => this.updateImageFilter())
            this.multiStatusContainer.style.width = `${imageWidth}px`
            this.multiStatusContainer.style.display = "block"
            anime({ targets: this.multiStatusContainer,
                opacity: 1, duration: 240, easing: "linear" })
            anime({ targets: this.singleStatusContainer,
                opacity: 0, duration: 160, easing: "linear" })
        }
    }

    private showDownloadStatus() {
        if (this.showingDownloadStatus) {
            this.singleStatusContainer.style.display = "block"
            if (this.statusMessage.textContent!.length === 0)
                this.statusMessage.innerHTML = "Downloading"
            if (this.showingProgressBar)
                anime({ targets: this.progressBar,
                    opacity: 1, duration: 160, easing: "linear" })
        }
    }

    // Fetch image in the background script and display download progress
    private async downloadImage(url: string): Promise<string> {
        let finished = false
        this.downloading = true
        this.showingProgressBar = false
        this.showingDownloadStatus = false
        window.setTimeout(() => {
            if (finished) return
            this.showingDownloadStatus = true
            this.showDownloadStatus()
        }, 300)
        return new Promise<string>((resolve, reject) => {
            const downloadPort = browser.runtime.connect({ name: "image-download" })
            downloadPort.onMessage.addListener(async (message) => {
                if (message.type === "started") {
                    const { totalSize } = message.data
                    // Display progress bar if image size is known
                    // (add short delay so it doesn't flicker if download is almost instant)
                    window.setTimeout(() => {
                        if (!finished && totalSize) {
                            this.showingProgressBar = true
                            this.innerProgressBar.style.width = "0%"
                            this.showDownloadStatus()
                        }
                    }, 50)
                }
                else if (message.type === "progress") {
                    const { currentSize, totalSize } = message.data
                    // Update progress bar (or size counter if image size is unknown)
                    if (totalSize) {
                        const percentage = Math.floor((currentSize / totalSize) * 100)
                        anime({ targets: this.innerProgressBar, width: percentage + "%", duration: 30, easing: "easeOutSine" })
                    } else {
                        const sizeString = (currentSize / (1024 * 1024)).toFixed(1)
                        this.statusMessage.innerHTML = `Downloading (${sizeString} MiB)`
                    }
                }
                else if (message.type === "finished") {
                    const { dataUrl } = message.data
                    // Hide progress bar again and initiate status check
                    finished = true
                    this.downloading = false
                    if (this.showingProgressBar) {
                        anime({ targets: this.progressBar, opacity: 0, duration: 160, easing: "linear" })
                    }
                    resolve(dataUrl)
                    downloadPort.disconnect()
                }
            })
            // If the download has been interrupted, try again
            downloadPort.onDisconnect.addListener(() => {
                if (!finished) this.downloadImage(url)
            })
            downloadPort.postMessage({ type: "start-download", data: { url }})
        })
    }

    private async conductCheck(dataUrl: string, host: PostHost): Promise<CheckResult> {
        const { tags, title, description } = this.details
        try {
            return await browser.runtime.sendMessage({
                type: "prepare-upload",
                data: {
                    host,
                    file: dataUrl,
                    fileUrl: this.url,
                    pageUrl: location.href,
                    sourceTags: tags,
                    title,
                    description
                }
            })
        } catch (error) {
            return { error: `The extension "Improved Gelbooru upload"<br>must be enabled to conduct status checks!` }
        }
    }

    private initCheckStatus(host: PostHost): HTMLElement {
        const checkButton = E("button", { class: "check-button"}, "Check status")
        const retryButton = E("button", { class: "retry-button"}, "Retry status check")
        const uploadButton = E("button", { class: "upload-page-button"}, "Go to upload page")
        checkButton.addEventListener("click", (event) => {
            event.stopImmediatePropagation()
            event.preventDefault()
            this.check(host)
        }, { capture: true })
        retryButton.addEventListener("click", (event) => {
            event.stopImmediatePropagation()
            event.preventDefault()
            this.checkResults.delete(host)
            this.check(host)
        }, { capture: true })
        uploadButton.addEventListener("click", (event) => {
            event.stopImmediatePropagation()
            event.preventDefault()
            const urlParts = this.url.split("/")
            const filename = urlParts[urlParts.length - 1]
            browser.runtime.sendMessage({
                type: "focus-tab",
                args: { filename, host }
            })
        }, { capture: true })
        const hostName = host[0].toUpperCase() + host.slice(1)
        const statusContainer = E("div", { dataset: { host }}, [
            E("div", { class: "header" }, [
                E("div", { class: "host-name" }, hostName + ":"),
                E("div", { class: "status-message" }),
                checkButton
            ]),
            E("div", { class: "error-message check-failed" }),
            retryButton,
            uploadButton,
            E("div", { class: "post-links" })
        ])
        this.multiStatusContainer.appendChild(statusContainer)
        return statusContainer
    }

    private async showCheckStatus(host: PostHost) {
        let statusContainer = this.multiStatusContainer.querySelector(
            `[data-host='${host}']`)
        if (statusContainer === null) {
            statusContainer = this.initCheckStatus(host)
        }

        const statusMessage = statusContainer.querySelector(".status-message")!
        const errorMessage = statusContainer.querySelector(".error-message")!
        const checkButton = statusContainer.querySelector(".check-button")!
        const retryButton = statusContainer.querySelector(".retry-button")!
        const uploadButton = statusContainer.querySelector(".upload-page-button")!
        retryButton.classList.add("hidden")
        uploadButton.classList.add("hidden")
        errorMessage.classList.add("hidden")

        const checkResultPromise = this.checkResults.get(host)
        if (!checkResultPromise) return
        checkButton.classList.add("hidden")
        statusMessage.textContent = "Checking..."
        statusMessage.classList.remove("check-failed")

        const checkResult = await checkResultPromise
        if (!checkResult.postIds) {
            statusMessage.textContent = "Check failed"
            statusMessage.classList.add("check-failed")
            if (checkResult.error) {
                errorMessage.classList.remove("hidden")
                errorMessage.innerHTML = checkResult.error
                if (!checkResult.error.includes("too large") &&
                        !checkResult.error.includes("format not supported")) {
                    retryButton.classList.remove("hidden")
                }
            }
            return
        }

        if (checkResult.postIds.length === 0) {
            statusMessage.textContent = "Upload ready"
            statusMessage.classList.add("upload-prepared")
            uploadButton.classList.remove("hidden")
        }
        this.handleStatusUpdate(host, checkResult)
    }

    private async handleStatusUpdate(host: PostHost, checkResult?: CheckResult) {
        if (!checkResult) {
            const checkResultPromise = this.checkResults.get(host)
            if (!checkResultPromise) return
            checkResult = await checkResultPromise
        }
        const postIds = checkResult.postIds
        if (!postIds || postIds.length === 0) return
        const statusContainer =
            this.multiStatusContainer.querySelector(`[data-host='${host}']`)
        if (!statusContainer) return
        const statusMessage = statusContainer.querySelector(".status-message")!
        const errorMessage = statusContainer.querySelector(".error-message")!
        const uploadButton = statusContainer.querySelector(".upload-page-button")!
        const postsContainer = statusContainer.querySelector(".post-links") as HTMLElement
        const checkButton = statusContainer.querySelector(".check-button")!
        statusMessage.classList.remove("check-failed")
        statusMessage.classList.remove("upload-prepared")
        statusMessage.textContent = "Already uploaded"
        statusMessage.classList.add("already-uploaded")
        errorMessage.classList.add("hidden")
        uploadButton.classList.add("hidden")
        checkButton.classList.add("hidden")
        const linkText = postIds.length === 1 ? "View post" : undefined
        const showThumbnail = postIds.length > 1
        postsContainer.innerHTML = ""
        for (const postId of postIds) {
            const post = checkResult.posts ? checkResult.posts[postId] : undefined
            createPostLink(postsContainer, postId.toString(), host, linkText, post,
                ArtworkOverlay.showPostScores, showThumbnail)
        }
        postsContainer.classList.remove("hidden")
    }

    private async updateImageFilter(checkResults?: CheckResult[]) {
        if (!checkResults) {
            checkResults = await Promise.all([...this.checkResults.values()])
        }
        this.multiStatusContainer.classList.add("weak-background")
        this.imageFilter.classList.remove(
            "check-failed", "upload-prepared", "already-uploaded", "mixed-status")
        const postIds = checkResults.map(result => result.postIds)
        if (postIds.every(ids => !ids)) {
            this.imageFilter.classList.add("check-failed")
            this.multiStatusContainer.classList.add("check-failed")
            anime({ targets: this.imageFilter,
                opacity: 0.35, duration: 240, easing: "linear" })
        } else if (postIds.every(ids => ids && ids.length === 0)) {
            this.imageFilter.classList.add("upload-prepared")
            this.multiStatusContainer.classList.add("upload-prepared")
            anime({ targets: this.imageFilter,
                opacity: 0.4, duration: 240, easing: "linear" })
        } else if (postIds.every(ids => ids && ids.length > 0)) {
            this.imageFilter.classList.add("already-uploaded")
            this.multiStatusContainer.classList.add("already-uploaded")
            anime({ targets: this.imageFilter,
                opacity: 0.3, duration: 240, easing: "linear" })
        } else {
            this.imageFilter.classList.add("mixed-status")
            this.multiStatusContainer.classList.add("mixed-status")
            anime({ targets: this.imageFilter,
                opacity: 0.4, duration: 240, easing: "linear" })
        }
    }

    private async showSingleCheckResult(host: PostHost, checkResult?: CheckResult) {
        if (!checkResult) {
            const checkResultPromise = this.checkResults.get(host)
            if (!checkResultPromise) return
            checkResult = await checkResultPromise
        }

        const postIds = checkResult.postIds
        if (!postIds) {
            this.statusMessage.textContent = "Check failed"
            if (checkResult.error) {
                this.statusMessage.innerHTML += "<br>(" + checkResult.error + ")"
                if (!checkResult.error.includes("too large") &&
                        !checkResult.error.includes("format not supported")) {
                    this.progressBar.style.display = "none"
                    this.retryButton.style.display = "block"
                    anime({ targets: this.retryButton,
                        opacity: 1, duration: 240, easing: "linear" })
                }
            }
            this.statusMessage.classList.add("check-failed")
            this.imageFilter.classList.add("check-failed")
            anime({ targets: this.imageFilter,
                opacity: 0.35, duration: 240, easing: "linear" })
            return
        }
        this.retryButton.style.display = "none"
        this.progressBar.style.display = "none"
        this.statusMessage.classList.remove("check-failed")

        if (postIds.length === 0) {
            this.statusMessage.textContent = "Upload ready"
            this.statusMessage.classList.add("upload-prepared")
            this.imageFilter.classList.add("upload-prepared")
            this.uploadPageButton.style.display = "block"
            const urlParts = this.url.split("/")
            const filename = urlParts[urlParts.length - 1]
            ArtworkOverlay.filenameToOverlay.set(filename, this)
            this.uploadPageButton.addEventListener("click", (event) => {
                event.stopImmediatePropagation()
                event.preventDefault()
                browser.runtime.sendMessage({
                    type: "focus-tab",
                    args: { filename, host }
                })
            }, { capture: true })
            anime({ targets: this.uploadPageButton,
                opacity: 1, duration: 240, easing: "linear" })
            anime({ targets: this.imageFilter,
                opacity: 0.4, duration: 240, easing: "linear" })
            return
        }

        this.statusMessage.classList.remove("upload-prepared")
        this.statusMessage.textContent = "Already uploaded"
        this.statusMessage.classList.add("already-uploaded")
        this.imageFilter.classList.remove("upload-prepared")
        this.imageFilter.classList.add("already-uploaded")
        this.uploadPageButton.style.display = "none"
        this.postLinksContainer.innerHTML = ""
        const linkText = postIds.length === 1 ? "View post" : undefined
        postIds.forEach(postId =>
            createPostLink(this.postLinksContainer, postId.toString(), host, linkText))
        this.postLinksContainer.style.display = "block"
        anime({ targets: this.postLinksContainer,
            opacity: 1, duration: 240, easing: "linear" })
        anime({ targets: this.imageFilter,
            opacity: 0.3, duration: 240, easing: "linear" })
    }

    private reset() {
        this.imageFilter.style.opacity = "0"
        this.progressBar.style.opacity = "0"
        this.retryButton.style.opacity = "0"
        this.retryButton.style.display = "none"
        this.uploadPageButton.style.opacity = "0"
        this.uploadPageButton.style.display = "none"
        this.postLinksContainer.style.opacity = "0"
        this.postLinksContainer.innerHTML = ""
        this.multiStatusContainer.style.display = "none"
        this.multiStatusContainer.style.opacity = "0"
        this.selectHostWrapper.style.display = "none"
        this.singleStatusContainer.style.display = "none"
        this.statusMessage.textContent = ""
        this.statusMessage.classList.remove("check-failed")
        this.statusMessage.classList.remove("upload-prepared")
        this.statusMessage.classList.remove("already-uploaded")
    }
}
