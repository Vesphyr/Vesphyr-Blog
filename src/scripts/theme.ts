import { DARK_MODE } from "@constants/constants";
import { applyThemeToDocument } from "@utils/theme-utils";

declare global {
    interface Window {
        theme?: {
            themeValue: "dark";
        };
    }
}

applyThemeToDocument(DARK_MODE);
