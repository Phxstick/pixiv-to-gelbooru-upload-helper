export interface Settings {
    showThumbnailStatus: boolean
    hideRelatedPixivPics: boolean
    hidePixivHeader: boolean
}

export type SettingType = "boolean" | "string" | "string-list" | "integer"

export type SettingsDefinition = {
    [key in keyof Settings]: {
        type: SettingType,
        text: string,
        details?: string,
        subSettings?: (keyof Settings)[]
    }
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
