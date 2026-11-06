export type Role = "admin" | "agent" | "viewer";
export type User = { id: number; email: string; name: string; role: Role };
export type Ticket = {
  id: number;
  title: string;
  description: string;
  category: string;
  status: string;
  priority: string;
  suggested_priority: string;
  suggestion_confidence: number;
  assigned_to_id: number | null;
  assigned_to_name: string | null;
  duplicate_of_id: number | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  comments?: {
    id: number;
    body: string;
    author_name: string;
    created_at: string;
  }[];
  activity?: {
    id: number;
    action: string;
    actor_name: string;
    details: Record<string, unknown>;
    created_at: string;
  }[];
};
export type Dashboard = {
  total: number;
  unreviewed: number;
  urgent_active: number;
  by_status: Record<string, number>;
  by_priority: Record<string, number>;
  by_category: Record<string, number>;
  daily: { date: string; count: number }[];
  workload: { agent: string; open_tickets: number }[];
};
export type Suggestions = {
  priority: string;
  confidence: number;
  model: string;
  requires_human_review: boolean;
  duplicates: { ticket_id: number; title: string; score: number }[];
};

export async function api<T>(
  path: string,
  token?: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.detail || `Request failed (${response.status})`);
  return data as T;
}

export const dateLabel = (date: string) =>
  new Date(date).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
