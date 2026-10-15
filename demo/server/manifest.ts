import type { WebAppManifest } from '../../src/server/index.js';

// start_url の印 `src=home-screen` は、ホーム画面アプリが start_url で開いたかを見分けるため。
// id は固定する（引換券ごとに別のアプリとみなされないように）。
export const BASE_MANIFEST: WebAppManifest = {
  id: '/',
  name: 'browser-handoff デモ',
  short_name: 'Handoff',
  start_url: '/?src=home-screen',
  scope: '/',
  display: 'standalone',
  background_color: '#ffffff',
  theme_color: '#2f6fde',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
  ],
};
