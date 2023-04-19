export interface Settings {
    showThumbnailStatus: boolean
    hideRelatedPixivPics: boolean
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

export type PixivId = string

export type PixivIdToPostIds = Map<PixivId, string[]>
export type HostMaps = { [key in HostName]?: PixivIdToPostIds } 

export type PixivTags = { [key in PixivId]: string }

export type ThumbnailSize = "small" | "medium" | "large"

export enum HostName {
    Gelbooru = "gelbooru",
    Danbooru = "danbooru"
}

export type UploadStatus = {
    [key in HostName]?: string[]
}

export type StatusMap = {
    // Key can be Pixiv ID or filename
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
    [key in HostName]?: { [key in number]: BooruPost }
}
