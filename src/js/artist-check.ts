import browser from "webextension-polyfill";
import SettingsManager from "js/settings-manager";
import { E, catchError } from "./utility";
import anime from "animejs";
import { HostName } from "./types";
import "./artist-check.scss";

interface ArtistContainer {
    element: HTMLElement
    artistUrl: string
}

export default class ArtistCheck {
    private readonly overlay = E("div", { class: "artist-check-overlay hidden" })
    private readonly globalKeydownListeners: any[] = []
    private readonly globalKeyupListeners: any[] = []

    constructor() {
        document.body.appendChild(this.overlay)
        this.overlay.addEventListener("click", async () => {
            await anime({ targets: this.overlay, opacity: 0, duration: 140, easing: "linear" }).finished
            this.overlay.classList.add("hidden")
            this.overlay.innerHTML = ""
        })
    }

    async handleContainers(containers: ArtistContainer[]) {
        if (!containers.length) return

        // Remove existing event listeners first
        this.globalKeydownListeners.forEach(listener =>
            window.removeEventListener("keydown", listener))
        this.globalKeyupListeners.forEach(listener =>
            window.removeEventListener("keyup", listener))

        for (const { element, artistUrl } of containers) {
            element.classList.add("artist-links-container")

            // Ctrl + alt + click element to search for posts
            element.addEventListener("click", (event) => {
                if (!event.ctrlKey || !event.altKey) return
                event.preventDefault()
                event.stopImmediatePropagation()
                this.handleSearch(event, artistUrl)
            })

            // Highlight artist when hovingering while pressing the key combination
            let hovering = false
            element.addEventListener("mouseenter", (event) => {
                hovering = true
                if (event.ctrlKey && event.altKey) {
                    element.classList.add("hovering")
                }
            })
            element.addEventListener("mouseleave", (event) => {
                hovering = false
                element.classList.remove("hovering")
            })
            const keyDownListener = (event: KeyboardEvent) => {
                if (!hovering) return
                if (event.ctrlKey && event.altKey) {
                    element.classList.add("hovering")
                }
            }
            const keyUpListener = (event: KeyboardEvent) => {
                if (!event.ctrlKey || !event.altKey) {
                    element.classList.remove("hovering")
                }
            }
            this.globalKeydownListeners.push(keyDownListener)
            this.globalKeyupListeners.push(keyUpListener)
            window.addEventListener("keydown", keyDownListener)
            window.addEventListener("keyup", keyUpListener)
        }
    }

    private async handleSearch(event: MouseEvent, artistUrl: string) {
        const settings = await SettingsManager.get(["enabledHosts"])
        const enabledHosts = settings.enabledHosts as HostName[]

        if (enabledHosts.length === 1) {
            this.findPosts(artistUrl, enabledHosts)
            return
        }

        const popupItems = []
        for (const host of Object.values(enabledHosts)) {
            const hostName = host[0].toUpperCase() + host.slice(1)
            const item = E("div", { class: "item" }, hostName)
            item.addEventListener("click", () => {
                this.findPosts(artistUrl, [host] as HostName[])
            })
            popupItems.push(item)
        }

        const allHostsItem = E("div", { class: "item" }, "All hosts")
        allHostsItem.addEventListener("click", () => {
            this.findPosts(artistUrl, enabledHosts)
        })
        popupItems.push(allHostsItem)

        const hostSelectionPopup = E("div", { class: "host-selection-popup" }, [
            E("div", { class: "header" }, "Choose a host:"),
            ...popupItems
        ])

        const closePopup = () => {
            hostSelectionPopup.remove()
            window.removeEventListener("keydown", escapeListener)
            window.removeEventListener("click", clickListener)
        }
        const escapeListener = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return
            closePopup()
        }
        const clickListener = () => {
            closePopup()
        }
        window.addEventListener("keydown", escapeListener)
        window.addEventListener("click", clickListener)

        hostSelectionPopup.style.left = `${event.clientX}px`
        hostSelectionPopup.style.top = `${event.clientY}px`
        document.body.appendChild(hostSelectionPopup)
    }

    private async findPosts(artistUrl: string, hosts: HostName[]) {
        this.overlay.style.opacity = "0"
        this.overlay.innerHTML = "Searching for posts...";
        this.overlay.classList.remove("hidden")
        anime({ targets: this.overlay, opacity: 1, duration: 140, easing: "linear" })

        const [result, error] = await catchError(() =>
            browser.runtime.sendMessage({
                type: "find-posts-by-artist",
                args: { url: artistUrl, hosts }
            })
        )
        if (error) {
            this.overlay.innerHTML =
                `The extension "Improved Gelbooru upload"<br>` +
                `must be enabled to conduct status checks!`
            return
        }
        const { pixivIds, numPosts } = result

        let numPostsTotal = 0
        for (const host in numPosts) numPostsTotal += numPosts[host]
        if (numPostsTotal === 0) {
            this.overlay.innerHTML =
                `No posts have been found for Pixiv artworks by this artist.`
            return
        }

        if (hosts.length === 1) {
            const host = hosts[0]
            const hostString = host[0].toUpperCase() + host.slice(1)
            this.overlay.innerHTML =
                `Found ${numPosts[host]} ${hostString} posts<br>` +
                `for ${pixivIds.length} Pixiv artworks!`
            return
        }

        this.overlay.innerHTML =
            `Found matching posts for ${pixivIds.length} Pixiv artworks:`
        for (const host in numPosts) {
            const hostString = host[0].toUpperCase() + host.slice(1)
            this.overlay.innerHTML +=
                `<br>${numPosts[host]} ${hostString} posts`
        }
    }
}
