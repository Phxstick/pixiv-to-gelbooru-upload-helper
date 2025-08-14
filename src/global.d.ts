declare const chrome: any;

declare var jQuery: JQueryStatic
declare var $: JQueryStatic
declare var chrome: any

// Defined in webpack.config.js
declare var PRODUCTION: boolean;
declare var UPLOAD_EXTENSION_ID: string;

// Remove this when Semantic UI typings are updated
declare namespace SemanticUI {
    namespace DropdownSettings {
        type Param = Partial<_Impl> & {
            clearable: boolean;
            delimiter: string;
        }
    }
    namespace SearchSettings {
        type Param = Partial<_Impl> & {
            searchOnFocus: boolean
            fullTextSearch: boolean
        }
    }
}