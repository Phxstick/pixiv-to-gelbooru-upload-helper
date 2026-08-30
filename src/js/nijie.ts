import { SourceHostInterface } from "./source-host";
import { SourceHost } from "./types";

export class Nijie implements SourceHostInterface {
    name = SourceHost.Nijie

    extractSourceId(element: HTMLElement) {
        const aElement = element.tagName === "A" ?
            element as HTMLAnchorElement : element.querySelector("a")
        if (!aElement) return null
        const url = new URL(aElement.href)
        if (url.pathname !== "/view.php" && url.pathname !== "/view_popup.php") return null
        return url.searchParams.get("id")
    }

   setThumbnailClasses(element: HTMLElement) {
        if (element.tagName === "A") {
            element.classList.add("huge")
        } else {
            const aElement = element.querySelector("a")!
            if (aElement.id === "nextIllust" || aElement.id === "backIllust") {
                element.classList.add("small")
            } else {
                element.classList.add("large")
            }
        }
    }
}