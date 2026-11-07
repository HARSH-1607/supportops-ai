from pathlib import Path
from fastapi.testclient import TestClient
from app.main import create_app


def client_for(tmp_path: Path):
    return TestClient(create_app(f"sqlite:///{(tmp_path / 'test.db').as_posix()}", seed_demo=True))


def auth(client: TestClient, role: str) -> dict:
    response = client.post("/api/auth/login", json={"email": f"{role}@demo.local", "password": "DemoPass123!"})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['token']}"}


def test_role_permissions_and_user_creation(tmp_path):
    with client_for(tmp_path) as client:
        assert client.get("/api/health").json() == {"status": "ok"}
        assert client.get("/api/tickets").status_code == 401
        viewer, agent, admin = (auth(client, role) for role in ("viewer", "agent", "admin"))
        payload = {"title": "Question about invoice", "description": "I need help understanding the latest invoice line items.", "category": "billing"}
        assert client.post("/api/tickets", json=payload, headers=viewer).status_code == 403
        assert client.post("/api/tickets", json=payload, headers=agent).status_code == 201
        user = {"email": "new@example.com", "name": "New Agent", "password": "StrongPass123!", "role": "agent"}
        assert client.post("/api/users", json=user, headers=agent).status_code == 403
        created_user = client.post("/api/users", json=user, headers=admin)
        assert created_user.status_code == 201
        assert client.patch(f"/api/users/{created_user.json()['id']}", json={"role": "viewer"}, headers=agent).status_code == 403
        assert client.patch(f"/api/users/{created_user.json()['id']}", json={"role": "viewer"}, headers=admin).json()["role"] == "viewer"
        assert client.get("/api/audit", headers=viewer).status_code == 403


def test_ai_is_advisory_and_review_is_audited(tmp_path):
    with client_for(tmp_path) as client:
        agent = auth(client, "agent")
        created = client.post("/api/tickets", headers=agent, json={
            "title": "Checkout fails for several customers",
            "description": "Customers are receiving an error when paying for subscriptions at checkout.",
            "category": "billing",
        })
        assert created.status_code == 201
        ticket = created.json()
        assert ticket["reviewed_at"] is None and ticket["priority"] == "medium"
        suggestions = client.get(f"/api/tickets/{ticket['id']}/suggestions", headers=agent).json()
        assert suggestions["requires_human_review"] is True
        assert suggestions["duplicates"][0]["ticket_id"] == 1
        reviewed = client.post(f"/api/tickets/{ticket['id']}/review", headers=agent, json={
            "expected_version": ticket["version"], "priority": "high", "duplicate_of_id": 1,
            "note": "Confirmed same checkout issue"})
        assert reviewed.status_code == 200
        result = reviewed.json()
        assert result["priority"] == "high" and result["duplicate_of_id"] == 1 and result["reviewed_at"]
        assert result["activity"][0]["action"] == "ai_reviewed"
        stale = client.post(f"/api/tickets/{ticket['id']}/review", headers=agent, json={
            "expected_version": ticket["version"], "priority": "low"})
        assert stale.status_code == 409


def test_search_comments_updates_and_dashboard(tmp_path):
    with client_for(tmp_path) as client:
        agent = auth(client, "agent")
        search = client.get("/api/tickets?q=invoice", headers=agent)
        assert search.status_code == 200 and search.json()["total"] == 1
        assert client.get("/api/tickets?needs_review=true", headers=agent).json()["total"] == 4
        ticket = client.get("/api/tickets/2", headers=agent).json()
        updated = client.patch("/api/tickets/2", headers=agent, json={
            "expected_version": ticket["version"], "status": "in_progress"})
        assert updated.status_code == 200 and updated.json()["status"] == "in_progress"
        commented = client.post("/api/tickets/2/comments", headers=agent, json={"body": "Investigating billing records."})
        assert commented.status_code == 201 and len(commented.json()["comments"]) == 1
        dashboard = client.get("/api/dashboard", headers=agent).json()
        assert dashboard["total"] == 4 and dashboard["by_status"]["in_progress"] == 1


def test_demo_accounts_require_explicit_opt_in(tmp_path, monkeypatch):
    monkeypatch.delenv("SUPPORTOPS_DEMO", raising=False)
    monkeypatch.delenv("BOOTSTRAP_ADMIN_EMAIL", raising=False)
    monkeypatch.delenv("BOOTSTRAP_ADMIN_PASSWORD", raising=False)
    with TestClient(create_app(f"sqlite:///{(tmp_path / 'no_demo.db').as_posix()}")) as client:
        assert client.get("/api/config").json() == {"demo": False, "public_demo": False}
        assert client.post("/api/auth/login", json={"email": "agent@demo.local", "password": "DemoPass123!"}).status_code == 401


def test_public_demo_only_allows_viewer(tmp_path, monkeypatch):
    monkeypatch.setenv("SUPPORTOPS_PUBLIC_DEMO", "1")
    with client_for(tmp_path) as client:
        assert client.get("/api/config").json()["public_demo"] is True
        assert client.post("/api/auth/login", json={"email": "admin@demo.local", "password": "DemoPass123!"}).status_code == 403
        assert client.post("/api/auth/login", json={"email": "agent@demo.local", "password": "DemoPass123!"}).status_code == 403
        viewer = auth(client, "viewer")
        assert client.get("/api/tickets", headers=viewer).status_code == 200
        assert client.post("/api/tickets", headers=viewer, json={"title": "Demo question", "description": "This is a fictional support question.", "category": "other"}).status_code == 403
