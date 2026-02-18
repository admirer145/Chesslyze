const LEGACY_ENGINE_KEYS = [
    'engineProfiles',
    'activeEngineProfileId',
    'engineDepth',
    'engineMultiPv',
    'engineDeepDepth',
    'engineHash',
    'engineThreads',
    'engineTimePerMove',
    'engineUseNNUE',
    'enginePreset'
];

export const hasExistingEngineSettings = () => {
    if (typeof window === 'undefined') return false;
    try {
        for (const key of LEGACY_ENGINE_KEYS) {
            if (localStorage.getItem(key) !== null) return true;
        }
    } catch {
        // ignore
    }
    return false;
};

export const isMobileDevice = () => {
    if (typeof navigator === 'undefined') return false;

    const uaData = navigator.userAgentData;
    if (uaData && typeof uaData.mobile === 'boolean') {
        return uaData.mobile;
    }

    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        return window.matchMedia('(max-width: 768px)').matches;
    }

    const ua = navigator.userAgent || '';
    return /iphone|ipad|ipod|android|mobile/i.test(ua);
};

export const getDefaultEngineVersion = () => {
    const isMobile = isMobileDevice();
    if (!isMobile) return '17.1-single';

    // New installs only: if we detect any existing engine settings, keep standard.
    if (hasExistingEngineSettings()) return '17.1-single';

    return '17.1-lite';
};
