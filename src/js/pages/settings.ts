import SettingsManager from "js/settings-manager";
import { MessageType, Settings } from "js/types";
import SelectWidget from "js/generic/select-widget";
import { createInput, createToggle, createToggleGroup, E } from "js/utility";
import browser from "webextension-polyfill";

import $ from "jquery";
window.$ = window.jQuery = $

import "fomantic-ui/dist/components/checkbox.min.js"
import "fomantic-ui/dist/components/checkbox.min.css"

import "fomantic-ui/dist/components/site.min.css"
import "fomantic-ui/dist/components/button.min.css"
import "fomantic-ui/dist/components/input.min.css"
import "fomantic-ui/dist/components/segment.min.css"
import "fomantic-ui/dist/components/icon.min.css"
import "fomantic-ui/dist/components/label.min.css"
import "fomantic-ui/dist/components/form.min.css"

import "./settings.scss"

window.onload = async () => {
    const darkMode = window.matchMedia('(prefers-color-scheme: dark)')
    document.body.classList.toggle("dark-mode", darkMode.matches)
    darkMode.addEventListener('change', (event) => {
        document.body.classList.toggle("dark-mode", event.matches)
    })

    const settingsDefinitions = SettingsManager.getDefinitions()
    const keyToRow: { [key in keyof Settings]?: HTMLElement } = {}
    const toggleSubsettingsFuncs: ((show?: boolean) => void)[] = []
    const settingsChangedListeners: ((settings: Settings) => void)[] = []
    const currentValues = await SettingsManager.getAll()
    const onSettingsChanged = async (key: keyof Settings) => {
        browser.runtime.sendMessage({ type: MessageType.SettingsChanged })
        const currentSettings = await SettingsManager.getAll()
        settingsChangedListeners.forEach(listener => listener(currentSettings))
    }
    for (const key in settingsDefinitions) {
        const settingKey = key as keyof Settings
        const definition = settingsDefinitions[settingKey]
        const currentValue = currentValues[settingKey]
        let element: HTMLElement
        let widget: any
        if (definition.type === "boolean") {
            let toggleSubsettings: (show?: boolean) => void = () => {}
            const subSettings = definition.subSettings
            if (subSettings) {
                toggleSubsettings = (show?: boolean) => {
                    if (show === undefined) show = currentValue as boolean
                    for (const subSettingKey of subSettings) {
                        const subSettingRow = keyToRow[subSettingKey]
                        subSettingRow && subSettingRow.classList.toggle("hidden", !show)
                    }
                }
                toggleSubsettingsFuncs.push(toggleSubsettings)
            }
            element = createToggle({
                label: definition.text,
                defaultValue: currentValue as boolean,
                onChange: (value) => {
                    SettingsManager.set(settingKey, value)
                    if (subSettings) toggleSubsettings(value)
                    onSettingsChanged(settingKey)
                }
            })
        } else if (definition.type === "string" || definition.type === "integer") {
            const input = createInput({
                type: definition.type,
                header: definition.text,
                value: currentValue as unknown as string,
                onChange: (value) => {
                    if (value.length === 0) {
                        SettingsManager.remove(settingKey)
                        input.setValue(SettingsManager.getDefaultValue(settingKey) as unknown as string)
                    } else {
                        SettingsManager.set(settingKey,
                            definition.type === "integer" ? parseInt(value) as any : value)
                    }
                    onSettingsChanged(settingKey)
                }
            })
            element = input.getElement()
        } else if (definition.type === "multi-select") {
            const { text, labels, values, atLeastOne } = definition
            const defaultValues: boolean[] = []
            const initialSelection = currentValue as string[]
            for (let i = 0; i < values.length; ++i) {
                defaultValues.push(initialSelection.includes(values[i]))
            }
            element = createToggleGroup({
                header: text,
                labels,
                defaultValues,
                atLeastOne,
                onChange: (flags) => {
                    const selection = []
                    for (let i = 0; i < values.length; ++i) {
                        if (flags[i]) selection.push(values[i])
                    }
                    SettingsManager.set(settingKey, selection)
                    onSettingsChanged(settingKey)
                }
            })
        } else if (definition.type === "select") {
            const { text, labels, values } = definition
            widget = new SelectWidget({
                header: text,
                labels,
                values,
                defaultValue: currentValue as string,
                onChange: (value) => {
                    SettingsManager.set(settingKey, value)
                    onSettingsChanged(settingKey)
                }
            })
            element = widget.getElement()
        } else {
            continue
        }
        const row = E("div", { class: "settings-row" }, [element])
        if (definition.details) {
            row.appendChild(E("div", { class: "setting-details" }, definition.details))
        }
        if (definition.onSettingsChanged) {
            const callback = definition.onSettingsChanged
            const listener = (settings: Settings) => {
                callback(row, widget || element, settings)
            }
            settingsChangedListeners.push(listener)
            listener(currentValues)
        }
        keyToRow[settingKey] = row
        document.body.appendChild(row)
    }
    for (const toggleSubsettingsFunc of toggleSubsettingsFuncs) {
        toggleSubsettingsFunc()
    }

    // Add buttons for saving/loading data backups
    const hiddenDownloadLink =
        E("a", { style: "display:none" }) as HTMLAnchorElement
    const hiddenUploadElement = E("input", {
        type: "file", accept: ".json", style: { display: "none" }
    }) as HTMLInputElement
    const createBackupButton =
        E("button", { class: "ui button" }, "Create data backup") as HTMLButtonElement
    const loadBackupButton =
        E("button", { class: "ui button" }, "Load data backup") as HTMLButtonElement
    const backupStatusMessage = E("div", { class: "status-message" })
    const backupRow = E("div", { class: "settings-row backup-buttons" }, [
        E("div", {}, [ createBackupButton, loadBackupButton ]),
        hiddenDownloadLink,
        hiddenUploadElement,
        backupStatusMessage,
        E("div", { class: "setting-details" },
            "Data consists of the cached upload status of checked artworks.")
    ])
    document.body.appendChild(backupRow)

    async function createBackup() {
        const data = await browser.storage.local.get()
        const blob = new Blob([JSON.stringify(data, null, 4)], {
            type: "application/json"
        })
        const url = URL.createObjectURL(blob)
        hiddenDownloadLink.href = url
        const date = new Date()
        const dateString = date.getFullYear() + "-" +
            (date.getMonth() + 1).toString().padStart(2, "0") + "-" +
            date.getDate().toString().padStart(2, "0")
        hiddenDownloadLink.download =
            `pixiv-upload-helper-backup-${dateString}.json`
        hiddenDownloadLink.click()
        setTimeout(() => URL.revokeObjectURL(url))
    }
    createBackupButton.addEventListener("click", createBackup)

    async function loadBackup(file: File) {
        const text = await file.text()
        const data = JSON.parse(text)
        const stored = await browser.storage.local.get()
        const pixivIds = new Set()
        if (Object.keys(data).length > 2)
            throw new Error("Only two hosting sites are currently supported.")
        const intRegex = /^[-0-9]*$/
        for (const hostKey in data) {
            const map = stored[hostKey] || {}
            for (const pixivId in data[hostKey]) {
                if (!intRegex.test(pixivId))
                    throw new Error(`Encountered invalid Pixiv ID: ${pixivId}`)
                const storedPostIds = map[pixivId] || []
                const loadedPostIds = data[hostKey][pixivId]
                if (!Array.isArray(loadedPostIds))
                    throw new Error("Invalid format.")
                for (const postId of loadedPostIds) {
                    if (!intRegex.test(postId))
                        throw new Error(`Encountered invalid post ID: ${postId}`)
                    if (!storedPostIds.includes(postId)) {
                        storedPostIds.push(postId)
                    }
                }
                map[pixivId] = storedPostIds
                pixivIds.add(pixivId)
            }
            stored[hostKey] = map
        }
        await browser.storage.local.set(stored)
        return pixivIds.size
    }
    hiddenUploadElement.addEventListener("change", async () => {
        const files = hiddenUploadElement.files
        if (!files || files.length === 0) return
        backupStatusMessage.textContent = "Loading backup data..."
        backupStatusMessage.classList.remove("success", "failure")
        loadBackupButton.disabled = true
        try {
            const n = await loadBackup(files[0])
            backupStatusMessage.textContent =
                `Successfully loaded upload status for ${n} Pixiv artworks.`
            backupStatusMessage.classList.add("success")
        } catch (error) {
            backupStatusMessage.textContent = `Failed to load backup data.`
            backupStatusMessage.classList.add("failure")
        }
        loadBackupButton.disabled = false
    })
    loadBackupButton.addEventListener("click", () => {
        hiddenUploadElement.click()
    })
}
