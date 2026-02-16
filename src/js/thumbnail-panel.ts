import browser from "webextension-polyfill";
import { ThumbnailSize, PostHost, HostMaps, StatusUpdate, MessageType, SourceHost } from "./types";
import { createPostLink, E } from "./utility"
import "./thumbnail-panel.scss"

/**
 * Panel which is displayed above the thumbnail of a link to a Pixiv artwork.
 * It contains a list of links to the corresponding posts on image hosting sites
 * and an input field for manually associating a post with this artwork.
 */
export default class ThumbnailPanel {
    private currentPixivId = ""
    private readonly hostMaps: HostMaps

    private readonly linkContainer = E("div", { class: "post-ids-container" })
    private readonly input = E("input", {
        class: "post-id-input",
        placeholder: "Enter post URL"
    }) as HTMLInputElement
    private readonly wrapper = E("div", { class: "thumbnail-panel" }, [
        this.linkContainer,
        this.input
    ])

    constructor(sourceHost: SourceHost, hostMaps: HostMaps, size: ThumbnailSize) {
        this.hostMaps = hostMaps

        this.input.addEventListener("keypress", (event) => {
            if (event.key !== "Enter") return
            if (!this.currentPixivId) return
            let result = this.parsePostUrl(this.input.value.trim())
            this.input.value = ""
            if (!result) {
                window.alert("The entered value is not a valid URL " +
                    "(it must point to a post on a known image hosting site)")
                return
            }
            const { postId, host } = result
            createPostLink(this.linkContainer, postId, host)
            const statusUpdate: StatusUpdate = {
                // TODO: adjust based on host
                sourceHost,
                sourceIdToPostIds: {
                    [this.currentPixivId]: {
                        [host]: [postId]
                    }
                }
            }
            browser.runtime.sendMessage({
                type: MessageType.StatusUpdate,
                args: statusUpdate
            })
        })
        this.wrapper.classList.add(size)
        if (size === "small") {
            this.input.placeholder = "Enter URL"
        }

        // Click somewhere outside of the panel to hide it
        window.addEventListener("click", (event) => {
            if (!this.currentPixivId) return
            if (this.wrapper.contains(event.target as HTMLElement)) return
            this.hide()
        }, { capture: true })

        // Clicking the panel shouldn't do anything
        this.wrapper.addEventListener("click", (event) => {
            event.stopImmediatePropagation()
        })
    }

    attachTo(thumbnailContainer: HTMLElement) {
        // Ctrl + alt + click an artwork link to display the panel
        thumbnailContainer.addEventListener("click", (event) => {
            if (!(event.ctrlKey || event.metaKey) || !event.altKey) return
            const thumbnail = (event.target as HTMLElement).closest(".handled")
            if (thumbnail === null) return
            this.display(thumbnail as HTMLElement)
            event.stopImmediatePropagation()
            event.preventDefault()
        })
    }

    private parsePostUrl(value: string): { postId: string, host: PostHost } | undefined {
        let url
        try {
             url = new URL(value)
        } catch (error) {
            return
        }
        if (url.host === "gelbooru.com") {
            if (!url.searchParams.has("id")) return
            return {
                postId: url.searchParams.get("id")!,
                host: PostHost.Gelbooru
            }
        } else if (url.host === "danbooru.donmai.us") {
            const parts = url.pathname.slice(1).split("/")
            if (parts.length !== 2) return
            if (parts[0] !== "posts") return
            if (isNaN(parts[1] as any)) return
            return {
                postId: parts[1],
                host: PostHost.Danbooru
            }
        }
    }
 
    private display(thumbnail: HTMLElement) {
        const linkElement = thumbnail.querySelector("a")
        if (linkElement === null) return
        this.currentPixivId = linkElement.dataset.gtmValue!
        this.input.value = ""
        this.linkContainer.innerHTML = ""
        for (const key in this.hostMaps) {
            const host = key as PostHost
            const pixivIdToPostIds = this.hostMaps[host]!
            const postIds = pixivIdToPostIds.get(this.currentPixivId) || []
            postIds.forEach(id => createPostLink(this.linkContainer, id, host))
        }
        thumbnail.classList.add("showing-thumbnail-panel")
        linkElement.parentElement!.prepend(this.wrapper)
    }

    private hide() {
        this.currentPixivId = ""
        const thumbnailElement = this.wrapper.closest(".showing-thumbnail-panel")
        this.wrapper.remove()
        if (thumbnailElement === null) return
        thumbnailElement.classList.remove("showing-thumbnail-panel")
    }
}
