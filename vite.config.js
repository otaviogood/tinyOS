import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { VitePWA } from 'vite-plugin-pwa'
import mkcert from 'vite-plugin-mkcert'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        mkcert({
            hosts: [
                'localhost',
                '127.0.0.1',
                '::1',
                '192.168.1.75',
                'MacBookPro.attlocal.net',
                'OTAVIOs-MacBook-Pro.local',
                'game.local'
            ]
        }),
        svelte(),
        VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'masked-icon.svg', 'speech/*.mp3'],
            manifest: {
                name: 'Tiny OS',
                short_name: 'TinyOS',
                description: 'A tiny OS in your browser',
                theme_color: '#ffffff',
                icons: [
                    {
                        src: 'pwa-192x192.png',
                        sizes: '192x192',
                        type: 'image/png',
                    },
                    {
                        src: 'pwa-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                    },
                    {
                        src: 'pwa-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'any maskable',
                    }
                ]
            }
        })
    ],
    server: {
        port: 8011,
        host: true,
        https: true,
        hmr: {
          protocol: 'wss',
          host: '192.168.1.75', // or your short name
          clientPort: 8011
        },
        proxy: {
          '/socket.io': {
            target: 'http://localhost:3001',
            ws: true,
            changeOrigin: true,
            secure: false
          },
          '/health': {
            target: 'http://localhost:3001',
            changeOrigin: true,
            secure: false
          }
        }
    }
});
