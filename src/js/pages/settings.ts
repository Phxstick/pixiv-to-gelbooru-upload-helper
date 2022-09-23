import SettingsManager from "js/settings-manager";
import { Settings } from "js/types";
import { createInput, createToggle, E } from "js/utility";
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
    const settingsDefinitions = SettingsManager.getDefinitions()
    const keyToRow: { [key in keyof Settings]?: HTMLElement } = {}
    const toggleSubsettingsFuncs: ((show?: boolean) => void)[] = []
    const values = await SettingsManager.getAll()
    for (const key in settingsDefinitions) {
        const settingKey = key as keyof Settings
        const definition = settingsDefinitions[settingKey]
        const currentValue = values[settingKey]
        let element: HTMLElement
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
                    browser.runtime.sendMessage({ type: "settings-changed" })
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
                    browser.runtime.sendMessage({ type: "settings-changed" })
                }
            })
            element = input.getElement()
        } else {
            continue
        }
        const row = E("div", { class: "settings-row" }, [element])
        if (definition.details) {
            row.appendChild(E("div", { class: "setting-details" }, definition.details))
        }
        keyToRow[settingKey] = row
        document.body.appendChild(row)
    }
    for (const toggleSubsettingsFunc of toggleSubsettingsFuncs) {
        toggleSubsettingsFunc()
    }
}
