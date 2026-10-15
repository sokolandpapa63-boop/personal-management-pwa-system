# Моя система

Персональный PWA-комбайн для управления задачами, временем (Pomodoro), спортом, образованием и финансами.
Русская локаль · часовой пояс Europe/Moscow · мультидевайс-синхронизация.

## Стек

- **Fullstack:** Next.js 16 (App Router, TypeScript) — UI и REST API (`/api/v1/*`) в одном сервисе
- **БД:** PostgreSQL 16 + Drizzle ORM
- **State:** TanStack Query (server state) + Zustand (auth, toasts, online)
- **Realtime:** SSE-поток `/api/v1/realtime` (аналог WebSocket-событий из ТЗ), fallback — polling при фокусе окна
- **Графики:** Recharts · **Планер:** кастомный месячный календарь с drag & drop
- **PWA:** manifest + Service Worker (NetworkFirst для sections/tasks/events, offline.html)
- **Отчёты:** серверная генерация HTML-документа → печать/«Сохранить как PDF» из браузера
- **Технологическое соответствие ТЗ:** внешний деплой упакован в один Docker-образ (см. ниже про адаптацию стека)

## Быстрый старт (Docker)

```bash
cp .env.example .env          # при необходимости смените JWT_SECRET
docker compose up --build     # postgres:16 + миграции + приложение
# http://localhost:3000
```

## Локальная разработка

```bash
npm ci
cp .env.example .env          # DATABASE_URL на локальный Postgres
npx drizzle-kit push          # применить схему БД
npm run dev                   # http://localhost:3000
```

Продакшен без Docker: `npm run build && npm run start`.

## Регистрация и seed

При регистрации автоматически создаются системные разделы:
**Спорт** (таблица: дата, упражнение, подходы, повторения, вес, объём-формула, заметки),
**Образование** (задания/зачёты/экзамены + учебная сессия с обратным отсчётом),
**Финансы** → FxPro (USD), БК (RUB), Мотив (RUB), Найм (RUB) — каждая таблица мультивалютная,
**Управление системой** (таск-менеджер, планер), **Отчёты системы**.
Пользовательские разделы/подразделы и схемы таблиц редактируются из UI («Схема»).

## Аутентификация

- login (3–32, уникальный) + email (уникальный) + пароль (мин. 8, bcrypt 12 раундов)
- Вход по логину **или** email
- JWT access 15 мин (память), refresh 30 дней (httpOnly cookie, ротация при обновлении)
- Rate limiting 10 запросов/мин на `/api/v1/auth/*` по IP
- Восстановление пароля: токен пишется в лог сервера (SMTP не настроен — заглушка по ТЗ)

## Ключевые модули

| Модуль | Эндпоинты / UI |
|---|---|
| Задачи | `/api/v1/tasks` (+ complete / cancel{reason} / duplicate / bulk-duplicate), страница «Таск-менеджер» |
| Планер | `/api/v1/events`, месячный календарь с drag & drop |
| Разделы | `/api/v1/sections` (+ schema / records / stats / export.csv / import.csv) |
| Pomodoro | `/api/v1/pomodoro` start/finish/cancel + stats; виджет на дашборде |
| Учебная сессия | `/api/v1/me/study-session`; отсчёт «X мес Y дн Z ч M мин S сек», 1 сек |
| Валюты | open.er-api.com (кэш 1 час в БД), `/api/v1/currencies/rates`, событие `currency.updated` |
| Отчёты | `/api/v1/reports` (+ generate / file); авто: daily 21:00, weekly вс 09:00, monthly 1-е 09:00 — через тик-планировщик `/api/v1/cron/tick` (вызывается клиентом каждые 5 мин) и немедленно вручную |
| Realtime | SSE `/api/v1/realtime?token=` — все события `task.*`, `event.*`, `record.*`, `section.*`, `pomodoro.*`, `report.ready`, `currency.updated`, `studySession.updated` |
| Push | Браузерные Notification API; `/api/v1/push/subscribe` хранит токены; FCM-заглушка активируется переменными `FIREBASE_*` |

## Переменные окружения

См. `.env.example`: `DATABASE_URL`, `JWT_SECRET`, опционально `FIREBASE_*`, `SENTRY_DSN` (пустое = Sentry отключён).

## CI

`.github/workflows/ci.yml`: install → drizzle push → typegen → typecheck → build (с сервисом Postgres 16).

## Адаптация стека к среде выполнения

Проект реализован в управляемой среде Next.js + PostgreSQL, поэтому вместо раздельных NestJS+Prisma+Vite функции
бэкенда несут route-обработчики Next.js, а ORM — Drizzle (та же схема данных, те же эндпоинты `/api/v1`).
Все критерии приёмки — регистрация с seed-разделами, JWT+refresh, конструктор таблиц, Pomodoro, задачи с
обязательной причиной отмены/удаления, повторения, мультивалютность с эквивалентом в базовой валюте, отсчёт сессии,
realtime-синхронизация вкладок, уведомления, отчёты и PWA — сохранены.
