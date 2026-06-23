import type { AdminSummary, AdminUser, CreditTransaction, Profile, SideBet } from "../../shared/types";
import { supabase } from "./supabase";

async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token;
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    }
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(typeof body?.error === "string" ? body.error : `Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export const api = {
  me: () => apiFetch<Profile>("/me"),
  sideBets: (search: string, status: string) =>
    apiFetch<SideBet[]>(`/side-bets?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`),
  createSideBet: (payload: unknown) =>
    apiFetch<SideBet>("/side-bets", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  joinSideBet: (id: string, optionId: string) =>
    apiFetch<{ ok: true }>(`/side-bets/${id}/join`, {
      method: "POST",
      body: JSON.stringify({ optionId })
    }),
  settleSideBet: (id: string, winningOptionId: string) =>
    apiFetch<{ ok: true; winners: number; payoutCredits: number; feeCredits: number }>(`/side-bets/${id}/settle`, {
      method: "POST",
      body: JSON.stringify({ winningOptionId })
  }),
  transactions: () => apiFetch<CreditTransaction[]>("/wallet/transactions"),
  adminSummary: () => apiFetch<AdminSummary>("/admin/summary"),
  adminUsers: () => apiFetch<AdminUser[]>("/admin/users"),
  adminTransactions: () => apiFetch<CreditTransaction[]>("/admin/transactions"),
  adminAddCredits: (payload: { userId: string; amountCredits: number; description: string }) =>
    apiFetch<{ ok: true; creditsBalance: number }>("/admin/credits", {
      method: "POST",
      body: JSON.stringify(payload)
    })
};
