import browser from "webextension-polyfill";
import { E } from "./utility";
import anime from "animejs";
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

            // Ctrl + click element to search for Gelbooru uploads
            element.addEventListener("click", (event) => {
                if (!event.ctrlKey || !event.altKey) return
                event.preventDefault()
                event.stopImmediatePropagation()
                this.findGelbooruPosts(artistUrl)
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

    private async findGelbooruPosts(artistUrl: string) {
        this.overlay.style.opacity = "0"
        this.overlay.innerHTML = "Searching for posts...";
        this.overlay.classList.remove("hidden")
        anime({ targets: this.overlay, opacity: 1, duration: 140, easing: "linear" })
        try {
            const { numPixivIds } = await browser.runtime.sendMessage({
                type: "handle-artist-url",
                args: { url: artistUrl }
            })
            this.overlay.innerHTML =
                `Found ${numPixivIds} Pixiv posts that have<br>been uploaded to Gelbooru!`
        } catch (error) {
            this.overlay.innerHTML = `The extension "Improved Gelbooru upload"<br>must be enabled to conduct status checks!`
        }
    }
}