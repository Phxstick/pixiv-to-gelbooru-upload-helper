import SettingsManager from "js/settings-manager";
import { Settings } from "js/types";
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
        browser.runtime.sendMessage({ type: "settings-changed" })
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
}
