import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';

const DISMISS_KEY = 'pwa-install-dismissed';

const isIosDevice = () => {
    if (typeof navigator === 'undefined') return false;
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
};

const isStandaloneMode = () => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
};

export const PWAInstallPrompt = () => {
    const [deferredPrompt, setDeferredPrompt] = useState(null);
    const [visible, setVisible] = useState(false);
    const [mode, setMode] = useState('install'); // install | ios

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const dismissed = sessionStorage.getItem(DISMISS_KEY) === '1';
        if (dismissed || isStandaloneMode()) return;

        const ios = isIosDevice();
        if (ios) {
            setMode('ios');
            setVisible(true);
        }

        const handleBeforeInstallPrompt = (event) => {
            event.preventDefault();
            setDeferredPrompt(event);
            if (!ios) {
                setMode('install');
                setVisible(true);
            }
        };

        const handleInstalled = () => {
            setDeferredPrompt(null);
            setVisible(false);
            sessionStorage.removeItem(DISMISS_KEY);
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.addEventListener('appinstalled', handleInstalled);

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.removeEventListener('appinstalled', handleInstalled);
        };
    }, []);

    const dismiss = () => {
        sessionStorage.setItem(DISMISS_KEY, '1');
        setVisible(false);
    };

    const handleInstall = async () => {
        if (!deferredPrompt) {
            dismiss();
            return;
        }

        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        setDeferredPrompt(null);

        if (choice?.outcome !== 'accepted') {
            sessionStorage.setItem(DISMISS_KEY, '1');
        }

        setVisible(false);
    };

    if (!visible) return null;

    return (
        <div className="pwa-install" role="dialog" aria-modal="true" aria-label="Install Chesslyze">
            <div className="pwa-install__backdrop" onClick={dismiss} />
            <div className="pwa-install__panel">
                <div className="pwa-install__header">
                    <div>
                        <div className="pwa-install__title">Install Chesslyze</div>
                        <div className="pwa-install__desc">
                            Get faster launch, offline access, and a dedicated home screen icon.
                        </div>
                    </div>
                    <button className="pwa-install__close" onClick={dismiss} aria-label="Close" type="button">
                        <X size={16} />
                    </button>
                </div>

                {mode === 'ios' && (
                    <div className="pwa-install__ios">
                        <div className="pwa-install__ios-title">Add to Home Screen on iOS</div>
                        <div className="pwa-install__ios-steps">
                            <span>1. Tap the Share button in Safari.</span>
                            <span>2. Choose "Add to Home Screen".</span>
                        </div>
                    </div>
                )}

                <div className="pwa-install__actions">
                    <button
                        className="btn-primary"
                        onClick={mode === 'install' ? handleInstall : dismiss}
                        type="button"
                    >
                        {mode === 'install' ? 'Install App' : 'Add to Home Screen'}
                    </button>
                    <button className="btn-secondary" onClick={dismiss} type="button">
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
};
