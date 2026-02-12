import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Register Service Worker with fallback mechanisms
function registerServiceWorker() {
  // Check if service workers are supported
  if (!('serviceWorker' in navigator)) {
    console.log('Service workers are not supported in this browser. App will run without offline capabilities.');
    return;
  }

  try {
    // Dynamic import to avoid breaking the app if PWA plugin fails
    import('virtual:pwa-register')
      .then(({ registerSW }) => {
        const updateSW = registerSW({
          immediate: true,
          onRegistered(registration) {
            console.log('✅ Service Worker registered successfully');

            // Check for updates periodically (every hour)
            if (registration) {
              setInterval(() => {
                registration.update().catch(err => {
                  console.log('SW update check failed (non-critical):', err);
                });
              }, 60 * 60 * 1000);
            }
          },
          onRegisterError(error) {
            console.warn('Service Worker registration failed (non-critical):', error);
            console.log('App will continue to work normally without offline support');
          },
          onNeedRefresh() {
            // New version available - show subtle notification
            const shouldUpdate = confirm(
              '🔄 A new version of Chesslyze is available!\n\nWould you like to update now? (Recommended)'
            );

            if (shouldUpdate) {
              updateSW(true);
            } else {
              console.log('Update postponed. Will apply on next reload.');
            }
          },
          onOfflineReady() {
            console.log('✅ Chesslyze is ready to work offline!');

            // Optional: Show a subtle notification
            if (window.location.pathname !== '/') {
              const notification = document.createElement('div');
              notification.style.cssText = `
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: #10b981;
                color: white;
                padding: 12px 20px;
                border-radius: 8px;
                font-size: 14px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                z-index: 9999;
                animation: slideIn 0.3s ease-out;
              `;
              notification.textContent = '✓ Offline mode ready';
              document.body.appendChild(notification);

              setTimeout(() => {
                notification.style.opacity = '0';
                notification.style.transition = 'opacity 0.3s';
                setTimeout(() => notification.remove(), 300);
              }, 3000);
            }
          }
        });
      })
      .catch(error => {
        // Fallback: PWA plugin not available or failed to load
        console.log('PWA features not available (non-critical):', error.message);
        console.log('App will work normally without offline support');
      });
  } catch (error) {
    // Ultimate fallback - ensure app still works
    console.log('Service worker initialization failed (non-critical):', error);
    console.log('App will continue to work without PWA features');
  }
}

// Register SW after initial render to avoid blocking
registerServiceWorker();

createRoot(document.getElementById('root')).render(
  <App />
)
