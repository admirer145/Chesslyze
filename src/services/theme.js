export const THEME_KEY = 'appTheme';

export const getStoredTheme = () => {
    if (typeof window === 'undefined') return 'dark';
    try {
        const stored = window.localStorage.getItem(THEME_KEY);
        return stored === 'light' || stored === 'dark' ? stored : 'dark';
    } catch {
        return 'dark';
    }
};

export const applyTheme = (theme) => {
    if (typeof document === 'undefined') return;
    const safeTheme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = safeTheme;
    document.documentElement.style.colorScheme = safeTheme;
};

export const setTheme = (theme) => {
    const safeTheme = theme === 'light' ? 'light' : 'dark';
    try {
        window.localStorage.setItem(THEME_KEY, safeTheme);
    } catch {
        // Ignore persistence failures
    }
    applyTheme(safeTheme);
    return safeTheme;
};
