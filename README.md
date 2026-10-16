# ED Explorer Kit

Компаньон для исследователей Elite Dangerous: экзобиология и маппинг с простым
и понятным интерфейсом. Работает на втором мониторе или с телефона по Wi-Fi.

- **Система** — тела по ценности, биосигналы, предсказанные виды, стоит ли маппить.
- **Поверхность** — радар сэмплов: где брать следующий образец и сколько ещё идти.
- **Сессия** — сколько непроданных данных сейчас под риском.

Приложение только читает журнал игры (`Saved Games\Frontier Developments\Elite Dangerous`)
и ничего не отправляет в интернет.

## Запуск

Нужны [uv](https://docs.astral.sh/uv/) и Node.js 22+.

```powershell
.\start.ps1           # http://127.0.0.1:8765
.\start.ps1 -Lan      # плюс доступ с телефона в той же сети (Windows спросит про firewall)
```

Данные хранятся в `%LOCALAPPDATA%\EDExplorerKit\data.db`. Удалить файл безопасно:
при следующем запуске всё пересоберётся из журналов.

## Разработка

```powershell
cd backend;  uv run python -m app.main   # API на :8765
cd frontend; npm run dev                 # UI на :5173 с прокси на API
cd frontend; npm run dev -- --open "/?mock=1"   # UI на тестовых данных без бэкенда
cd backend;  uv run pytest -q
```

Архитектура: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
