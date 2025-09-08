import browser from "webextension-polyfill"
import { Settings, SettingsDefinition, HostName } from "js/types";
import SelectWidget from "js/generic/select-widget";

type SettingKey = keyof Settings
type SettingValue<Key extends SettingKey> = Settings[Key]

class SettingsManager {
    private static readonly defaults: Settings = {
        showThumbnailStatus: true,
        showPostScore: false,
        hideRelatedPixivPics: false,
        hideOtherPicsByArtist: false,
        hidePixivHeader: false,
        enabledHosts: [HostName.Gelbooru],
        defaultHost: HostName.Gelbooru
    }

    public static getDefaultValues(): Settings {
        return { ...SettingsManager.defaults }
    }

    public static getDefinitions(): SettingsDefinition {
        return {
            showThumbnailStatus: {
                type: "boolean",
                text: "Mark thumbnails according to whether the artwork has been uploaded to an image board",
                details: "If a Pixiv post contains multiple images, it's enough for one of them to be uploaded already."
            },
            showPostScore: {
                type: "boolean",
                text: "Display the scores (upvotes) of posts on image boards"
            },
            hideRelatedPixivPics: {
                type: "boolean",
                text: "Hide related Pixiv artworks at the bottom of artwork pages"
            },
            hideOtherPicsByArtist: {
                type: "boolean",
                text: "Hide other artworks by the same artist at the bottom of artwork pages"
            },
            hidePixivHeader: {
                type: "boolean",
                text: "Hide navigation bar at the top of artwork pages"
            },
            enabledHosts: {
                type: "multi-select",
                text: "Enabled image boards:",
                labels: Object.keys(HostName),
                values: Object.values(HostName),
                atLeastOne: true
            },
            defaultHost: {
                type: "select",
                text: "Default image board:",
                labels: [],
                values: [],
                details:
                    "This option will be used when checking an image using ctrl + click.<br>" +
                    "Use <b>shift</b> + ctrl + click to select one of the enabled sites.<br>" +
                    "Use <b>alt</b> + ctrl + click to check all sites at once.",
                onSettingsChanged: (row: HTMLElement, widget: SelectWidget, settings: Settings) => {
                    row.classList.toggle("hidden", settings.enabledHosts.length === 1)
                    let defaultHost = settings.defaultHost
                    if (!settings.enabledHosts.includes(defaultHost)) {
                        defaultHost = settings.enabledHosts[0]
                        SettingsManager.set("defaultHost", defaultHost)
                    }
                    if (settings.enabledHosts.length <= 1) return
                    widget.setValues({
                        values: [...settings.enabledHosts, "all-hosts"],
                        labels: [...settings.enabledHosts.map(
                            host => host[0].toUpperCase() + host.slice(1)), "All sites"],
                        defaultValue: defaultHost
                    })
                }
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
