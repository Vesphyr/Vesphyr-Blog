import { DARK_MODE } from "@constants/constants";
import type { LIGHT_DARK_MODE } from "@/types/config";

export const THEME_STORAGE_KEY = "theme";

export function syncThemeMetaColor(): void {
	const body = document.body;
	if (!body) return;

	const bgColor = window.getComputedStyle(body).backgroundColor;
	document
		.querySelector("meta[name='theme-color']")
		?.setAttribute("content", bgColor);
}

export function applyThemeToDocument(theme: LIGHT_DARK_MODE): void {
	const root = document.documentElement;

	root.classList.add("dark");
	root.setAttribute("data-theme", theme);
	root.setAttribute("data-color-scheme", "dark");
	root.setAttribute("data-shiki-theme", "github-dark");

	syncThemeMetaColor();
}

export function setThemePreference(theme: LIGHT_DARK_MODE): void {
	localStorage.setItem(THEME_STORAGE_KEY, theme);
	applyThemeToDocument(theme);
}
