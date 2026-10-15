import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  workboxOptions: {
    disableDevLogs: true,
    // Не кэшировать SSE и API, работающие с сессией
    runtimeCaching: [
      {
        // SSE-поток — только сеть, никогда не кэшировать
        urlPattern: /\/api\/v1\/realtime/,
        handler: "NetworkOnly",
      },
      {
        // Pomodoro API — только сеть, чтобы poll не брал старое
        urlPattern: /\/api\/v1\/pomodoro/,
        handler: "NetworkOnly",
      },
      {
        // Auth — только сеть
        urlPattern: /\/api\/v1\/auth/,
        handler: "NetworkOnly",
      },
      {
        // Остальные API — сеть с фолбэком на кэш (offline)
        urlPattern: /\/api\/v1\/.*/,
        handler: "NetworkFirst",
        options: {
          cacheName: "api-cache",
          networkTimeoutSeconds: 5,
          expiration: {
            maxEntries: 100,
            maxAgeSeconds: 60 * 60 * 24, // 1 день
          },
        },
      },
      {
        // Статика Next.js — кэш
        urlPattern: /\/_next\/static\/.*/i,
        handler: "CacheFirst",
        options: {
          cacheName: "next-static",
          expiration: {
            maxEntries: 200,
            maxAgeSeconds: 60 * 60 * 24 * 30, // 30 дней
          },
        },
      },
      {
        // Изображения — кэш
        urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff2?)$/i,
        handler: "CacheFirst",
        options: {
          cacheName: "assets",
          expiration: {
            maxEntries: 100,
            maxAgeSeconds: 60 * 60 * 24 * 30,
          },
        },
      },
    ],
  },
});

const nextConfig: NextConfig = {
  turbopack: {},
  // Ваши остальные настройки — перенесите сюда, если были
};

export default withPWA(nextConfig);
