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

export type PixivIdToGelbooruIds = Map<string, string[]>

export type PixivTags = { [key in string]: string }

export type ThumbnailSize = "small" | "medium" | "large"