# SecureExam

Платформа безпечного тестування з аналізом стабільності мережі, розмежуванням збоїв зв'язку та спроб виходу з вікна тесту, а також вбудованим ШІ-асистентом Gemini на стороні сервера.

## Локальний запуск

Установіть Node.js, потім у PowerShell виконайте:

```powershell
cd server
npm ci
npm start
```

Відкрийте `http://localhost:3500`. Створіть `server/.env` на основі `server/.env.example` і задайте `ADMIN_PASSWORD` та (за потреби для ШІ) `GEMINI_API_KEY`. Файл `.env` ігнорується Git — ніколи не додавайте секрети до репозиторію.

## Безкоштовне демо на Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/gaga050819/Test-for-everyone/tree/github-no-ai)

Кнопка відкриє налаштування розгортання гілки `github-no-ai` як Node web service. У Render відкрийте **Environment** і задайте `ADMIN_PASSWORD` та секретний `GEMINI_API_KEY` (ключ зберігається лише на сервері й не передається у браузер). Для постійного збереження тестів і результатів додайте також `DATABASE_URL` (PostgreSQL, наприклад Neon або Supabase). [Обмеження безкоштовного плану Render](https://render.com/docs/free).

Автоматичне розгортання після push вимкнене (`autoDeployTrigger: off`); оновлення сервісу запускаються вручну в Render (**Manual Deploy** → **Deploy latest commit**).

## Про GitHub Pages

Це повний застосунок на Express із API, WebSocket і серверним сховищем. GitHub Pages може віддати статичні файли, але не запускає цей сервер, тому повний тестовий застосунок там не запрацює. Для робочого публічного сервісу потрібен хостинг із Node.js, WebSocket і постійним сховищем.
