# SupportOps AI

A full-stack customer support workspace built with **Python, FastAPI, SQLAlchemy, PostgreSQL/SQLite, React, TypeScript, and scikit-learn**. It combines ticket operations with local AI suggestions that an agent must review.

## What it does

- **Ticket management:** create, search, filter, assign, comment, and move tickets through open, in progress, waiting, and resolved states.
- **Role-based access:** admins create users and change roles; admins and agents work tickets; viewers have read-only access. Sessions use bearer tokens and salted `scrypt` password hashes.
- **Operations dashboard:** status, priority, and category counts; ticket volume; agent workload; urgent and unreviewed queues.
- **Actionable interface:** a human review queue opens the selected ticket, and compact ticket cards keep status, priority, and assignee visible on narrow screens.
- **AI triage:** TF-IDF plus logistic regression suggests a priority; character n-gram similarity ranks possible duplicates. A person explicitly confirms or overrides the priority and duplicate link. Every decision is recorded in the activity log.
- **API and data integrity:** documented REST endpoints at `/docs`, input validation, indexed relational tables, parameterized queries, and version checks to prevent stale ticket updates.

## Run locally

Requires Python 3.11+ and Node.js 20+.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
cd frontend
npm ci
npm run build
cd ..\backend
$env:SUPPORTOPS_DEMO = "1"
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open **http://127.0.0.1:8000**. On first local launch, the app creates `backend/supportops.db`, three demo users, and four sample tickets.

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@demo.local` | `DemoPass123!` |
| Agent | `agent@demo.local` | `DemoPass123!` |
| Viewer | `viewer@demo.local` | `DemoPass123!` |

Demo accounts are for local evaluation only and are disabled by default. For a non-demo first run, set `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` instead of `SUPPORTOPS_DEMO=1`.

For frontend development, run `npm run dev` inside `frontend` while the backend runs on port 8000. Vite proxies `/api` to the backend.

## PostgreSQL with Docker Compose

Copy `.env.example` to `.env`, replace all sample passwords, then run `docker compose up --build`. The app is available at http://127.0.0.1:8000. Docker Compose uses PostgreSQL, and the backend can also connect to any compatible database through `DATABASE_URL` (`postgresql+psycopg://...`).

## Tests

```powershell
cd backend
pytest -q
```

The tests cover role permissions, ticket creation and search, advisory AI output, human review, duplicate links, comments, dashboard metrics, audit history, and optimistic concurrency. The frontend is type-checked and compiled with `npm run build`.

GitHub Actions runs the backend tests, frontend formatting check, and production build on every push and pull request.

## API map

| Endpoint | Use |
| --- | --- |
| `POST /api/auth/login` | Sign in |
| `GET /api/me` | Current user |
| `GET/POST /api/tickets` | Search or create tickets |
| `GET/PATCH /api/tickets/{id}` | Read or update a ticket |
| `GET /api/tickets/{id}/suggestions` | Get AI priority and duplicate suggestions |
| `POST /api/tickets/{id}/review` | Record a human decision |
| `POST /api/tickets/{id}/comments` | Add an internal note |
| `GET /api/dashboard` | Operations metrics |
| `GET/POST /api/users`, `PATCH /api/users/{id}` | List users, create a user, or change a role (admin writes) |
| `GET /api/audit` | Recent audit events (admin) |

## AI design and limits

The priority model is a small, deterministic demonstration trained on example support text in `backend/app/ai.py`. Its probability is a model score, **not calibrated certainty**. The duplicate detector compares a ticket with up to 500 recent tickets. It never merges tickets automatically. This baseline makes the workflow fully local and reproducible, but a real deployment would need labeled historical tickets, evaluation by category and severity, drift monitoring, and a more scalable retrieval index.

## Production next steps

Add database migrations, rate limits and lockout on login, password reset, secret management, monitoring, CSRF-safe cookie sessions or short-lived tokens with refresh, and a real model evaluation set. The project is a portfolio demonstration, not a deployed production service.
