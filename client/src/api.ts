import type {
  AdminSummary,
  AdminUser,
  CreditRequest,
  CreditRequestStatus,
  CreditTransaction,
  Profile,
  RedemptionRequest,
  RedemptionStatus,
  SideBet,
  SideBetDetail
} from "../../shared/types";
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
    throw new Error(formatApiError(body?.error, response.status));
  }

  return response.json() as Promise<T>;
}

function formatApiError(error: unknown, status: number) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    if ("message" in error && typeof error.message === "string") return error.message;
    try {
      return JSON.stringify(error);
    } catch {
      return `Request failed with ${status}`;
    }
  }
  return `Request failed with ${status}`;
}

export const api = {
  me: () => apiFetch<Profile>("/me"),
  sideBets: (search: string, status: string) =>
    apiFetch<SideBet[]>(`/side-bets?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`),
  sideBet: (id: string) => apiFetch<SideBetDetail>(`/side-bets/${id}`),
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
  rectifySideBet: (id: string, winningOptionId: string) =>
    apiFetch<{
      ok: true;
      previousWinnerCount: number;
      correctedWinnerCount: number;
      previousPayoutCredits: number;
      correctedPayoutCredits: number;
      feeCredits: number;
    }>(`/admin/side-bets/${id}/rectify`, {
      method: "POST",
      body: JSON.stringify({ winningOptionId })
    }),
  transactions: () => apiFetch<CreditTransaction[]>("/wallet/transactions"),
  redemptions: () => apiFetch<RedemptionRequest[]>("/wallet/redemptions"),
  creditRequests: () => apiFetch<CreditRequest[]>("/wallet/credit-requests"),
  createRedemption: (payload: { amountCredits: number; claimDetails: string }) =>
    apiFetch<RedemptionRequest>("/wallet/redemptions", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  createCreditRequest: (payload: { amountCredits: number; requestReason: string }) =>
    apiFetch<CreditRequest>("/wallet/credit-requests", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  adminSummary: () => apiFetch<AdminSummary>("/admin/summary"),
  adminUsers: () => apiFetch<AdminUser[]>("/admin/users"),
  adminTransactions: () => apiFetch<CreditTransaction[]>("/admin/transactions"),
  adminAddCredits: (payload: { userId: string; amountCredits: number; description: string }) =>
    apiFetch<{ ok: true; creditsBalance: number }>("/admin/credits", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  adminRedemptions: () => apiFetch<RedemptionRequest[]>("/admin/redemptions"),
  adminCreditRequests: () => apiFetch<CreditRequest[]>("/admin/credit-requests"),
  adminReviewRedemption: (id: string, payload: { status: Exclude<RedemptionStatus, "pending">; adminNote?: string }) =>
    apiFetch<RedemptionRequest>(`/admin/redemptions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  adminReviewCreditRequest: (id: string, payload: { status: Exclude<CreditRequestStatus, "pending">; adminNote?: string }) =>
    apiFetch<CreditRequest>(`/admin/credit-requests/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    })
};
