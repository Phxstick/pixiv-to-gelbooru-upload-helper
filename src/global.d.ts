import { Storage } from "webextension-polyfill";

declare const chrome: any;

declare global {
    const chrome: any
    interface Window {
        $: JQueryStatic,
        jQuery: JQueryStatic
        chrome: any
    }
}


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

// Following is only implemented in Chrome
declare module "webextension-polyfill" {
    namespace Storage {
        interface SessionStorageArea extends StorageArea {
            QUOTA_BYTES: 1048576;
        }
        interface Static {
            session: SessionStorageArea;
        }
    }
}