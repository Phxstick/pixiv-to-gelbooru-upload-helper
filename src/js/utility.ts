
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
    onChange?: (value: boolean) => void
}
export function createToggle(props: ToggleProps) {
    let isChecked = false
    const element = E("div", { class: "ui toggle checkbox" }, [
        E("input", { type: "checkbox" }),
        E("label", {}, props.label)
    ])
    $(element).checkbox({
        onChange: () => {
            isChecked = $(element).checkbox("is checked")
            if (props.onChange) props.onChange(isChecked)
        }
    })
    if (props.defaultValue) {
        $(element).checkbox("set checked")
    }
    return element
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

export function createGelbooruLink(container: HTMLElement, gelbooruId: string, text?: string): HTMLElement {
    if (!text) text = (container.children.length + 1).toString()
    const href = "https://gelbooru.com/index.php?page=post&s=view&id=" + gelbooruId
    const link = E("a", { class: "gelbooru-link", target: "_blank", href }, text)
    container.appendChild(link)
    return link
}