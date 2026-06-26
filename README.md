# 📅 Calendar — Rooms · Channels · Subscriptions

Многопользовательский календарь-планировщик. **Каждый** регистрируется и равен в правах:
- создаёт свои **комнаты** (расписания), у каждой — уникальный **канал**;
- добавляет в комнату уроки (с повторами и статусами);
- листает раздел **Каналы** и **подписывается** на чужие каналы;
- когда владелец канала добавляет урок, он рассылается всем подписчикам как приглашение
  в раздел **Сообщения**, где каждый **принимает или отклоняет**;
- личный **Календарь** агрегирует: уроки своих комнат + принятые приглашения из каналов.

UI: тёмная/светлая тема, 3 языка (🇦🇲 hy / 🇷🇺 ru / 🇬🇧 en), минимализм, шрифт Inter
(с fallback на `CoFo Sans` — положи лицензионные файлы и подключи через `@font-face`).

## Технологии
Node.js + Express + JWT + PostgreSQL, frontend — vanilla JS, nginx, Docker Compose.

## Как работает
1. **Регистрация / вход** — любой пользователь.
2. **Мои комнаты** — создай комнату (название + канал), выбери её → добавляй уроки
   (название, тема, дата, начало/конец, заметка, **повтор** еженедельно, **статус**).
3. **Каналы** — список всех каналов; подписка/отписка. При подписке приходят приглашения
   на все будущие уроки канала.
4. **Сообщения** — приглашения с кнопками «Принять / Отклонить». Принятые попадают в Календарь.
5. **Календарь** — месячная сетка: свои уроки + принятые; цвет по статусу
   (запланирован / проведён / отменён), блок «Ближайшие уроки».

## Локальный запуск (без Docker/Postgres)
```bash
cd backend && npm install && npm run dev
# открой http://localhost:8080
```
Данные — в `backend/data/db.json`. Зарегистрируй пару пользователей и проверь поток
комната → подписка → сообщения.

Прод-режим (Docker): `docker compose up -d --build` → http://localhost:8088.

## Деплой на сервер (существующий vibecode-server)
Сайт ставится **рядом** со study-platform на той же VM, на порту **8088**.
```powershell
.\deploy.ps1            # IP возьмётся из terraform output в ../Server
```
```bash
./deploy.sh            # или ./deploy.sh <EXTERNAL_IP>
```
> Для прод-деплоя скопируй `.env.example` → `.env` и задай сильные `DB_PASSWORD`/`JWT_SECRET`.

## Структура
```
calendar/
├── db/schema.sql          # users, rooms, subscriptions, lessons, lesson_invites
├── backend/               # Express API
│   ├── server.js          # прод (Postgres)
│   ├── server.local.js    # локальный режим (JSON-файл, без БД)
│   ├── db.js  package.json  Dockerfile
├── frontend/              # index.html, app.js, i18n.js, styles.css
├── nginx/default.conf
├── docker-compose.yml     # db + backend + nginx (порт 8088)
├── terraform/             # деплой на vibecode-server
└── deploy.ps1 / deploy.sh
```

## API
| Метод | Путь | Доступ | Назначение |
|-------|------|--------|------------|
| POST | /api/register | — | регистрация |
| POST | /api/login | — | вход, выдаёт JWT |
| GET  | /api/me | auth | текущий пользователь |
| POST | /api/rooms | auth | создать комнату + канал |
| GET  | /api/rooms | auth | мои комнаты |
| GET  | /api/rooms/:id/lessons | owner | уроки комнаты |
| POST | /api/rooms/:id/lessons | owner | создать урок(и) + рассылка приглашений |
| PUT  | /api/lessons/:id | owner | изменить урок |
| PATCH | /api/lessons/:id/status | owner | статус (scheduled/done/cancelled) |
| DELETE | /api/lessons/:id`[?series=1]` | owner | удалить урок / серию |
| GET  | /api/channels | auth | все каналы (+ подписан ли я) |
| POST/DELETE | /api/channels/:roomId/subscribe | auth | подписка / отписка |
| GET  | /api/lessons | auth | агрегированный календарь (свои + принятые) |
| GET  | /api/messages | auth | мои приглашения (pending) |
| POST | /api/messages/:id/accept`\|`/decline | auth | принять / отклонить |

## CI/CD (GitHub Actions)
Пайплайн [`.github/workflows/ci-cd.yml`](.github/workflows/ci-cd.yml) в репозитории `74vahan/calendar`.
- **CI** (push + PR): `npm ci`, syntax-check, smoke-тест (register + создание комнаты) на
  `server.local.js`, валидация `docker-compose`, сборка backend-образа.
- **CD** (push в `main`): пакует проект, копирует по SSH на `vibecode-server`,
  `docker compose up -d --build`. Сайт → `http://<SERVER_HOST>:8088`.

### Секреты (Settings → Secrets and variables → Actions)
| Секрет | Значение |
|--------|----------|
| `SSH_PRIVATE_KEY` | содержимое `Server/vibecode-server-key.pem` (весь файл, с BEGIN/END) |
| `SERVER_HOST` | `34.179.230.9` (статический external IP) |
| `SERVER_USER` | `vahan` |

`.env` (DB_PASSWORD/JWT_SECRET) на сервере создаётся автоматически при первом деплое и
переиспользуется далее.
