import React from "react";
import { createRoot } from "react-dom/client";
import {
  api,
  dateLabel,
  type Dashboard,
  type Role,
  type Suggestions,
  type Ticket,
  type User,
} from "./api";
import "./styles.css";

const statuses = ["open", "in_progress", "waiting", "resolved"];
const priorities = ["low", "medium", "high", "critical"];
const categories = ["billing", "account", "technical", "product", "other"];
const label = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());

function App() {
  const [token, setToken] = React.useState(
    sessionStorage.getItem("supportops_token") || "",
  );
  const [user, setUser] = React.useState<User | null>(null);
  const [page, setPage] = React.useState<"dashboard" | "tickets" | "team">(
    "dashboard",
  );
  const [error, setError] = React.useState("");
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [demo, setDemo] = React.useState(false);
  const [focusTicketId, setFocusTicketId] = React.useState<number | null>(null);
  React.useEffect(() => {
    api<{ demo: boolean }>("/api/config")
      .then((result) => setDemo(result.demo))
      .catch(() => setDemo(false));
  }, []);
  React.useEffect(() => {
    if (!token) return;
    api<User>("/api/me", token)
      .then(setUser)
      .catch(() => {
        sessionStorage.removeItem("supportops_token");
        setToken("");
        setUser(null);
      });
  }, [token]);
  const login = async (email: string, password: string) => {
    const result = await api<{ token: string; user: User }>(
      "/api/auth/login",
      undefined,
      { method: "POST", body: JSON.stringify({ email, password }) },
    );
    sessionStorage.setItem("supportops_token", result.token);
    setToken(result.token);
    setUser(result.user);
    setError("");
  };
  const logout = async () => {
    try {
      await api("/api/auth/logout", token, { method: "POST" });
    } catch {
      /* local session still cleared */
    }
    sessionStorage.removeItem("supportops_token");
    setToken("");
    setUser(null);
  };
  if (!user)
    return (
      <Login onLogin={login} error={error} setError={setError} demo={demo} />
    );
  const updated = () => setRefreshKey((k) => k + 1);
  const openTicket = (id: number) => {
    setFocusTicketId(id);
    setPage("tickets");
  };
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">S</span>
          <div>
            <strong>SupportOps</strong>
            <small>AI workspace</small>
          </div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          <button
            aria-label="Overview"
            className={page === "dashboard" ? "active" : ""}
            onClick={() => setPage("dashboard")}
          >
            <span>▦</span> Overview
          </button>
          <button
            aria-label="Tickets"
            className={page === "tickets" ? "active" : ""}
            onClick={() => {
              setFocusTicketId(null);
              setPage("tickets");
            }}
          >
            <span>▤</span> Tickets
          </button>
          {user.role === "admin" && (
            <button
              aria-label="Team"
              className={page === "team" ? "active" : ""}
              onClick={() => setPage("team")}
            >
              <span>♙</span> Team
            </button>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="avatar">{user.name.charAt(0)}</div>
          <div className="identity">
            <strong>{user.name}</strong>
            <small>{label(user.role)}</small>
          </div>
          <button className="logout" onClick={logout} title="Sign out">
            ↪
          </button>
        </div>
      </aside>
      <main className="main">
        <div className="topline">
          <span>WORKSPACE / {page.toUpperCase()}</span>
          <div className="topline-right">
            <span className="status-dot" />{" "}
            {demo ? "Local demo" : "Workspace online"}{" "}
            <span className="top-date">
              {new Date().toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
        </div>
        {page === "dashboard" && (
          <Overview
            token={token}
            refreshKey={refreshKey}
            goTickets={() => setPage("tickets")}
            openTicket={openTicket}
          />
        )}
        {page === "tickets" && (
          <Tickets
            token={token}
            user={user}
            refreshKey={refreshKey}
            onChange={updated}
            focusTicketId={focusTicketId}
          />
        )}
        {page === "team" && user.role === "admin" && (
          <Team token={token} currentUser={user} />
        )}
      </main>
    </div>
  );
}

function Login({
  onLogin,
  error,
  setError,
  demo,
}: {
  onLogin: (email: string, password: string) => Promise<void>;
  error: string;
  setError: (error: string) => void;
  demo: boolean;
}) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (demo && !email && !password) {
      setEmail("agent@demo.local");
      setPassword("DemoPass123!");
    }
  }, [demo, email, password]);
  return (
    <div className="login-screen">
      <div className="login-art">
        <div className="brand big">
          <span className="brand-mark">S</span>
          <div>
            <strong>SupportOps</strong>
            <small>AI workspace</small>
          </div>
        </div>
        <div className="art-copy">
          <div className="eyebrow">SMARTER SUPPORT OPERATIONS</div>
          <h1>
            Every ticket,
            <br />
            <em>better handled.</em>
          </h1>
          <p>
            A complete workspace for your team to triage, resolve, and learn
            from customer issues.
          </p>
          <div className="art-stats">
            <span>
              <b>01</b> Human-led AI
            </span>
            <span>
              <b>02</b> Clear accountability
            </span>
            <span>
              <b>03</b> Real-time visibility
            </span>
          </div>
        </div>
        <div className="art-footer">A local portfolio demonstration</div>
      </div>
      <div className="login-panel">
        <form
          className="login-card"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await onLogin(email, password);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="mobile-brand">SupportOps AI</div>
          <div className="eyebrow">WELCOME BACK</div>
          <h2>Sign in to your workspace</h2>
          <p>
            {demo
              ? "Use a demo account to explore the full workflow."
              : "Enter your workspace credentials."}
          </p>
          <label>
            Email address
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && (
            <div className="alert" role="alert">
              {error}
            </div>
          )}
          <button className="primary full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"} <span>→</span>
          </button>
          {demo && (
            <div className="demo-box">
              <strong>Demo access</strong>
              <p>
                Choose a role. Password for all demo accounts:{" "}
                <code>DemoPass123!</code>
              </p>
              <div className="role-links">
                {(["admin", "agent", "viewer"] as Role[]).map((role) => (
                  <button
                    type="button"
                    key={role}
                    onClick={() => {
                      setEmail(`${role}@demo.local`);
                      setPassword("DemoPass123!");
                    }}
                  >
                    {label(role)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

function Overview({
  token,
  refreshKey,
  goTickets,
  openTicket,
}: {
  token: string;
  refreshKey: number;
  goTickets: () => void;
  openTicket: (id: number) => void;
}) {
  const [data, setData] = React.useState<Dashboard | null>(null);
  const [reviewQueue, setReviewQueue] = React.useState<Ticket[]>([]);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    Promise.all([
      api<Dashboard>("/api/dashboard", token),
      api<{ items: Ticket[] }>(
        "/api/tickets?needs_review=true&page_size=4",
        token,
      ),
    ])
      .then(([summary, queue]) => {
        setData(summary);
        setReviewQueue(queue.items);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, [token, refreshKey]);
  const daily = data?.daily.slice(-14) || [];
  const max = Math.max(1, ...daily.map((x) => x.count));
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">COMMAND CENTER</div>
          <h1>Operations overview</h1>
          <p>
            A clear view of the queue, team workload, and what needs attention.
          </p>
        </div>
        <button className="secondary" onClick={goTickets}>
          View tickets <span>↗</span>
        </button>
      </div>
      {error && <div className="alert">{error}</div>}
      <div className="metric-grid">
        <Metric
          label="Total tickets"
          value={data?.total ?? "—"}
          tone="blue"
          sub="Across all statuses"
          icon="▤"
        />
        <Metric
          label="Awaiting AI review"
          value={data?.unreviewed ?? "—"}
          tone="amber"
          sub="Needs a human decision"
          icon="◇"
        />
        <Metric
          label="Urgent & active"
          value={data?.urgent_active ?? "—"}
          tone="rose"
          sub="High or critical priority"
          icon="!"
        />
        <Metric
          label="Resolved"
          value={data ? data.by_status.resolved || 0 : "—"}
          tone="green"
          sub="Successfully closed"
          icon="✓"
        />
      </div>
      <section className="panel review-queue">
        <div className="panel-head">
          <div>
            <div className="eyebrow">ACTION REQUIRED</div>
            <h2>Human review queue</h2>
            <p>AI makes a suggestion. Your team makes the decision.</p>
          </div>
          <button className="text-action" onClick={goTickets}>
            All tickets <span>→</span>
          </button>
        </div>
        <div className="review-list">
          {reviewQueue.length ? (
            reviewQueue.map((ticket) => (
              <button
                className="review-row"
                key={ticket.id}
                onClick={() => openTicket(ticket.id)}
              >
                <span className="review-row-id">
                  #{String(ticket.id).padStart(4, "0")}
                </span>
                <span className="review-row-main">
                  <strong>{ticket.title}</strong>
                  <small>
                    {label(ticket.category)} · {dateLabel(ticket.created_at)}
                  </small>
                </span>
                <span className={`priority ${ticket.suggested_priority}`}>
                  AI: {label(ticket.suggested_priority)}
                </span>
                <span className="review-arrow">→</span>
              </button>
            ))
          ) : (
            <div className="empty-mini">
              Everything is reviewed. New tickets will appear here.
            </div>
          )}
        </div>
      </section>
      <div className="dashboard-grid">
        <section className="panel trend-panel">
          <div className="panel-head">
            <div>
              <h2>Ticket volume</h2>
              <p>New tickets over the last 14 active days</p>
            </div>
            <span className="pill">Daily</span>
          </div>
          <div
            className="bar-chart"
            role="img"
            aria-label="Daily ticket volume"
          >
            {daily.map((row, i) => (
              <div
                className="bar-item"
                key={i}
                title={`${row.date}: ${row.count} tickets`}
              >
                <span
                  className="bar"
                  style={{ height: `${Math.max(8, (row.count / max) * 100)}%` }}
                />
                <small>
                  {new Date(row.date + "T00:00:00").toLocaleDateString(
                    undefined,
                    { month: "short", day: "numeric" },
                  )}
                </small>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Queue status</h2>
              <p>Where work stands now</p>
            </div>
          </div>
          <div className="status-list">
            {statuses.map((s) => {
              const count = data?.by_status[s] || 0;
              return (
                <div key={s}>
                  <span className={`status-icon ${s}`} />
                  <span>{label(s)}</span>
                  <strong>{count}</strong>
                  <div className="track">
                    <div
                      style={{
                        width: `${data?.total ? (count / data.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
      <div className="dashboard-grid bottom">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>By category</h2>
              <p>Issue types across your queue</p>
            </div>
          </div>
          <div className="category-grid">
            {categories.map((cat) => (
              <div key={cat}>
                <span>{label(cat)}</span>
                <strong>{data?.by_category[cat] || 0}</strong>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Agent workload</h2>
              <p>Active assigned tickets</p>
            </div>
          </div>
          {data?.workload.length ? (
            <div className="workload-list">
              {data.workload.map((x) => (
                <div key={x.agent}>
                  <span className="mini-avatar">{x.agent[0]}</span>
                  <span>{x.agent}</span>
                  <strong>{x.open_tickets}</strong>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-mini">No active assignments yet.</div>
          )}
        </section>
      </div>
    </>
  );
}

function Metric({
  label: title,
  value,
  tone,
  sub,
  icon,
}: {
  label: string;
  value: number | string;
  tone: string;
  sub: string;
  icon: string;
}) {
  return (
    <div className="metric">
      <div className={`metric-icon ${tone}`}>{icon}</div>
      <div className="metric-label">{title}</div>
      <strong>{value}</strong>
      <small>{sub}</small>
    </div>
  );
}

function Tickets({
  token,
  user,
  refreshKey,
  onChange,
  focusTicketId,
}: {
  token: string;
  user: User;
  refreshKey: number;
  onChange: () => void;
  focusTicketId: number | null;
}) {
  const [items, setItems] = React.useState<Ticket[]>([]);
  const [total, setTotal] = React.useState(0);
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [priority, setPriority] = React.useState("");
  const [selected, setSelected] = React.useState<number | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState("");
  const [page, setPage] = React.useState(1);
  React.useEffect(() => {
    if (focusTicketId !== null) setSelected(focusTicketId);
  }, [focusTicketId]);
  React.useEffect(() => {
    const params = new URLSearchParams({
      q,
      status,
      priority,
      page: String(page),
      page_size: "12",
    });
    api<{ items: Ticket[]; total: number }>(`/api/tickets?${params}`, token)
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, [token, q, status, priority, page, refreshKey]);
  const changed = () => {
    onChange();
    setCreating(false);
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">INBOX</div>
          <h1>Ticket workspace</h1>
          <p>Search, prioritize, and resolve issues with your team.</p>
        </div>
        {user.role !== "viewer" && (
          <button className="primary" onClick={() => setCreating(true)}>
            ＋ New ticket
          </button>
        )}
      </div>
      <section className="panel tickets-panel">
        <div className="ticket-toolbar">
          <div className="search-field">
            <span>⌕</span>
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Search tickets by title or description"
              aria-label="Search tickets"
            />
          </div>
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {statuses.map((x) => (
              <option key={x} value={x}>
                {label(x)}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by priority"
            value={priority}
            onChange={(e) => {
              setPriority(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All priorities</option>
            {priorities.map((x) => (
              <option key={x} value={x}>
                {label(x)}
              </option>
            ))}
          </select>
        </div>
        {error && <div className="alert">{error}</div>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Category</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Assignee</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {items.map((ticket) => (
                <tr
                  key={ticket.id}
                  onClick={() => setSelected(ticket.id)}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && setSelected(ticket.id)}
                >
                  <td>
                    <div className="ticket-title">{ticket.title}</div>
                    <div className="ticket-id">
                      #{String(ticket.id).padStart(4, "0")}{" "}
                      {ticket.reviewed_at === null && (
                        <span className="review-dot" title="Needs AI review" />
                      )}
                    </div>
                  </td>
                  <td>{label(ticket.category)}</td>
                  <td>
                    <span className={`priority ${ticket.priority}`}>
                      {label(ticket.priority)}
                    </span>
                  </td>
                  <td>
                    <span className={`status ${ticket.status}`}>
                      <i />
                      {label(ticket.status)}
                    </span>
                  </td>
                  <td>
                    {ticket.assigned_to_name || (
                      <span className="muted">Unassigned</span>
                    )}
                  </td>
                  <td className="muted">{dateLabel(ticket.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length === 0 && (
            <div className="empty-state">
              <strong>No tickets found</strong>
              <p>Try changing your search or filters.</p>
            </div>
          )}
        </div>
        <div className="mobile-ticket-list">
          {items.map((ticket) => (
            <button
              key={ticket.id}
              className="mobile-ticket"
              onClick={() => setSelected(ticket.id)}
            >
              <span className="mobile-ticket-top">
                <span className="ticket-id">
                  #{String(ticket.id).padStart(4, "0")} ·{" "}
                  {label(ticket.category)}
                </span>
                {ticket.reviewed_at === null && (
                  <span className="needs-review">Needs review</span>
                )}
              </span>
              <strong>{ticket.title}</strong>
              <span className="mobile-ticket-bottom">
                <span className={`status ${ticket.status}`}>
                  <i />
                  {label(ticket.status)}
                </span>
                <span className={`priority ${ticket.priority}`}>
                  {label(ticket.priority)}
                </span>
                <span className="muted">
                  {ticket.assigned_to_name || "Unassigned"}
                </span>
              </span>
            </button>
          ))}
          {items.length === 0 && (
            <div className="empty-state">
              <strong>No tickets found</strong>
              <p>Try changing your search or filters.</p>
            </div>
          )}
        </div>
        <div className="table-footer">
          <span>
            {total} ticket{total === 1 ? "" : "s"} found
          </span>
          <div>
            <button disabled={page === 1} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <span>Page {page}</span>
            <button
              disabled={page * 12 >= total}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </section>
      {creating && (
        <CreateTicket
          token={token}
          close={() => setCreating(false)}
          created={changed}
        />
      )}
      {selected !== null && (
        <TicketDetail
          id={selected}
          token={token}
          role={user.role}
          close={() => setSelected(null)}
          changed={onChange}
        />
      )}
    </>
  );
}

function CreateTicket({
  token,
  close,
  created,
}: {
  token: string;
  close: () => void;
  created: () => void;
}) {
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [category, setCategory] = React.useState("technical");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="overlay" onMouseDown={close}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="eyebrow">NEW ISSUE</div>
            <h2>Create a ticket</h2>
          </div>
          <button className="close" onClick={close}>
            ×
          </button>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api("/api/tickets", token, {
                method: "POST",
                body: JSON.stringify({ title, description, category }),
              });
              created();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Issue title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              minLength={4}
              maxLength={160}
              placeholder="What happened?"
              required
            />
          </label>
          <label>
            Category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {categories.map((x) => (
                <option key={x} value={x}>
                  {label(x)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              minLength={15}
              maxLength={5000}
              rows={6}
              placeholder="Include the impact and steps to reproduce"
              required
            />
          </label>
          <div className="info-note">
            AI will suggest a priority and possible duplicate tickets after
            creation. An agent makes the final decision.
          </div>
          {error && <div className="alert">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={close}>
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              {busy ? "Creating…" : "Create ticket"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TicketDetail({
  id,
  token,
  role,
  close,
  changed,
}: {
  id: number;
  token: string;
  role: Role;
  close: () => void;
  changed: () => void;
}) {
  const [ticket, setTicket] = React.useState<Ticket | null>(null);
  const [suggestions, setSuggestions] = React.useState<Suggestions | null>(
    null,
  );
  const [users, setUsers] = React.useState<User[]>([]);
  const [priority, setPriority] = React.useState("medium");
  const [duplicate, setDuplicate] = React.useState("");
  const [note, setNote] = React.useState("");
  const [comment, setComment] = React.useState("");
  const [error, setError] = React.useState("");
  const canEdit = role !== "viewer";
  const load = React.useCallback(() => {
    Promise.all([
      api<Ticket>(`/api/tickets/${id}`, token),
      api<Suggestions>(`/api/tickets/${id}/suggestions`, token),
      api<User[]>("/api/users", token),
    ])
      .then(([t, s, u]) => {
        setTicket(t);
        setSuggestions(s);
        setUsers(u);
        setPriority(t.reviewed_at ? t.priority : s.priority);
        setDuplicate(t.duplicate_of_id ? String(t.duplicate_of_id) : "");
      })
      .catch((e) => setError(e.message));
  }, [id, token]);
  React.useEffect(() => {
    void load();
  }, [load]);
  const mutate = async (path: string, body: unknown, method = "POST") => {
    try {
      await api(path, token, { method, body: JSON.stringify(body) });
      setError("");
      load();
      changed();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="overlay drawer-overlay" onMouseDown={close}>
      <div className="drawer" onMouseDown={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <span className="eyebrow">TICKET #{String(id).padStart(4, "0")}</span>
          <button className="close" onClick={close}>
            ×
          </button>
        </div>
        {ticket ? (
          <>
            <h2>{ticket.title}</h2>
            <p className="drawer-description">{ticket.description}</p>
            <div className="detail-meta">
              <div>
                <small>STATUS</small>
                {canEdit ? (
                  <select
                    value={ticket.status}
                    onChange={(e) =>
                      mutate(
                        `/api/tickets/${id}`,
                        {
                          expected_version: ticket.version,
                          status: e.target.value,
                        },
                        "PATCH",
                      )
                    }
                  >
                    {statuses.map((x) => (
                      <option key={x} value={x}>
                        {label(x)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <strong>{label(ticket.status)}</strong>
                )}
              </div>
              <div>
                <small>PRIORITY</small>
                <span className={`priority ${ticket.priority}`}>
                  {label(ticket.priority)}
                </span>
              </div>
              <div>
                <small>CATEGORY</small>
                <strong>{label(ticket.category)}</strong>
              </div>
              <div>
                <small>ASSIGNEE</small>
                {canEdit ? (
                  <select
                    value={ticket.assigned_to_id || ""}
                    onChange={(e) =>
                      mutate(
                        `/api/tickets/${id}`,
                        {
                          expected_version: ticket.version,
                          assigned_to_id: e.target.value
                            ? Number(e.target.value)
                            : null,
                        },
                        "PATCH",
                      )
                    }
                  >
                    <option value="">Unassigned</option>
                    {users
                      .filter((u) => u.role !== "viewer")
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                  </select>
                ) : (
                  <strong>{ticket.assigned_to_name || "Unassigned"}</strong>
                )}
              </div>
            </div>
            <section className="detail-section ai-section">
              <div className="section-title">
                <span className="ai-spark">✦</span>
                <div>
                  <h3>AI triage assistant</h3>
                  <p>Advisory suggestions · agent approval required</p>
                </div>
              </div>
              <div className="suggestion-row">
                <div>
                  <small>SUGGESTED PRIORITY</small>
                  <strong>
                    {label(suggestions?.priority || ticket.suggested_priority)}
                  </strong>
                  <span
                    className="muted"
                    title="This small demo model is not calibrated for production decisions."
                  >
                    Demo model score:{" "}
                    {(
                      suggestions?.confidence ?? ticket.suggestion_confidence
                    ).toFixed(2)}
                  </span>
                </div>
                <div>
                  <small>REVIEW STATUS</small>
                  <strong>
                    {ticket.reviewed_at ? "Reviewed" : "Awaiting review"}
                  </strong>
                </div>
              </div>
              <div className="duplicates">
                <small>POSSIBLE DUPLICATES</small>
                {suggestions?.duplicates.length ? (
                  suggestions.duplicates.map((x) => (
                    <div key={x.ticket_id}>
                      <span>
                        #{x.ticket_id} · {x.title}
                      </span>
                      <b>{Math.round(x.score * 100)}% match</b>
                    </div>
                  ))
                ) : (
                  <p className="muted">No close matches found.</p>
                )}
              </div>
              {canEdit && (
                <div className="review-form">
                  <div className="form-row">
                    <label>
                      Final priority
                      <select
                        value={priority}
                        onChange={(e) => setPriority(e.target.value)}
                      >
                        {priorities.map((x) => (
                          <option key={x} value={x}>
                            {label(x)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Link duplicate
                      <select
                        value={duplicate}
                        onChange={(e) => setDuplicate(e.target.value)}
                      >
                        <option value="">None</option>
                        {suggestions?.duplicates.map((x) => (
                          <option key={x.ticket_id} value={x.ticket_id}>
                            #{x.ticket_id} {x.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label>
                    Review note
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      maxLength={500}
                      placeholder="Why did you choose this decision?"
                    />
                  </label>
                  <button
                    className="primary"
                    onClick={() =>
                      mutate(`/api/tickets/${id}/review`, {
                        expected_version: ticket.version,
                        priority,
                        duplicate_of_id: duplicate ? Number(duplicate) : null,
                        note,
                      })
                    }
                  >
                    {ticket.reviewed_at
                      ? "Update review"
                      : "Confirm human review"}
                  </button>
                </div>
              )}
            </section>
            <section className="detail-section">
              <h3>Conversation</h3>
              {ticket.comments?.length ? (
                ticket.comments.map((x) => (
                  <div className="comment" key={x.id}>
                    <div>
                      <strong>{x.author_name}</strong>
                      <small>{dateLabel(x.created_at)}</small>
                    </div>
                    <p>{x.body}</p>
                  </div>
                ))
              ) : (
                <p className="muted">No comments yet.</p>
              )}
              {canEdit && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (comment.trim()) {
                      mutate(`/api/tickets/${id}/comments`, { body: comment });
                      setComment("");
                    }
                  }}
                >
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Add an internal note"
                    rows={3}
                    minLength={2}
                    maxLength={2000}
                  />
                  <button className="secondary">Add comment</button>
                </form>
              )}
            </section>
            <section className="detail-section">
              <h3>Activity</h3>
              {ticket.activity?.map((x) => (
                <div className="activity" key={x.id}>
                  <span className="activity-dot" />
                  <div>
                    <strong>{label(x.action)}</strong>
                    <p>
                      {x.actor_name} · {dateLabel(x.created_at)}
                    </p>
                  </div>
                </div>
              ))}
            </section>
            {error && <div className="alert">{error}</div>}
          </>
        ) : (
          <div className="loading">Loading ticket… {error}</div>
        )}
      </div>
    </div>
  );
}

function Team({ token, currentUser }: { token: string; currentUser: User }) {
  const [users, setUsers] = React.useState<User[]>([]);
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [role, setRole] = React.useState<Role>("agent");
  const [message, setMessage] = React.useState("");
  const load = React.useCallback(
    () =>
      api<User[]>("/api/users", token)
        .then(setUsers)
        .catch((e) => setMessage(e.message)),
    [token],
  );
  React.useEffect(() => {
    void load();
  }, [load]);
  const changeRole = async (id: number, nextRole: Role) => {
    try {
      await api(`/api/users/${id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ role: nextRole }),
      });
      setMessage("Role updated.");
      load();
    } catch (err) {
      setMessage((err as Error).message);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ACCESS CONTROL</div>
          <h1>Team members</h1>
          <p>Manage who can view, handle, and administer support work.</p>
        </div>
      </div>
      <div className="team-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Workspace users</h2>
              <p>{users.length} members</p>
            </div>
          </div>
          {users.map((u) => (
            <div className="team-person" key={u.id}>
              <span className="mini-avatar">{u.name[0]}</span>
              <div>
                <strong>{u.name}</strong>
                <small>{u.email}</small>
              </div>
              {u.id === currentUser.id ? (
                <span className="pill">Admin · you</span>
              ) : (
                <select
                  aria-label={`Role for ${u.name}`}
                  value={u.role}
                  onChange={(e) => changeRole(u.id, e.target.value as Role)}
                >
                  {(["agent", "viewer", "admin"] as Role[]).map((x) => (
                    <option key={x} value={x}>
                      {label(x)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ))}
          {message && (
            <p role="status" className="muted">
              {message}
            </p>
          )}
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Add team member</h2>
              <p>Assign a role on creation</p>
            </div>
          </div>
          <form
            className="team-form"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api("/api/users", token, {
                  method: "POST",
                  body: JSON.stringify({ email, name, password, role }),
                });
                setMessage("Team member created.");
                setEmail("");
                setName("");
                setPassword("");
                load();
              } catch (err) {
                setMessage((err as Error).message);
              }
            }}
          >
            <label>
              Full name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                minLength={2}
                required
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label>
              Initial password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={10}
                required
              />
            </label>
            <label>
              Role
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
              >
                {(["agent", "viewer", "admin"] as Role[]).map((x) => (
                  <option key={x} value={x}>
                    {label(x)}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary">Create member</button>
          </form>
        </section>
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
