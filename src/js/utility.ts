import browser from "webextension-polyfill";
import { HostName, BooruPost } from "./types"

export function E(type: string, props?: any, children?: (HTMLElement | string)[] | string): HTMLElement {
    const element = document.createElement(type);
    if (props !== undefined) {
        for (const prop in props) {
            if (prop === "dataset") {
                for (const key in props.dataset) {
                    element.setAttribute(`data-${key}`, props.dataset[key].toString())
                }
            } else if (prop === "style") {
                for (const key in props.style) {
                    element.style.setProperty(key, props.style[key])
                }
            } else if (props[prop] !== undefined) {
                element.setAttribute(prop, props[prop])
            }
        }
    }
    if (children !== undefined) {
        if (typeof children === "string") {
            element.innerHTML = children;
        } else {
            for (const child of children) {
                element.append(child);
            }
        }
    }
    return element
}

interface ToggleProps {
    label: string
    defaultValue: boolean
    canToggle?: (value: boolean) => boolean | Promise<boolean>
    onChange?: (value: boolean) => void
}

export function createToggle(props: ToggleProps) {
    const element = E("div", { class: "ui toggle checkbox" }, [
        E("input", { type: "checkbox" }),
        E("label", {}, props.label)
    ])
    $(element).checkbox({
        beforeChecked: () => {
            if (!props.canToggle) return
            Promise.resolve(props.canToggle(true)).then((allowed) => {
                if (!allowed) return
                $(element).checkbox("set checked")
                if (props.onChange) props.onChange(true)
            })
            return false
        },
        beforeUnchecked: () => {
            if (!props.canToggle) return
            Promise.resolve(props.canToggle(false)).then((allowed) => {
                if (!allowed) return
                $(element).checkbox("set unchecked")
                if (props.onChange) props.onChange(false)
            })
            return false
        },
        onChange: () => {
            if (props.canToggle) return
            const isChecked = $(element).checkbox("is checked")
            if (props.onChange) props.onChange(isChecked)
        }
    })
    if (props.defaultValue) {
        $(element).checkbox("set checked")
    }
    return element
}

interface ToggleGroupProps {
    header: string
    labels: string[]
    defaultValues: boolean[]
    onChange?: (values: boolean[]) => void
    atLeastOne?: boolean
}
export function createToggleGroup(props: ToggleGroupProps) {
    const { header, labels, defaultValues, onChange, atLeastOne } = props
    if (labels.length !== defaultValues.length) {
        throw new Error("There must be as many labels as values.")
    }
    const currentValues = [...defaultValues]
    const togglesContainer = E("div", { class: "toggles-container" })
    const wrapper = E("div", { class: "toggle-group" }, [
        E("div", { class: "header" }, header),
        togglesContainer
    ])
    for (let i = 0; i < labels.length; ++i) {
        const toggle = createToggle({
            label: labels[i],
            defaultValue: defaultValues[i],
            onChange: (value) => {
                currentValues[i] = value
                if (onChange) onChange(currentValues)
            },
            canToggle: (value) => {
                if (!atLeastOne) return true
                let numSelected = 0
                for (let j = 0; j < labels.length; ++j) {
                    if (currentValues[j]) numSelected += 1
                }
                if (numSelected === 1 && currentValues[i] && !value) {
                    alert("At least one option must be selected.")
                    return false
                }
                return true
            }
        })
        togglesContainer.appendChild(toggle)
    }
    return wrapper
}

interface InputProps {
    header?: string
    value: string
    onChange?: (value: string) => void
    type?: "string" | "integer"
}
export function createInput(props: InputProps) {
    const { header, value, onChange, type } = props
    const field = E("div", { class: "field" })
    const element = E("div", { class: "ui form" }, [field])
    if (header) {
        field.appendChild(E("label", {}, header))
    }
    const input = E("input", { type: "text" }) as HTMLInputElement
    if (value !== undefined) input.value = value
    field.appendChild(input)
    if (type === "integer") {
        input.addEventListener("input", () => {
            input.value = input.value.replaceAll(/[^0-9]/g, "")
        })
    }
    let previousValue: string
    input.addEventListener("focusin", () => {
        previousValue = input.value.trim()
    })
    const checkChange = () => {
        const newValue = input.value.trim()
        if (previousValue === newValue) return
        if (onChange) onChange(newValue)
    }
    input.addEventListener("focusout", checkChange)
    window.addEventListener("beforeunload", checkChange)
    return {
        getElement: () => element,
        getValue: () => input.value,
        setValue: (value: string) => {
            input.value = value
        }
    }
}

export function createPostLink(
    container: HTMLElement,
    postId: string,
    host: HostName,
    text?: string,
    post?: BooruPost,
    showScore = false,
    showThumbnail = false
): HTMLElement {
    const iconUrl = browser.runtime.getURL(`icons/${host}-favicon.png`)
    const content = showThumbnail && post ? [E("img", {
        class: "post-thumbnail",
        src: post.thumbnailUrl
    })] : text ? [E("span", {}, text)] : [E("img", { src: iconUrl })]
    if (post && showScore) {
        const score = Math.max(post.score, post.favCount || 0)
        const scoreString = `${score} \u{21E7}`
        const textContent = text ? `(${scoreString})` : scoreString 
        content.push(E("span", { class: "upvotes" }, textContent))
    }
    let href: string
    if (host === HostName.Gelbooru) {
        href = "https://gelbooru.com/index.php?page=post&s=view&id=" + postId
    } else if (host === HostName.Danbooru) {
        href = "https://danbooru.donmai.us/posts/" + postId
    } else {
        throw new Error(`Unknown image host ${host}.`)
    }
    const classString = "post-link" + (text ? "" :
        (showThumbnail ? " with-thumbnail" : " only-icon"))
    const link = E("a", { class: classString, target: "_blank", href }, content)
    container.appendChild(link)
    return link
}

type Func<T> = () => (T | Promise<T>)
type ResultAndError<T> = [T, null] | [null, Error]

export async function catchError<T>(func: Func<T>): Promise<ResultAndError<T>> {
    try {
        const result = await func()
        return [result, null]
    } catch (error) {
        if (error instanceof Error) {
            return [null, error]
        } else if (typeof error === "string") {
            return [null, new Error(error)]
        } else {
            return [null, new Error("Internal error")]
        }
    }
}

export function isEqual<T>(value1: T, value2: T): boolean {
    if (Array.isArray(value1)) {
        const a1 = value1 as Array<any>
        const a2 = value2 as Array<any>
        if (a1.length !== a2.length) return false
        for (let i = 0; i < a1.length; ++i) {
            if (a1[i] !== a2[i]) {
                return false
            }
        }
        return true
    } else {
        return value1 === value2
    }
}