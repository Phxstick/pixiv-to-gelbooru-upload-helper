import { SourceHostInterface } from "./source-host";
import { SourceHost, SourceId } from "./types";

export class Pixiv implements SourceHostInterface {
    name = SourceHost.Pixiv

    extractSourceId(element: HTMLElement) {
        const linkElement = element.querySelector("a")
        if (linkElement !== null) return this.handleLinkElement(linkElement)
        // <a> element in subtree of a link might not be present immediately,
        // in that case use an childList observer to determine when it appears
        // TODO: observer remains if link never appears, potential memory leak?
        return new Promise<string | null>((resolve, reject) => {
            const linkLoadObserver = new MutationObserver(() => {
                const linkElement = element.querySelector("a")
                if (linkElement === null) return
                const pixivId = this.handleLinkElement(linkElement)
                linkLoadObserver.disconnect()
                resolve(pixivId)
            })
            linkLoadObserver.observe(element, { childList: true, subtree: true })
        })
    }

    private handleLinkElement(element: HTMLAnchorElement): SourceId | null {
        if (element.href.includes("booth") || element.href.includes("sketch"))
            return null
        if (!element.dataset.gtmValue) {
            if (!PRODUCTION) {
                console.log("Missing source ID:", element)
                alert("Source ID extraction error.")
            }
            throw new Error("Couldn't find source ID for link element.")
        }
        return element.dataset.gtmValue
    }

   setThumbnailClasses(element: HTMLElement) {
        const sizeElement = element.querySelector("div[height]")
        const height = sizeElement && sizeElement.getAttribute("height")
        if (height && parseInt(height) > 160) element.classList.add("large")
    }
}