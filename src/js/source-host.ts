import { SourceHost, SourceId } from "./types";

export interface SourceHostInterface {
    name: SourceHost
    extractSourceId(element: HTMLElement): SourceId | Promise<SourceId | null> | null
    setThumbnailClasses(element: HTMLElement): void
}