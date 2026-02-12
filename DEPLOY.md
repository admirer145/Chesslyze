# Quick Start: Deploy to GitHub Pages

## Step 1: Update Base Path (IMPORTANT!)

Edit `vite.config.js` and set the correct base path:

```javascript
base: '/YOUR-REPO-NAME/',  // Change 'YOUR-REPO-NAME' to your actual repo name
```

For example:
- If your repo is `github.com/narendra/chesslyze`, use `base: '/chesslyze/'`
- If using custom domain, use `base: '/'`

## Step 2: Push to GitHub

```bash
git add .
git commit -m "Add GitHub Pages deployment"
git push origin main
```

## Step 3: Enable GitHub Pages

1. Go to your repo on GitHub
2. Click **Settings** → **Pages**
3. Under "Build and deployment":
   - Source: **GitHub Actions** (will be auto-selected)
4. Wait 2-3 minutes for first deployment

## Step 4: Access Your Site

Your app will be live at:
```
https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/
```

## That's It! 🎉

Every time you push to `main`, GitHub Actions will automatically:
1. Build your app
2. Deploy to GitHub Pages
3. Your changes go live in ~2-3 minutes

## Troubleshooting

**404 on routes?**
→ Make sure `base` in `vite.config.js` matches your repo name exactly

**Assets not loading?**
→ Double-check the base path - it must match the repo name

**PWA not working?**
→ HTTPS is automatic on GitHub Pages, so PWA should work out of the box

## Security Note

✅ Safe for public repo - no secrets or API keys in this project
✅ All code is client-side only
✅ Data stored in user's browser (IndexedDB)
