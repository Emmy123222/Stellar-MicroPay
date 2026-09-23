# PWA Implementation Guide for Stellar MicroPay

## Overview
This document explains the PWA (Progressive Web App) implementation for Stellar MicroPay, enabling:
- ✅ Installation on mobile home screens (Android & iOS)
- ✅ Offline access to cached pages
- ✅ Install banner on supported browsers
- ✅ Standalone app experience

## Files Created/Modified

### 1. **frontend/public/manifest.json**
Web App Manifest that defines:
- App name: "Stellar MicroPay"
- Short name: "MicroPay"
- Display mode: standalone (hides browser UI)
- Theme color: #7B3FE4 (Stellar purple)
- Icons: 192x192 and 512x512

### 2. **frontend/public/sw.js**
Service Worker that handles:
- Caching of static assets (home page, dashboard, favicon, manifest)
- Network-first strategy with cache fallback
- Offline support for previously visited pages
- Cache versioning and cleanup

### 3. **frontend/pages/_document.tsx**
Custom Next.js document with:
- Manifest link tag
- Theme color meta tag
- Apple touch icon reference
- iOS-specific meta tags for web app capability
- MS Tile color for Windows

### 4. **frontend/pages/_app.tsx** (Modified)
Added:
- Service worker registration on app load
- `InstallBanner` component that:
  - Listens for `beforeinstallprompt` event
  - Shows a beautiful install prompt banner
  - Allows users to install or dismiss
  - Styled with Tailwind CSS to match app theme

### 5. **frontend/public/icon-192.svg** & **icon-512.svg**
SVG icons with:
- Stellar purple gradient background
- White diamond/stellar logo
- Rounded corners for modern app appearance

## Icon Setup (IMPORTANT)

The manifest.json references PNG icons. You have two options:

### Option 1: Convert SVG to PNG (Recommended)
1. Open `icon-192.svg` in any browser
2. Screenshot or use a tool to convert to PNG:
   - **Online**: https://cloudconvert.com/svg-to-png
   - **Mac**: Preview app → Export as PNG
   - **Windows**: Paint or Photos app → Save as PNG
   - **CLI**: `convert icon-192.svg icon-192.png` (requires ImageMagick)

3. Save as:
   - `public/icon-192.png` (192x192 pixels)
   - `public/icon-512.png` (512x512 pixels)

### Option 2: Use Online PWA Icon Generator
1. Visit https://realfavicongenerator.net/ or https://pwacompat.com/
2. Upload one of the SVG files
3. Download generated icons
4. Place in `frontend/public/` directory

### Option 3: Create Custom Icons
Design your own icons and save as:
- `public/icon-192.png`
- `public/icon-512.png`

## Testing PWA Features

### Local Development
```bash
cd frontend
npm run dev
```

**Note**: Service workers require HTTPS in production, but work on `localhost` for development.

### Test Installation on Android Chrome
1. Deploy to HTTPS URL (e.g., Vercel, Netlify)
2. Open in Chrome on Android
3. Wait for install banner to appear OR
4. Tap menu (⋮) → "Add to Home screen"
5. App installs with splash screen and icon

### Test Installation on iOS Safari
1. Deploy to HTTPS URL
2. Open in Safari on iOS
3. Tap Share button
4. Scroll down → "Add to Home Screen"
5. App adds to home screen

### Test Offline Support
1. Visit the app while online
2. Navigate to home page and dashboard
3. Go offline (Airplane mode or DevTools → Offline)
4. Reload the page
5. Cached version should load

### Chrome DevTools Testing
1. Open DevTools (F12)
2. Go to **Application** tab
3. Check:
   - **Manifest**: View manifest details
   - **Service Workers**: Check registration status
   - **Cache Storage**: View cached assets
4. Use **Lighthouse** tab → Generate PWA report

## Browser Support

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| Install Banner | ✅ | ✅ | ❌ | ✅ |
| Service Worker | ✅ | ✅ | ✅ | ✅ |
| Offline Cache | ✅ | ✅ | ✅ | ✅ |
| Add to Home Screen | ✅ | ✅ | ⚠️ Manual | ✅ |

**Note**: iOS Safari doesn't support `beforeinstallprompt` event, so the install banner won't show. Users must manually add to home screen.

## Service Worker Cache Strategy

The service worker uses a **network-first with cache fallback** strategy:
1. Try to fetch from network
2. If successful, cache the response and return it
3. If network fails, serve from cache
4. For HTML pages, fallback to cached home page

This ensures:
- Users always get fresh content when online
- App works offline with last cached version
- Graceful degradation

## Cache Versioning

The cache name includes a version number: `micropay-v1`

To update cached assets after deployments:
1. Change `CACHE_NAME` in `sw.js` (e.g., to `micropay-v2`)
2. Old cache will be automatically deleted on next load
3. New assets will be cached

## Customization

### Change Theme Color
Edit in three places:
1. `manifest.json` → `theme_color`
2. `_document.tsx` → `<meta name="theme-color">`
3. `_document.tsx` → `<meta name="msapplication-TileColor">`

### Add More Pages to Cache
Edit `sw.js` → `STATIC_ASSETS` array:
```javascript
const STATIC_ASSETS = [
  '/',
  '/dashboard',
  '/transactions',  // Add this
  '/favicon.svg',
  '/manifest.json',
];
```

### Customize Install Banner
Edit the `InstallBanner` component in `_app.tsx`:
- Change colors, text, positioning
- Modify styling with Tailwind classes
- Add animations or custom behavior

## Troubleshooting

### Install Banner Not Showing
- Must be served over HTTPS (except localhost)
- Manifest must have valid icons (PNG format)
- User must have interacted with the page
- On iOS, banner doesn't show (manual add only)

### Service Worker Not Registering
- Check browser console for errors
- Verify `sw.js` is accessible at `/sw.js`
- Ensure browser supports service workers
- Check if blocked by browser settings

### Offline Not Working
- Visit pages while online first to cache them
- Check Cache Storage in DevTools
- Verify service worker is active
- Clear cache and reload to reset

### Icons Not Showing
- Ensure PNG files exist in `public/` folder
- Check file names match manifest.json
- Verify image dimensions (192x192, 512x512)
- Use PNG format, not SVG

## Deployment Checklist

- [ ] Convert SVG icons to PNG format
- [ ] Test manifest.json is accessible at `/manifest.json`
- [ ] Verify service worker registers at `/sw.js`
- [ ] Test on Android Chrome (install & offline)
- [ ] Test on iOS Safari (add to home screen)
- [ ] Run Lighthouse PWA audit (aim for 100%)
- [ ] Update cache version after major updates

## Resources

- [MDN: Progressive Web Apps](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)
- [Web App Manifest](https://developer.mozilla.org/en-US/docs/Web/Manifest)
- [Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [Next.js PWA Guide](https://nextjs.org/docs/app/building-your-application/optimizing/progressive-web-apps)

## Future Enhancements

Consider adding:
- Background sync for offline transactions
- Push notifications
- More granular caching strategies
- App shortcuts in manifest
- Share target API
- Periodic background sync
