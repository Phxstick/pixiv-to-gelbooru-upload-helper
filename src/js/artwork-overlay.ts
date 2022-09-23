import browser from "webextension-polyfill";
import anime from "animejs"
import { PixivTags } from "./types"
import { createGelbooruLink, E } from "./utility"
import "./artwork-overlay.scss"

const gelbooruUploadExtension = "hnimcpiehhbajibceplcnnjlagoipeda"

export default class ArtworkOverlay {
    private readonly img: HTMLImageElement

    // Overlay elements
    private readonly imageFilter = E("div", { class: "image-filter" })
    private readonly innerProgressBar = E("div", { class: "progress-bar-inner" })
    private readonly progressBar = E("div", { class: "progress-bar" }, [ this.innerProgressBar ])
    private readonly statusMessage = E("div", { class: "status-message" })
    private readonly uploadPageButton = E("button", { class: "upload-page-button" }, "Go to upload page")
    private readonly retryButton = E("button", { class: "retry-button" }, "Retry")
    private readonly localGelbooruIdsContainer = E("div", { class: "gelbooru-ids" })
    private readonly statusContainer = E("div", { class: "status-container" }, [
        this.statusMessage,
        this.retryButton,
        this.progressBar,
        this.uploadPageButton,
        this.localGelbooruIdsContainer
    ])
    private readonly overlayContainer = E("div", { class: "artwork-overlay" }, [
        this.imageFilter,
        this.statusContainer
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

    constructor(img: HTMLImageElement) {
        this.img = img

        // Add overlay to image container
        const imgContainer = this.img.parentElement!
        imgContainer.style.position = "relative"
        imgContainer.appendChild(this.overlayContainer)
        ArtworkOverlay.imageContainerToOverlay.set(imgContainer, this)
        ArtworkOverlay.imageContainerObserver.observe(imgContainer, { childList: true }) 

        // Click overlay to hide it
        this.overlayContainer.addEventListener("click", async (event) => {
            const target = event.target as HTMLElement
            if (target.classList.contains("gelbooru-link")) return
            if (target.classList.contains("retry-button")) return
            if (target.classList.contains("upload-page-button")) return
            event.stopPropagation()
            event.preventDefault()
            this.hide()
        }, { capture: true })

        // Hide some elements initially
        this.overlayContainer.style.display = "none"
        this.overlayContainer.style.opacity = "0"
        this.progressBar.style.opacity = "0"
        this.retryButton.style.opacity = "0"
        this.retryButton.style.display = "none"
        this.uploadPageButton.style.opacity = "0"
        this.uploadPageButton.style.display = "none"
        this.localGelbooruIdsContainer.style.opacity = "0"

        // Use capturing listener for clicking links, otherwise Pixiv's listener
        // for zooming in on the image will fire instead
        this.localGelbooruIdsContainer.addEventListener("click", (event) => {
            if (!event.target) return
            const target = event.target as HTMLElement
            if (!target.classList.contains("gelbooru-link")) return
            event.stopImmediatePropagation()
            event.preventDefault()
            const url = (target as HTMLAnchorElement).href
            window.open(url, "_blank")?.focus()
        }, { capture: true })
    }

    show() {
        this.overlayContainer.style.display = "flex";
        anime({ targets: this.img, opacity: 0.4, duration: 200, easing: "linear" })
        return anime({ targets: this.overlayContainer, opacity: 1, duration: 200, easing: "linear" }).finished
    }

    hide() {
        anime({ targets: this.img, opacity: 1, duration: 180, easing: "linear" })
        return anime({ targets: this.overlayContainer, opacity: 0.0, duration: 180, easing: "linear" })
            .finished.then(() => { this.overlayContainer.style.display = "none" })
    }

    remove() {
        this.overlayContainer.remove()
    }

    // Update status of overlay for the image with given filename
    static update(filename: string, gelbooruIds: string[]) {
        if (!gelbooruIds.length) return
        const overlay = ArtworkOverlay.filenameToOverlay.get(filename)
        if (!overlay) return
        overlay.statusMessage.classList.remove("upload-prepared")
        overlay.imageFilter.classList.remove("upload-prepared")
        overlay.uploadPageButton.style.display = "none"
        overlay.setUploaded(gelbooruIds)
    }

    async downloadImage(url: string): Promise<string> {
        // Fetch image in the background script and display download progress
        let finished = false
        let showingProgressBar = false
        this.statusMessage.innerHTML = "Downloading"
        return new Promise<string>((resolve, reject) => {
            const downloadPort = browser.runtime.connect({ name: "image-download" })
            downloadPort.onMessage.addListener(async (message) => {
                if (message.type === "started") {
                    const { totalSize } = message.data
                    // Display progress bar if image size is known
                    // (add short delay so it doesn't flicker if download is almost instant)
                    window.setTimeout(() => {
                        if (!finished && totalSize) {
                            showingProgressBar = true
                            this.innerProgressBar.style.width = "0%"
                            anime({ targets: this.progressBar, opacity: 1, duration: 160, easing: "linear" })
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
                    if (showingProgressBar) {
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

    async conductCheck(dataUrl: string, url: string, pixivTags: PixivTags) {
        this.statusMessage.textContent = "Checking..."

        // Send image to Gelbooru upload extension
        let checkResult: { gelbooruIds?: string[], error?: string }
        try {
            checkResult = await browser.runtime.sendMessage(gelbooruUploadExtension, {
                type: "prepare-upload",
                data: {
                    file: dataUrl,
                    url,
                    pixivTags
                }
            })
        } catch (error) {
            checkResult = { error: `The extension "Improved Gelbooru upload"<br>must be enabled to conduct status checks!` }
        }

        // Click the retry-button to conduct a new check
        const retryListenerOptions = { capture: true }
        const retryButtonListener = (event: MouseEvent) => {
            event.stopImmediatePropagation()
            event.preventDefault()
            this.retryButton.removeEventListener("click", retryButtonListener, retryListenerOptions)
            this.statusMessage.classList.remove("check-failed")
            this.imageFilter.classList.remove("check-failed")
            anime({ targets: this.retryButton, opacity: 0, duration: 200, easing: "linear" })
            anime({ targets: this.imageFilter, opacity: 0, duration: 200, easing: "linear" })
            this.conductCheck(dataUrl, url, pixivTags)
        }

        // Display image check results received from upload extension
        this.imageFilter.style.width = `${this.img.offsetWidth}px`
        if (!checkResult.gelbooruIds) {
            this.statusMessage.textContent = "Check failed"
            if (checkResult.error) {
                this.statusMessage.innerHTML += "<br>(" + checkResult.error + ")"
                if (!checkResult.error.includes("too large") &&
                        !checkResult.error.includes("format not supported")) {
                    this.progressBar.style.display = "none"
                    this.retryButton.style.display = "block"
                    this.retryButton.addEventListener("click", retryButtonListener, retryListenerOptions)
                    anime({ targets: this.retryButton, opacity: 1, duration: 240, easing: "linear" })
                }
            }
            this.statusMessage.classList.add("check-failed")
            this.imageFilter.classList.add("check-failed")
            anime({ targets: this.imageFilter, opacity: 0.35, duration: 240, easing: "linear" })
            return
        }
        this.retryButton.style.display = "none"
        this.progressBar.style.display = "none"
        const gelbooruIds = checkResult.gelbooruIds
        if (gelbooruIds.length === 0) {
            this.statusMessage.textContent = "Upload ready"
            this.statusMessage.classList.add("upload-prepared")
            this.imageFilter.classList.add("upload-prepared")
            this.uploadPageButton.style.display = "block"
            const urlParts = url.split("/")
            const filename = urlParts[urlParts.length - 1]
            ArtworkOverlay.filenameToOverlay.set(filename, this)
            this.uploadPageButton.addEventListener("click", (event) => {
                event.stopImmediatePropagation()
                event.preventDefault()
                browser.runtime.sendMessage(gelbooruUploadExtension, {
                    type: "focus-tab",
                    args: { filename }
                })
            }, { capture: true })
            anime({ targets: this.uploadPageButton, opacity: 1, duration: 240, easing: "linear" })
            anime({ targets: this.imageFilter, opacity: 0.4, duration: 240, easing: "linear" })
        } else {
            this.setUploaded(gelbooruIds)
        }
    }

    private setUploaded(gelbooruIds: string[]) {
        this.statusMessage.textContent = "Already uploaded"
        this.statusMessage.classList.add("already-uploaded")
        this.imageFilter.classList.add("already-uploaded")
        const linkText = gelbooruIds.length === 1 ? "View post" : undefined
        gelbooruIds.forEach(id => createGelbooruLink(this.localGelbooruIdsContainer, id, linkText))
        this.localGelbooruIdsContainer.style.display = "block"
        anime({ targets: this.localGelbooruIdsContainer, opacity: 1, duration: 240, easing: "linear" })
        anime({ targets: this.imageFilter, opacity: 0.25, duration: 240, easing: "linear" })
    }
}