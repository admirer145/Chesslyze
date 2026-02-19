import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

const DISMISS_UNTIL_KEY = 'pwa-install-dismissed-until';
const LAST_SHOWN_KEY = 'pwa-install-last-shown';
const SHOW_DELAY_MS = 4500;
const SNOOZE_DAYS = 7;
const DONT_ASK_DAYS = 90;

const isIosDevice = () => {
    if (typeof navigator === 'undefined') return false;
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
};

const isStandaloneMode = () => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
};

const isProbablyMobile = () => {
    if (typeof window === 'undefined') return false;
    const uaMatch = /android|iphone|ipad|ipod/i.test(navigator.userAgent);
    const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches;
    const narrow = window.matchMedia?.('(max-width: 900px)').matches;
    return uaMatch || (coarsePointer && narrow);
};

const getDismissUntil = () => {
    if (typeof window === 'undefined') return 0;
    const raw = window.localStorage.getItem(DISMISS_UNTIL_KEY);
    return raw ? Number(raw) : 0;
};

const setDismissUntil = (timestamp) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(DISMISS_UNTIL_KEY, String(timestamp));
};

const isRecentlyShown = () => {
    if (typeof window === 'undefined') return false;
    const raw = window.localStorage.getItem(LAST_SHOWN_KEY);
    const lastShown = raw ? Number(raw) : 0;
    return Date.now() - lastShown < 24 * 60 * 60 * 1000;
};

const markShown = () => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LAST_SHOWN_KEY, String(Date.now()));
};

export const PWAInstallPrompt = () => {
    const [deferredPrompt, setDeferredPrompt] = useState(null);
    const [visible, setVisible] = useState(false);
    const [mode, setMode] = useState('install'); // install | ios
    const timerRef = useRef(null);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!isProbablyMobile()) return;
        if (isStandaloneMode()) return;

        const dismissedUntil = getDismissUntil();
        if (dismissedUntil && dismissedUntil > Date.now()) return;
        if (isRecentlyShown()) return;

        const ios = isIosDevice();
        setMode(ios ? 'ios' : 'install');

        const scheduleShow = () => {
            if (timerRef.current) {
                window.clearTimeout(timerRef.current);
            }
            timerRef.current = window.setTimeout(() => {
                markShown();
                setVisible(true);
            }, SHOW_DELAY_MS);
        };

        if (ios) {
            scheduleShow();
        }

        const handleBeforeInstallPrompt = (event) => {
            event.preventDefault();
            setDeferredPrompt(event);
            if (!ios) {
                scheduleShow();
            }
        };

        const handleInstalled = () => {
            setDeferredPrompt(null);
            setVisible(false);
            window.localStorage.removeItem(DISMISS_UNTIL_KEY);
            window.localStorage.removeItem(LAST_SHOWN_KEY);
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.addEventListener('appinstalled', handleInstalled);

        return () => {
            if (timerRef.current) {
                window.clearTimeout(timerRef.current);
            }
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.removeEventListener('appinstalled', handleInstalled);
        };
    }, []);

    const dismissForDays = (days) => {
        const until = Date.now() + days * 24 * 60 * 60 * 1000;
        setDismissUntil(until);
        setVisible(false);
    };

    const dismiss = () => dismissForDays(SNOOZE_DAYS);

    const dismissForever = () => dismissForDays(DONT_ASK_DAYS);

    const handleInstall = async () => {
        if (!deferredPrompt) {
            dismiss();
            return;
        }

        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        setDeferredPrompt(null);

        if (choice?.outcome !== 'accepted') {
            dismiss();
            return;
        }

        setVisible(false);
    };

    if (!visible) return null;

    return (
        <div className="pwa-install" role="dialog" aria-modal="true" aria-label="Install Chesslyze">
            <div className="pwa-install__backdrop" onClick={dismiss} />
            <div className="pwa-install__sheet">
                <div className="pwa-install__grab" aria-hidden="true" />
                <div className="pwa-install__header">
                    <div>
                        <div className="pwa-install__eyebrow">Mobile tip</div>
                        <div className="pwa-install__title">Install Chesslyze</div>
                        <div className="pwa-install__desc">
                            Launch faster, keep analysis available offline, and save space in your tab bar.
                        </div>
                    </div>
                    <button className="pwa-install__close" onClick={dismiss} aria-label="Close" type="button">
                        <X size={16} />
                    </button>
                </div>

                <div className="pwa-install__benefits">
                    <span className="pwa-install__chip">Fast launch</span>
                    <span className="pwa-install__chip">Offline access</span>
                    <span className="pwa-install__chip">Full-screen mode</span>
                </div>

                {mode === 'ios' && (
                    <div className="pwa-install__ios">
                        <div className="pwa-install__ios-title">Add to Home Screen (iOS)</div>
                        <div className="pwa-install__ios-steps">
                            <span>1. Tap the Share button in Safari.</span>
                            <span>2. Select "Add to Home Screen".</span>
                        </div>
                    </div>
                )}

                <div className="pwa-install__actions">
                    <button
                        className="btn-primary pwa-install__primary"
                        onClick={mode === 'install' ? handleInstall : dismiss}
                        type="button"
                    >
                        {mode === 'install' ? 'Install App' : 'Add to Home Screen'}
                    </button>
                    <button className="btn-secondary pwa-install__secondary" onClick={dismiss} type="button">
                        Not now
                    </button>
                    <button className="pwa-install__dismiss" onClick={dismissForever} type="button">
                        Don&apos;t ask again
                    </button>
                </div>
            </div>
        </div>
    );
};
