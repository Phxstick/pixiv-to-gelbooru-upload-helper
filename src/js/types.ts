export interface Settings {
    showThumbnailStatus: boolean
    hideRelatedPixivPics: boolean
    hideOtherPicsByArtist: boolean
    hidePixivHeader: boolean
    showPostScore: boolean
    enabledHosts: string[]
    defaultHost: string | "all-hosts"
}

export type SettingType = "boolean" | "string" | "integer" | "select" | "multi-select"

type SettingsChangedListener = (row: HTMLElement, widget: any, settings: Settings) => void

interface BaseSetting {
    type: SettingType
    text: string
    details?: string
    onSettingsChanged?: SettingsChangedListener
}
interface BooleanSetting extends BaseSetting {
    type: "boolean"
    subSettings?: (keyof Settings)[]
}
interface PrimitiveSetting extends BaseSetting {
    type: "string" | "integer"
}
interface SelectSetting extends BaseSetting {
    type: "select" | "multi-select"
    labels: string[]
    values: string[]
    atLeastOne?: boolean
}

type SettingDetails = BooleanSetting | PrimitiveSetting | SelectSetting

export type SettingsDefinition = {
    [key in keyof Settings]: SettingDetails
}

export type SourceId = string
export type PostId = string

export type SourceIdToPostIds = Map<SourceId, PostId[]>
export type HostMaps = { [key in PostHost]?: SourceIdToPostIds } 

export type ArtworkTags = { [key in SourceId]: string }

export type ThumbnailSize = "small" | "medium" | "large"

export enum PostHost {
    Gelbooru = "gelbooru",
    Danbooru = "danbooru"
}

export enum SourceHost {
    Pixiv = "pixiv",
    Nijie = "nijie"
}

export type UploadStatus = {
    [key in PostHost]?: string[]
}

export type StatusMap = {
    // Key can be source ID or filename
    [key in string]: UploadStatus
}

export interface BooruPost {
    id: number
    md5: string
    source: string
    thumbnailUrl: string
    score: number
    creationDate: string
    favCount?: number
}

export type PostsMap = {
    [key in PostHost]?: { [key in number]: BooruPost }
}

export class UploadExtensionCommunicationError extends Error {
    constructor() {
        super("UploadExtensionCommunicationError")
        this.name = "UploadExtensionCommunicationError"
    }
}

export interface StatusUpdate {
    sourceHost: SourceHost
    sourceIdToPostIds: StatusMap
    filenameToPostIds?: StatusMap
    posts?: PostsMap
}

export enum MessageType {
    StatusUpdate = "status-update",
    SettingsChanged = "settings-changed",
    DownloadImage = "download-image",
    FindPostsByArtist = "find-posts-by-artist",
    GetPostStatus = "get-post-status",
    UrlChanged = "url-changed"
}

export type Message = {
    type: MessageType.StatusUpdate,
    args: StatusUpdate
} | {
    type: MessageType.SettingsChanged,
    args: { settings: Settings }
} | {
    type: MessageType.DownloadImage,
    args: { url: string }
} | {
    type: MessageType.GetPostStatus,
    args: {
        sourceHost: SourceHost,
        sourceIds: SourceId[],
        postHosts: PostHost[]
    }
} | {
    type: MessageType.UrlChanged,
    args: undefined
}

export type GetArtworkHandler =
    (clickedImg: HTMLImageElement) => { container: HTMLElement, url: string } | null