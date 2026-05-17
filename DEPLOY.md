# Quick Start: Deploy to Vercel

## Step 1: Import the Project

Create a new Vercel project from this repository.

## Step 2: Use the Vite Defaults

Vercel should detect the app automatically. If you need to set the values manually:

- Framework preset: `Vite`
- Build command: `npm run build`
- Output directory: `dist`
- Install command: `npm install`

## Step 3: Deploy

Push your changes and deploy from Vercel.

## Current Routing Setup

This app is built for the Vercel domain root:

```javascript
base: '/'
```

The old GitHub Pages `/Chesslyze/` base path and `404.html` redirect workaround have been removed. The home page should load at `/` without a route rewrite.

## Troubleshooting

**Blank page with missing JS/CSS assets?**
Check the browser console and network tab. Asset URLs should start with `/assets/`, not `/Chesslyze/assets/`.

**Direct refresh on nested routes returns 404?**
This repo currently avoids the old SPA fallback. If direct nested route refreshes become required later, add a Vercel rewrite intentionally.

**PWA not working?**
Vercel serves HTTPS automatically, so PWA features should work after a successful production build.

## Security Note

Safe for public deployment: no secrets are required, the app is client-side, and user data is stored in the browser with IndexedDB.
