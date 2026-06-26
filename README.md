# 📅 Դասերի կալենդար (Calendar)

Վեբ-հարթակ, որտեղ **աշակերտը** գրանցվում/մուտք է գործում և տեսնում է իր դասերը
ամսական կալենդարում (թեմա, անվանում, օր, ժամ), իսկ **ադմինը** ստեղծում/նշանակում է դասերը։

## Տեխնոլոգիաներ
Node.js + Express + JWT + PostgreSQL, frontend՝ vanilla JS, nginx, Docker Compose
(նույն stack-ը, ինչ StudyHub-ը)։

## Ադմին (зашит в `db/schema.sql`)
- Օգտանուն: **Vahan**
- Գաղտնաբառ: **Vahan123**

> ⚠️ Առաջին մուտքից հետո խորհուրդ է տրվում փոխել գաղտնաբառը (թույլ է)։
> Հաշիվը ստեղծվում է `db/schema.sql`-ում պահված bcrypt-hash-ով։

## Ինչպես է աշխատում
- **Աշակերտ** → գրանցվում է → մուտք → տեսնում է **միայն իր** դասերը ամսական ցանցում,
  սեղմում է օրվա վրա → մանրամասներ (թեմա / անվանում / ժամ)։
- **Ադմին** → մուտք `Vahan/Vahan123`-ով → ձև՝ դաս նշանակելու համար
  (աշակերտ, անվանում, թեմա, օր, սկիզբ/ավարտ, նշում), կարող է խմբագրել/ջնջել,
  ինչպես նաև դիտել ընտրված աշակերտի կալենդարը։

---

## Локальный запуск
```bash
docker compose up -d --build
# открой http://localhost:8088
```
Войти как админ: **Vahan / Vahan123**. Зарегистрировать ученика во вкладке «Գրանցում».

## Деплой на сервер (существующий vibecode-server)
Сайт ставится **рядом** со study-platform на той же VM, на порту **8088**
(study-platform занимает 80). Все порты на сервере уже открыты firewall-ом `allow_all`
из `../Server`.

PowerShell:
```powershell
.\deploy.ps1            # IP возьмётся из terraform output в ../Server
# или: .\deploy.ps1 <EXTERNAL_IP>
```
bash:
```bash
./deploy.sh            # или ./deploy.sh <EXTERNAL_IP>
```
После деплоя: `http://<EXTERNAL_IP>:8088`.

> Для прод-деплоя скопируй `.env.example` → `.env` и задай сильные `DB_PASSWORD`/`JWT_SECRET`.

## SSH public key
Сервер и ключ управляются terraform-ом в `../Server`. Получить публичный ключ:
```bash
terraform -chdir=../Server output -raw public_key_openssh
# либо вывести из приватного ключа:
ssh-keygen -y -f ../Server/vibecode-server-key.pem
```

## Структура
```
calendar/
├── db/schema.sql          # схема + сид админа (Vahan)
├── backend/               # Express API (auth, lessons, admin)
│   ├── server.js  db.js  package.json  Dockerfile
├── frontend/              # index.html, app.js, styles.css (армянский UI)
├── nginx/default.conf
├── docker-compose.yml     # db + backend + nginx (порт 8088)
├── deploy.ps1 / deploy.sh
└── .env.example
```

## API
| Метод | Путь | Доступ | Назначение |
|-------|------|--------|------------|
| POST | /api/register | — | регистрация ученика |
| POST | /api/login | — | вход, выдаёт JWT |
| GET  | /api/me | auth | текущий пользователь |
| GET  | /api/lessons | auth | ученик: свои; админ: все / `?student_id=` |
| GET  | /api/students | admin | список учеников |
| POST | /api/lessons | admin | создать урок |
| PUT  | /api/lessons/:id | admin | изменить урок |
| DELETE | /api/lessons/:id | admin | удалить урок |

## CI/CD (GitHub Actions)
Пайплайн: [`.github/workflows/calendar-ci-cd.yml`](../.github/workflows/calendar-ci-cd.yml)
(в корне репозитория `74vahan/less`). Срабатывает только на изменения в `calendar/**`.

- **CI** (push + PR): `npm ci`, syntax-check, smoke-тест входа админом на `server.local.js`,
  валидация `docker-compose`, сборка backend-образа.
- **CD** (push в `master`): пакует проект, копирует по SSH на `vibecode-server`,
  поднимает `docker compose up -d --build`. Сайт → `http://<SERVER_HOST>:8088`.

### Нужные секреты (Settings → Secrets and variables → Actions)
| Секрет | Значение |
|--------|----------|
| `SSH_PRIVATE_KEY` | содержимое `Server/vibecode-server-key.pem` (весь файл, с BEGIN/END) |
| `SERVER_HOST` | `34.179.230.9` (статический external IP, не меняется) |
| `SERVER_USER` | `vahan` |

`.env` (DB_PASSWORD/JWT_SECRET) на сервере создаётся автоматически случайными значениями при первом
деплое и **переиспользуется** при последующих — секреты БД хранить в GitHub не нужно.

### Включить
```bash
# из корня репозитория (74vahan/less):
git add calendar .github/workflows/calendar-ci-cd.yml Server/outputs.tf
git commit -m "calendar: app + CI/CD"
git push origin master
```
После пуша — добавь секреты выше, и деплой пойдёт автоматически. Вкладка **Actions** покажет прогон.
