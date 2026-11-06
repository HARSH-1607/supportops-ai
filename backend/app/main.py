from __future__ import annotations

import hashlib
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session
from starlette.staticfiles import StaticFiles

from .ai import find_duplicates, suggest_priority
from .db import AuditEvent, Base, Comment, SessionToken, Ticket, User, make_engine, make_session_factory, utcnow
from .security import ROLES, bearer, current_user, hash_password, new_token, require_role, verify_password

PRIORITIES = {"low", "medium", "high", "critical"}
STATUSES = {"open", "in_progress", "waiting", "resolved"}
CATEGORIES = {"billing", "account", "technical", "product", "other"}


class LoginIn(BaseModel):
    email: str
    password: str


class UserIn(BaseModel):
    email: str
    name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=10, max_length=128)
    role: str

    @field_validator("email", "name")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()


class RoleUpdateIn(BaseModel):
    role: str


class TicketIn(BaseModel):
    title: str = Field(min_length=4, max_length=160)
    description: str = Field(min_length=15, max_length=5000)
    category: str
    assigned_to_id: int | None = None

    @field_validator("title", "description")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()


class TicketUpdateIn(BaseModel):
    expected_version: int = Field(ge=1)
    status: str | None = None
    assigned_to_id: int | None = None


class ReviewIn(BaseModel):
    expected_version: int = Field(ge=1)
    priority: str
    duplicate_of_id: int | None = None
    note: str = Field(default="", max_length=500)


class CommentIn(BaseModel):
    body: str = Field(min_length=2, max_length=2000)

    @field_validator("body")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()


def user_dict(user: User) -> dict:
    return {"id": user.id, "email": user.email, "name": user.name, "role": user.role}


def ticket_dict(ticket: Ticket, db: Session, *, detail=False) -> dict:
    assignee = db.get(User, ticket.assigned_to_id) if ticket.assigned_to_id else None
    result = {
        "id": ticket.id, "title": ticket.title, "description": ticket.description,
        "category": ticket.category, "status": ticket.status, "priority": ticket.priority,
        "suggested_priority": ticket.suggested_priority,
        "suggestion_confidence": ticket.suggestion_confidence,
        "assigned_to_id": ticket.assigned_to_id, "assigned_to_name": assignee.name if assignee else None,
        "duplicate_of_id": ticket.duplicate_of_id, "reviewed_at": ticket.reviewed_at,
        "created_at": ticket.created_at, "updated_at": ticket.updated_at, "version": ticket.version,
    }
    if detail:
        comments = db.scalars(select(Comment).where(Comment.ticket_id == ticket.id).order_by(Comment.created_at)).all()
        result["comments"] = [{"id": x.id, "body": x.body, "author_id": x.author_id,
                               "author_name": db.get(User, x.author_id).name, "created_at": x.created_at} for x in comments]
        events = db.scalars(select(AuditEvent).where(AuditEvent.ticket_id == ticket.id).order_by(AuditEvent.id.desc())).all()
        result["activity"] = [{"id": x.id, "action": x.action, "details": json.loads(x.details),
                               "actor_name": db.get(User, x.actor_id).name, "created_at": x.created_at} for x in events]
    return result


def audit(db: Session, actor_id: int, action: str, details: dict, ticket_id: int | None = None) -> None:
    db.add(AuditEvent(actor_id=actor_id, ticket_id=ticket_id, action=action, details=json.dumps(details)))


def seed_database(db: Session, demo: bool) -> None:
    if db.scalar(select(func.count(User.id))) != 0:
        return
    if demo:
        password = os.environ.get("DEMO_PASSWORD", "DemoPass123!")
        users = [User(email=f"{role}@demo.local", name=role.title() + " Demo", role=role,
                      password_hash=hash_password(password)) for role in ("admin", "agent", "viewer")]
        db.add_all(users)
        db.flush()
        examples = [
            ("Checkout fails for several customers", "Customers are receiving an error when paying for subscriptions at checkout.", "billing"),
            ("Invoice amount is incorrect", "Our team received a monthly invoice with an unexpected total amount.", "billing"),
            ("Password reset link expired", "The password reset email link has expired and I cannot access my account.", "account"),
            ("Dashboard chart does not load", "The analytics dashboard shows a blank chart after opening the report.", "technical"),
        ]
        for title, description, category in examples:
            prediction = suggest_priority(title, description)
            ticket = Ticket(title=title, description=description, category=category, created_by_id=users[1].id,
                            suggested_priority=prediction["priority"], suggestion_confidence=prediction["confidence"])
            db.add(ticket)
        db.commit()
    else:
        email, password = os.environ.get("BOOTSTRAP_ADMIN_EMAIL"), os.environ.get("BOOTSTRAP_ADMIN_PASSWORD")
        if email and password and len(password) >= 10:
            db.add(User(email=email.lower(), name="Administrator", role="admin", password_hash=hash_password(password)))
            db.commit()


def create_app(database_url: str | None = None, seed_demo: bool | None = None) -> FastAPI:
    engine = make_engine(database_url)
    SessionLocal = make_session_factory(engine)
    demo = seed_demo if seed_demo is not None else engine.url.get_backend_name() == "sqlite" and os.environ.get("SUPPORTOPS_DEMO", "0") == "1"

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        Base.metadata.create_all(engine)
        with SessionLocal() as db:
            seed_database(db, demo)
        yield
        engine.dispose()

    app = FastAPI(title="SupportOps AI", version="1.0.0", lifespan=lifespan)

    def get_db():
        with SessionLocal() as db:
            yield db

    def get_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)) -> User:
        return current_user(credentials, db)

    def ticket_or_404(ticket_id: int, db: Session) -> Ticket:
        ticket = db.get(Ticket, ticket_id)
        if ticket is None:
            raise HTTPException(status_code=404, detail="Ticket not found")
        return ticket

    def check_version(ticket: Ticket, expected: int):
        if ticket.version != expected:
            raise HTTPException(status_code=409, detail="Ticket changed; reload before saving")

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.get("/api/config")
    def public_config():
        return {"demo": demo}

    @app.post("/api/auth/login")
    def login(payload: LoginIn, db: Session = Depends(get_db)):
        user = db.scalar(select(User).where(User.email == payload.email.strip().lower()))
        if user is None or not verify_password(payload.password, user.password_hash):
            raise HTTPException(status_code=401, detail="Invalid credentials")
        return {"token": new_token(db, user), "user": user_dict(user)}

    @app.post("/api/auth/logout")
    def logout(credentials: HTTPAuthorizationCredentials | None = Depends(bearer), user: User = Depends(get_user), db: Session = Depends(get_db)):
        token_hash = hashlib.sha256(credentials.credentials.encode()).hexdigest()
        token = db.scalar(select(SessionToken).where(SessionToken.token_hash == token_hash))
        if token:
            db.delete(token)
            db.commit()
        return {"ok": True}

    @app.get("/api/me")
    def me(user: User = Depends(get_user)):
        return user_dict(user)

    @app.get("/api/users")
    def users(user: User = Depends(get_user), db: Session = Depends(get_db)):
        return [user_dict(x) for x in db.scalars(select(User).order_by(User.name)).all()]

    @app.post("/api/users", status_code=201)
    def create_user(payload: UserIn, user: User = Depends(get_user), db: Session = Depends(get_db)):
        require_role(user, "admin")
        if payload.role not in ROLES:
            raise HTTPException(status_code=422, detail="Invalid role")
        email = payload.email.strip().lower()
        if "@" not in email or db.scalar(select(User).where(User.email == email)):
            raise HTTPException(status_code=409, detail="Email already used or invalid")
        created = User(email=email, name=payload.name.strip(), role=payload.role, password_hash=hash_password(payload.password))
        db.add(created)
        db.flush()
        audit(db, user.id, "user_created", {"user_id": created.id, "role": created.role})
        db.commit()
        return user_dict(created)

    @app.patch("/api/users/{user_id}")
    def update_user_role(user_id: int, payload: RoleUpdateIn, user: User = Depends(get_user), db: Session = Depends(get_db)):
        require_role(user, "admin")
        target = db.get(User, user_id)
        if target is None:
            raise HTTPException(status_code=404, detail="User not found")
        if payload.role not in ROLES:
            raise HTTPException(status_code=422, detail="Invalid role")
        if user_id == user.id and payload.role != "admin":
            raise HTTPException(status_code=409, detail="You cannot remove your own admin role")
        before = target.role
        target.role = payload.role
        audit(db, user.id, "user_role_changed", {"user_id": target.id, "from": before, "to": target.role})
        db.commit()
        return user_dict(target)

    @app.get("/api/tickets")
    def tickets(q: str = "", status_filter: str = Query(default="", alias="status"), priority: str = "",
                assigned_to_id: int | None = None, needs_review: bool = False, page: int = Query(default=1, ge=1),
                page_size: int = Query(default=20, ge=1, le=100), user: User = Depends(get_user), db: Session = Depends(get_db)):
        statement = select(Ticket)
        if q.strip():
            pattern = "%" + q.strip().replace("%", "\\%").replace("_", "\\_") + "%"
            statement = statement.where(or_(Ticket.title.ilike(pattern, escape="\\"), Ticket.description.ilike(pattern, escape="\\")))
        if status_filter:
            if status_filter not in STATUSES:
                raise HTTPException(status_code=422, detail="Invalid status")
            statement = statement.where(Ticket.status == status_filter)
        if priority:
            if priority not in PRIORITIES:
                raise HTTPException(status_code=422, detail="Invalid priority")
            statement = statement.where(Ticket.priority == priority)
        if assigned_to_id is not None:
            statement = statement.where(Ticket.assigned_to_id == assigned_to_id)
        if needs_review:
            statement = statement.where(Ticket.reviewed_at.is_(None))
        total = db.scalar(select(func.count()).select_from(statement.subquery()))
        rows = db.scalars(statement.order_by(Ticket.created_at.desc(), Ticket.id.desc()).offset((page-1)*page_size).limit(page_size)).all()
        return {"items": [ticket_dict(row, db) for row in rows], "total": total, "page": page, "page_size": page_size}

    @app.post("/api/tickets", status_code=201)
    def create_ticket(payload: TicketIn, user: User = Depends(get_user), db: Session = Depends(get_db)):
        require_role(user, "admin", "agent")
        if len(payload.title) < 4 or len(payload.description) < 15:
            raise HTTPException(status_code=422, detail="Title or description is too short")
        if payload.category not in CATEGORIES:
            raise HTTPException(status_code=422, detail="Invalid category")
        if payload.assigned_to_id is not None:
            assignee = db.get(User, payload.assigned_to_id)
            if not assignee or assignee.role not in {"admin", "agent"}:
                raise HTTPException(status_code=422, detail="Invalid assignee")
        prediction = suggest_priority(payload.title, payload.description)
        ticket = Ticket(title=payload.title.strip(), description=payload.description.strip(), category=payload.category,
                        created_by_id=user.id, assigned_to_id=payload.assigned_to_id,
                        suggested_priority=prediction["priority"], suggestion_confidence=prediction["confidence"])
        db.add(ticket)
        db.flush()
        audit(db, user.id, "ticket_created", {"suggestion": prediction}, ticket.id)
        db.commit()
        return ticket_dict(ticket, db, detail=True)

    @app.get("/api/tickets/{ticket_id}")
    def get_ticket(ticket_id: int, user: User = Depends(get_user), db: Session = Depends(get_db)):
        return ticket_dict(ticket_or_404(ticket_id, db), db, detail=True)

    @app.patch("/api/tickets/{ticket_id}")
    def update_ticket(ticket_id: int, payload: TicketUpdateIn, user: User = Depends(get_user), db: Session = Depends(get_db)):
        require_role(user, "admin", "agent")
        ticket = ticket_or_404(ticket_id, db)
        check_version(ticket, payload.expected_version)
        changes = {}
        if payload.status is not None:
            if payload.status not in STATUSES:
                raise HTTPException(status_code=422, detail="Invalid status")
            changes["status"] = [ticket.status, payload.status]
            ticket.status = payload.status
        if "assigned_to_id" in payload.model_fields_set:
            if payload.assigned_to_id is not None:
                assignee = db.get(User, payload.assigned_to_id)
                if not assignee or assignee.role not in {"admin", "agent"}:
                    raise HTTPException(status_code=422, detail="Invalid assignee")
            changes["assigned_to_id"] = [ticket.assigned_to_id, payload.assigned_to_id]
            ticket.assigned_to_id = payload.assigned_to_id
        if not changes:
            raise HTTPException(status_code=422, detail="No changes supplied")
        ticket.version += 1
        ticket.updated_at = utcnow()
        audit(db, user.id, "ticket_updated", changes, ticket.id)
        db.commit()
        return ticket_dict(ticket, db, detail=True)

    @app.post("/api/tickets/{ticket_id}/comments", status_code=201)
    def add_comment(ticket_id: int, payload: CommentIn, user: User = Depends(get_user), db: Session = Depends(get_db)):
        require_role(user, "admin", "agent")
        if len(payload.body) < 2:
            raise HTTPException(status_code=422, detail="Comment is too short")
        ticket = ticket_or_404(ticket_id, db)
        db.add(Comment(ticket_id=ticket.id, author_id=user.id, body=payload.body.strip()))
        audit(db, user.id, "comment_added", {"length": len(payload.body)}, ticket.id)
        db.commit()
        return ticket_dict(ticket, db, detail=True)

    @app.get("/api/tickets/{ticket_id}/suggestions")
    def suggestions(ticket_id: int, user: User = Depends(get_user), db: Session = Depends(get_db)):
        ticket = ticket_or_404(ticket_id, db)
        candidates = db.scalars(select(Ticket).where(Ticket.id != ticket_id).order_by(Ticket.id.desc()).limit(500)).all()
        duplicate_matches = find_duplicates(ticket.title, ticket.description,
                                           [{"id": x.id, "title": x.title, "description": x.description} for x in candidates])
        return {"priority": ticket.suggested_priority, "confidence": ticket.suggestion_confidence,
                "model": "tfidf-logistic-regression-demo-v1", "duplicates": duplicate_matches,
                "requires_human_review": True}

    @app.post("/api/tickets/{ticket_id}/review")
    def review_ticket(ticket_id: int, payload: ReviewIn, user: User = Depends(get_user), db: Session = Depends(get_db)):
        require_role(user, "admin", "agent")
        ticket = ticket_or_404(ticket_id, db)
        check_version(ticket, payload.expected_version)
        if payload.priority not in PRIORITIES:
            raise HTTPException(status_code=422, detail="Invalid priority")
        if payload.duplicate_of_id is not None:
            if payload.duplicate_of_id == ticket_id or db.get(Ticket, payload.duplicate_of_id) is None:
                raise HTTPException(status_code=422, detail="Invalid duplicate ticket")
        previous = {"priority": ticket.priority, "duplicate_of_id": ticket.duplicate_of_id}
        ticket.priority = payload.priority
        ticket.duplicate_of_id = payload.duplicate_of_id
        ticket.reviewed_by_id = user.id
        ticket.reviewed_at = utcnow()
        ticket.updated_at = utcnow()
        ticket.version += 1
        audit(db, user.id, "ai_reviewed", {"suggested_priority": ticket.suggested_priority,
              "chosen_priority": payload.priority, "duplicate_of_id": payload.duplicate_of_id,
              "previous": previous, "note": payload.note}, ticket.id)
        db.commit()
        return ticket_dict(ticket, db, detail=True)

    @app.get("/api/dashboard")
    def dashboard(user: User = Depends(get_user), db: Session = Depends(get_db)):
        by_status = dict(db.execute(select(Ticket.status, func.count()).group_by(Ticket.status)).all())
        by_priority = dict(db.execute(select(Ticket.priority, func.count()).group_by(Ticket.priority)).all())
        by_category = dict(db.execute(select(Ticket.category, func.count()).group_by(Ticket.category)).all())
        daily = [{"date": str(day), "count": count} for day, count in db.execute(
            select(func.date(Ticket.created_at), func.count()).group_by(func.date(Ticket.created_at)).order_by(func.date(Ticket.created_at))).all()]
        workload = [{"agent": name, "open_tickets": count} for name, count in db.execute(
            select(User.name, func.count(Ticket.id)).join(Ticket, Ticket.assigned_to_id == User.id)
            .where(Ticket.status != "resolved").group_by(User.id, User.name).order_by(func.count(Ticket.id).desc())).all()]
        return {"total": db.scalar(select(func.count(Ticket.id))),
                "unreviewed": db.scalar(select(func.count(Ticket.id)).where(Ticket.reviewed_at.is_(None))),
                "urgent_active": db.scalar(select(func.count(Ticket.id)).where(Ticket.status != "resolved", Ticket.priority.in_(["high", "critical"]))),
                "by_status": by_status, "by_priority": by_priority, "by_category": by_category,
                "daily": daily, "workload": workload}

    @app.get("/api/audit")
    def audit_log(user: User = Depends(get_user), db: Session = Depends(get_db)):
        require_role(user, "admin")
        events = db.scalars(select(AuditEvent).order_by(AuditEvent.id.desc()).limit(100)).all()
        return [{"id": x.id, "action": x.action, "ticket_id": x.ticket_id, "details": json.loads(x.details),
                 "actor": db.get(User, x.actor_id).name, "created_at": x.created_at} for x in events]

    frontend_dist = Path(os.environ.get("FRONTEND_DIST", Path(__file__).resolve().parents[2] / "frontend" / "dist"))
    if frontend_dist.exists():
        app.mount("/assets", StaticFiles(directory=frontend_dist / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def frontend(path: str):
            if path.startswith("api/"):
                raise HTTPException(status_code=404, detail="Not found")
            candidate = frontend_dist / path
            if path and candidate.is_file() and candidate.resolve().is_relative_to(frontend_dist.resolve()):
                return FileResponse(candidate)
            return FileResponse(frontend_dist / "index.html")
    return app


app = create_app()
