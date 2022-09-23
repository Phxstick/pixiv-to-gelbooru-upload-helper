import browser from "webextension-polyfill"
import { Settings, SettingsDefinition } from "js/types";

type SettingKey = keyof Settings
type SettingValue<Key extends SettingKey> = Settings[Key]

class SettingsManager {
    private static readonly defaults: Settings = {
        showThumbnailStatus: true,
        hideRelatedPixivPics: false,
        hidePixivHeader: false
    }

    public static getDefaultValues(): Settings {
        return { ...SettingsManager.defaults }
    }

    public static getDefinitions(): SettingsDefinition {
        return {
            showThumbnailStatus: {
                type: "boolean",
                text: "Mark thumbnails according to whether the artwork has been uploaded to Gelbooru"
            },
            hideRelatedPixivPics: {
                type: "boolean",
                text: "Hide related Pixiv posts at the bottom of artwork pages"
            },
            hidePixivHeader: {
                type: "boolean",
                text: "Hide navigation bar at the top of artwork pages"
            }
        }
    }

    private static getStorageKey(key: SettingKey): string {
        return "setting-" + key
    }

    public static async set<
        Key extends SettingKey,
        Value extends SettingValue<Key>
    >(key: Key, value: Value) {
        const storageKey = this.getStorageKey(key)
        const storageUpdate = { [storageKey]: value }  
        await browser.storage.sync.set(storageUpdate)
    }

    public static async get<
        Key extends SettingKey,
        Value extends SettingValue<Key>
    >(keys: Key[]): Promise<{ [key in Key]: Value }> {
        const storageKeys = keys.map(key => this.getStorageKey(key))
        const values = await browser.storage.sync.get(storageKeys)
        const keyToValue: any = {}
        for (const key of keys) {
            const storageKey = this.getStorageKey(key)
            keyToValue[key] = values[storageKey] !== undefined ?
                values[storageKey] : this.defaults[key]
        }
        return keyToValue
    }

    public static async remove<
        Key extends SettingKey
    >(key: Key) {
        const storageKey = this.getStorageKey(key)
        await browser.storage.sync.remove(storageKey)
    }

    public static getDefaultValue<
        Key extends SettingKey,
        Value extends SettingValue<Key>
    >(key: Key): Value {
        return this.defaults[key] as Value
    }

    public static async getAll(): Promise<Settings> {
        const keys = Object.keys(SettingsManager.defaults) as (keyof Settings)[]
        const storageKeys = keys.map(key => SettingsManager.getStorageKey(key))
        const values = await browser.storage.sync.get(storageKeys)
        const settings: any = {}
        for (const key of keys) {
            const storageKey = this.getStorageKey(key)
            settings[key] = values[storageKey] !== undefined ?
                values[storageKey] : this.defaults[key]
        }
        return settings as Settings
    }
}

export default SettingsManager