import browser from "webextension-polyfill";
import { PixivIdToGelbooruIds, ThumbnailSize } from "./types";
import { createGelbooruLink, E } from "./utility"
import "./thumbnail-panel.scss"

/**
 * Panel which is displayed above the thumbnail of a link to a Pixiv artwork.
 * It contains a list of links to the corresponding Gelbooru posts and an input
 * field for manually associating a Gelbooru ID with this artwork.
 */
export default class ThumbnailPanel {
    private currentPixivId = ""
    private readonly pixivIdToGelbooruIds: PixivIdToGelbooruIds

    private readonly linkContainer = E("div", { class: "gelbooru-ids-container" })
    private readonly input = E("input", {
        class: "gelbooru-id-input",
        placeholder: "Enter Gelbooru ID"
    }) as HTMLInputElement
    private readonly wrapper = E("div", { class: "thumbnail-panel" }, [
        this.linkContainer,
        this.input
    ])

    constructor(pixivIdsToGelbooruIds: PixivIdToGelbooruIds, size: ThumbnailSize) {
        this.pixivIdToGelbooruIds = pixivIdsToGelbooruIds

        this.input.addEventListener("keypress", (event) => {
            if (event.key !== "Enter") return
            if (!this.currentPixivId) return
            let gelbooruId = this.input.value.trim()
            try {
                const url = new URL(gelbooruId)
                if (url.searchParams.has("id")) {
                    gelbooruId = url.searchParams.get("id")!
                }
            } catch (error) {}
            this.input.value = ""
            if (!gelbooruId) return
            createGelbooruLink(this.linkContainer, gelbooruId)
            browser.runtime.sendMessage({
                type: "pixiv-status-update",
                args: { pixivIdToGelbooruIds: { [this.currentPixivId]: [gelbooruId] } }
            })
        })
        this.wrapper.classList.add(size)
        if (size === "small") {
            this.input.placeholder = "Gelbooru ID"
        }

        // Click somewhere outside of the panel to hide it
        window.addEventListener("click", (event) => {
            if (!this.currentPixivId) return
            if (this.wrapper.contains(event.target as HTMLElement)) return
            this.hide()
        }, { capture: true })
    }

    attachTo(thumbnailContainer: HTMLElement) {
        // Ctrl + click an artwork link to display the panel
        thumbnailContainer.addEventListener("click", (event) => {
            if (!event.ctrlKey || !event.altKey) return
            const thumbnail = (event.target as HTMLElement).closest("[type='illust']")
            if (thumbnail === null) return
            this.display(thumbnail as HTMLElement)
            event.stopImmediatePropagation()
            event.preventDefault()
        })
    }
 
    private display(thumbnail: HTMLElement) {
        const linkElement = thumbnail.querySelector("a")
        if (linkElement === null) return
        this.currentPixivId = linkElement.dataset.gtmValue!
        const gelbooruIds = this.pixivIdToGelbooruIds.get(this.currentPixivId) || []
        this.linkContainer.innerHTML = ""
        gelbooruIds.forEach(id => createGelbooruLink(this.linkContainer, id))
        this.input.value = ""
        thumbnail.classList.add("showing-thumbnail-panel")
        thumbnail.appendChild(this.wrapper)
    }

    private hide() {
        this.currentPixivId = ""
        this.wrapper.parentElement!.classList.remove("showing-thumbnail-panel")
        this.wrapper.remove()
    }
}