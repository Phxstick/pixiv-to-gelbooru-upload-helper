import { E } from "js/utility";
import "./select-widget.scss";

interface SelectValues {
    labels: string[]
    values: string[]
    defaultValue: string
}
interface SelectProps extends SelectValues {
    header: string
    onChange?: (value: string) => void
}

export default class SelectWidget {
    private selectElement: HTMLSelectElement
    private headerElement: HTMLElement
    private wrapper: HTMLElement

    constructor(props: SelectProps) {
        const { header, labels, values, defaultValue, onChange } = props
        this.headerElement = E("div", { class: "header" }, header),
        this.selectElement = E("select", {}) as HTMLSelectElement
        this.wrapper = E("div", { class: "select-widget" }, [
            this.headerElement,
            this.selectElement
        ])
        this.setValues({ labels, values, defaultValue })
        this.selectElement.addEventListener("change", () => {
            if (onChange) onChange(this.selectElement.value)
        })
    }

    setValues(valueDefinitions: SelectValues) {
        const { labels, values, defaultValue } = valueDefinitions
        if (labels.length !== values.length) {
            throw new Error("There must be as many labels as values.")
        }
        this.selectElement.innerHTML = ""
        for (let i = 0; i < labels.length; ++i) {
            const option = E("option", { value: values[i] }, labels[i])
            if (values[i] === defaultValue) {
                option.setAttribute("selected", "selected")
            }
            this.selectElement.appendChild(option)
        }
    }

    getElement() {
        return this.wrapper
    }
}
