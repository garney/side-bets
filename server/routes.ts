import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type {
  AdminSummary,
  AdminUser,
  BetOption,
  CreditRequest,
  CreditRequestStatus,
  CreditTransaction,
  RedemptionRequest,
  RedemptionStatus
} from "../shared/types.js";
import { requireAdmin, requireAuth, type AuthedRequest } from "./auth.js";
import { mapSideBet, mapSideBetDetail } from "./mappers.js";
import { supabaseAdmin } from "./supabase.js";

const createBetSchema = z.object({
  title: z.string().min(5).max(140),
  description: z.string().min(10).max(1200),
  sourceUrl: z.string().url().nullable().optional(),
  buyInCredits: z.number().positive().max(100000),
  houseFeePercent: z.number().min(0).max(100).default(0),
  startsAt: z.string().datetime(),
  closesAt: z.string().datetime(),
  options: z.array(z.string().min(1).max(80)).min(2).max(12)
});

const updateBetSchema = z.object({
  title: z.string().min(5).max(140),
  description: z.string().min(10).max(1200),
  sourceUrl: z.string().url().nullable().optional(),
  buyInCredits: z.number().positive().max(100000),
  closesAt: z.string().datetime(),
  options: z.array(z.string().min(1).max(80)).min(2).max(12)
});

const joinBetSchema = z.object({
  optionId: z.string().min(1)
});

const settleBetSchema = z.object({
  winningOptionId: z.string().min(1)
});

const rectifySettlementSchema = z.object({
  winningOptionId: z.string().min(1)
});

const adminCreditAdjustmentSchema = z.object({
  userId: z.string().uuid(),
  amountCredits: z.number().positive().max(10000),
  description: z.string().min(3).max(180).default("Admin credit adjustment")
});

const createRedemptionSchema = z.object({
  amountCredits: z.number().positive().max(10000),
  claimDetails: z.string().min(3).max(1000)
});

const updateRedemptionSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  adminNote: z.string().max(1000).optional()
});

const createCreditRequestSchema = z.object({
  amountCredits: z.number().positive().max(10000),
  requestReason: z.string().min(3).max(1000)
});

const updateCreditRequestSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  adminNote: z.string().max(1000).optional()
});

export function createApiRouter(notifyBetChanged: (betId: string) => Promise<void>) {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({ ok: true, service: "side-bets" });
  });

  router.get("/me", requireAuth, async (req, res) => {
    const user = (req as AuthedRequest).user;
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name, email, avatar_url, credits_balance")
      .eq("id", user.id)
      .single();

    if (error) {
      if (isMissingRedemptionTable(error)) {
        res.json([]);
        return;
      }
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({
      id: data.id,
      displayName: data.display_name,
      email: data.email,
      avatarUrl: data.avatar_url,
      creditsBalance: Number(data.credits_balance),
      isAdmin: user.isAdmin
    });
  });

  router.get("/side-bets", requireAuth, async (req, res) => {
    const search = String(req.query.search ?? "").trim();
    const status = String(req.query.status ?? "all");

    let query = supabaseAdmin
      .from("side_bets")
      .select("*, profiles!side_bets_manager_id_fkey(display_name), bet_entries(id, stake_credits)")
      .order("created_at", { ascending: false });

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    if (status !== "all") {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json(data.map(mapSideBet));
  });

  router.get("/side-bets/:id", requireAuth, async (req, res) => {
    const { data, error } = await supabaseAdmin
      .from("side_bets")
      .select("*, profiles!side_bets_manager_id_fkey(display_name), bet_entries(*, profiles!bet_entries_user_id_fkey(display_name, email))")
      .eq("id", req.params.id)
      .order("created_at", { referencedTable: "bet_entries", ascending: false })
      .single();

    if (error || !data) {
      res.status(404).json({ error: "Side bet not found" });
      return;
    }

    res.json(mapSideBetDetail(data));
  });

  router.post("/side-bets", requireAuth, async (req, res) => {
    const parsed = createBetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const user = (req as AuthedRequest).user;
    const options: BetOption[] = parsed.data.options.map((label) => ({ id: randomUUID(), label }));

    const { data, error } = await supabaseAdmin
      .from("side_bets")
      .insert({
        manager_id: user.id,
        title: parsed.data.title,
        description: parsed.data.description,
        source_url: parsed.data.sourceUrl ?? null,
        buy_in_credits: parsed.data.buyInCredits,
        house_fee_percent: parsed.data.houseFeePercent,
        starts_at: parsed.data.startsAt,
        closes_at: parsed.data.closesAt,
        options
      })
      .select("*, profiles!side_bets_manager_id_fkey(display_name), bet_entries(id, stake_credits)")
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await notifyBetChanged(data.id);
    res.status(201).json(mapSideBet(data));
  });

  router.patch("/side-bets/:id", requireAuth, async (req, res) => {
    const parsed = updateBetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const user = (req as AuthedRequest).user;
    const { data: bet, error: betError } = await supabaseAdmin
      .from("side_bets")
      .select("*, bet_entries(id)")
      .eq("id", req.params.id)
      .single();

    if (betError || !bet) {
      res.status(404).json({ error: "Side bet not found" });
      return;
    }

    if (bet.manager_id !== user.id) {
      res.status(403).json({ error: "Only the side bet creator can edit this side bet" });
      return;
    }

    if (bet.status !== "open") {
      res.status(409).json({ error: "Only open side bets can be edited" });
      return;
    }

    if (new Date(parsed.data.closesAt).getTime() <= new Date(bet.starts_at).getTime()) {
      res.status(400).json({ error: "Close time must be after the start time" });
      return;
    }

    const hasEntries = (bet.bet_entries ?? []).length > 0;
    const currentOptions = bet.options as BetOption[];
    const nextOptions: BetOption[] = parsed.data.options.map((label) => ({ id: randomUUID(), label }));
    const currentOptionLabels = currentOptions.map((option) => option.label);
    const optionLabelsChanged = JSON.stringify(currentOptionLabels) !== JSON.stringify(parsed.data.options);
    const buyInChanged = Number(bet.buy_in_credits) !== parsed.data.buyInCredits;

    if (hasEntries && (optionLabelsChanged || buyInChanged)) {
      res.status(409).json({ error: "Buy-in and options cannot be changed after users have joined" });
      return;
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("side_bets")
      .update({
        title: parsed.data.title,
        description: parsed.data.description,
        source_url: parsed.data.sourceUrl ?? null,
        buy_in_credits: parsed.data.buyInCredits,
        closes_at: parsed.data.closesAt,
        options: hasEntries ? currentOptions : nextOptions
      })
      .eq("id", bet.id)
      .select("*, profiles!side_bets_manager_id_fkey(display_name), bet_entries(*, profiles!bet_entries_user_id_fkey(display_name, email))")
      .order("created_at", { referencedTable: "bet_entries", ascending: false })
      .single();

    if (updateError) {
      res.status(500).json({ error: updateError.message });
      return;
    }

    await notifyBetChanged(bet.id);
    res.json(mapSideBetDetail(updated));
  });

  router.post("/side-bets/:id/join", requireAuth, async (req, res) => {
    const parsed = joinBetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const user = (req as AuthedRequest).user;
    const { data: bet, error: betError } = await supabaseAdmin.from("side_bets").select("*").eq("id", req.params.id).single();
    if (betError || !bet) {
      res.status(404).json({ error: "Side bet not found" });
      return;
    }

    if (bet.status !== "open" || new Date(bet.closes_at).getTime() <= Date.now()) {
      res.status(409).json({ error: "This side bet is not open for entries" });
      return;
    }

    const option = (bet.options as BetOption[]).find((candidate) => candidate.id === parsed.data.optionId);
    if (!option) {
      res.status(400).json({ error: "Invalid option" });
      return;
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("credits_balance")
      .eq("id", user.id)
      .single();
    if (profileError || !profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    const buyIn = Number(bet.buy_in_credits);
    if (Number(profile.credits_balance) < buyIn) {
      res.status(402).json({ error: "Not enough credits" });
      return;
    }

    const { error: entryError } = await supabaseAdmin.from("bet_entries").insert({
      side_bet_id: bet.id,
      user_id: user.id,
      option_id: option.id,
      stake_credits: buyIn
    });

    if (entryError) {
      res.status(409).json({ error: entryError.message });
      return;
    }

    await supabaseAdmin
      .from("profiles")
      .update({ credits_balance: Number(profile.credits_balance) - buyIn })
      .eq("id", user.id);
    await supabaseAdmin.from("credit_transactions").insert({
      user_id: user.id,
      amount_credits: -buyIn,
      kind: "buy_in",
      description: `Buy-in for ${bet.title}`,
      side_bet_id: bet.id,
      created_by: user.id
    });

    await notifyBetChanged(bet.id);
    res.status(201).json({ ok: true });
  });

  router.post("/side-bets/:id/settle", requireAuth, async (req, res) => {
    const parsed = settleBetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const user = (req as AuthedRequest).user;
    const { data: bet, error: betError } = await supabaseAdmin.from("side_bets").select("*").eq("id", req.params.id).single();
    if (betError || !bet) {
      res.status(404).json({ error: "Side bet not found" });
      return;
    }

    if (bet.manager_id !== user.id && !user.isAdmin) {
      res.status(403).json({ error: "Only the manager or an admin can settle this side bet" });
      return;
    }

    const entriesResponse = await supabaseAdmin.from("bet_entries").select("*").eq("side_bet_id", bet.id);
    if (entriesResponse.error) {
      res.status(500).json({ error: entriesResponse.error.message });
      return;
    }

    const entries = entriesResponse.data;
    const winners = entries.filter((entry) => entry.option_id === parsed.data.winningOptionId);
    const pot = entries.reduce((total, entry) => total + Number(entry.stake_credits), 0);
    const fee = pot * (Number(bet.house_fee_percent) / 100);
    const payout = winners.length > 0 ? (pot - fee) / winners.length : 0;

    for (const winner of winners) {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("credits_balance")
        .eq("id", winner.user_id)
        .single();
      if (profile) {
        await supabaseAdmin
          .from("profiles")
          .update({ credits_balance: Number(profile.credits_balance) + payout })
          .eq("id", winner.user_id);
        await supabaseAdmin.from("credit_transactions").insert({
          user_id: winner.user_id,
          amount_credits: payout,
          kind: "payout",
          description: `Payout for ${bet.title}`,
          side_bet_id: bet.id,
          created_by: user.id
        });
      }
    }

    const { error: updateError } = await supabaseAdmin
      .from("side_bets")
      .update({
        status: "settled",
        winning_option_id: parsed.data.winningOptionId,
        settles_at: new Date().toISOString()
      })
      .eq("id", bet.id);

    if (updateError) {
      res.status(500).json({ error: updateError.message });
      return;
    }

    await notifyBetChanged(bet.id);
    res.json({ ok: true, winners: winners.length, payoutCredits: payout, feeCredits: fee });
  });

  router.post("/admin/side-bets/:id/rectify", requireAuth, requireAdmin, async (req, res) => {
    const parsed = rectifySettlementSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const admin = (req as AuthedRequest).user;
    const { data: bet, error: betError } = await supabaseAdmin.from("side_bets").select("*").eq("id", req.params.id).single();
    if (betError || !bet) {
      res.status(404).json({ error: "Side bet not found" });
      return;
    }

    if (bet.status !== "settled" || !bet.winning_option_id) {
      res.status(409).json({ error: "Only settled side bets can be rectified" });
      return;
    }

    const options = bet.options as BetOption[];
    const correctedOption = options.find((option) => option.id === parsed.data.winningOptionId);
    if (!correctedOption) {
      res.status(400).json({ error: "Invalid corrected winning option" });
      return;
    }

    if (bet.winning_option_id === parsed.data.winningOptionId) {
      res.status(409).json({ error: "This option is already marked as the winner" });
      return;
    }

    const entriesResponse = await supabaseAdmin.from("bet_entries").select("*").eq("side_bet_id", bet.id);
    if (entriesResponse.error) {
      res.status(500).json({ error: entriesResponse.error.message });
      return;
    }

    const entries = entriesResponse.data;
    const pot = entries.reduce((total, entry) => total + Number(entry.stake_credits), 0);
    const fee = pot * (Number(bet.house_fee_percent) / 100);
    const distributablePot = pot - fee;
    const previousWinners = entries.filter((entry) => entry.option_id === bet.winning_option_id);
    const correctedWinners = entries.filter((entry) => entry.option_id === parsed.data.winningOptionId);
    const previousPayout = previousWinners.length > 0 ? distributablePot / previousWinners.length : 0;
    const correctedPayout = correctedWinners.length > 0 ? distributablePot / correctedWinners.length : 0;
    const deltas = new Map<string, number>();

    for (const winner of previousWinners) {
      deltas.set(winner.user_id, (deltas.get(winner.user_id) ?? 0) - previousPayout);
    }

    for (const winner of correctedWinners) {
      deltas.set(winner.user_id, (deltas.get(winner.user_id) ?? 0) + correctedPayout);
    }

    const payableDeltas = [...deltas.entries()].filter(([, amount]) => Math.abs(amount) > 0.0001);
    const affectedUserIds = payableDeltas.map(([userId]) => userId);
    if (affectedUserIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabaseAdmin
        .from("profiles")
        .select("id, credits_balance")
        .in("id", affectedUserIds);

      if (profilesError || !profiles) {
        res.status(500).json({ error: profilesError?.message ?? "Could not load affected profiles" });
        return;
      }

      const balances = new Map(profiles.map((profile) => [profile.id, Number(profile.credits_balance)]));
      for (const [userId, delta] of payableDeltas) {
        const currentBalance = balances.get(userId);
        if (currentBalance === undefined) {
          res.status(404).json({ error: "Affected user profile not found" });
          return;
        }

        if (currentBalance + delta < 0) {
          res.status(409).json({
            error: "Cannot rectify automatically because a previous winner no longer has enough credits to reverse their payout"
          });
          return;
        }
      }

      for (const [userId, delta] of payableDeltas) {
        const nextBalance = (balances.get(userId) ?? 0) + delta;
        const { error: balanceError } = await supabaseAdmin.from("profiles").update({ credits_balance: nextBalance }).eq("id", userId);
        if (balanceError) {
          res.status(500).json({ error: balanceError.message });
          return;
        }

        const { error: transactionError } = await supabaseAdmin.from("credit_transactions").insert({
          user_id: userId,
          amount_credits: delta,
          kind: "adjustment",
          description: delta < 0 ? `Settlement rectification reversal for ${bet.title}` : `Settlement rectification payout for ${bet.title}`,
          side_bet_id: bet.id,
          created_by: admin.id
        });

        if (transactionError) {
          res.status(500).json({ error: transactionError.message });
          return;
        }
      }
    }

    const { error: updateError } = await supabaseAdmin
      .from("side_bets")
      .update({
        winning_option_id: parsed.data.winningOptionId,
        settles_at: new Date().toISOString()
      })
      .eq("id", bet.id);

    if (updateError) {
      res.status(500).json({ error: updateError.message });
      return;
    }

    await notifyBetChanged(bet.id);
    res.json({
      ok: true,
      previousWinnerCount: previousWinners.length,
      correctedWinnerCount: correctedWinners.length,
      previousPayoutCredits: previousPayout,
      correctedPayoutCredits: correctedPayout,
      feeCredits: fee
    });
  });

  router.get("/wallet/transactions", requireAuth, async (req, res) => {
    const user = (req as AuthedRequest).user;
    const { data, error } = await supabaseAdmin
      .from("credit_transactions")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json(data.map(mapTransaction));
  });

  router.get("/wallet/redemptions", requireAuth, async (req, res) => {
    const user = (req as AuthedRequest).user;
    const { data, error } = await supabaseAdmin
      .from("redemption_requests")
      .select("*, profiles!redemption_requests_user_id_fkey(display_name, email)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(25);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json(data.map(mapRedemptionRequest));
  });

  router.get("/wallet/credit-requests", requireAuth, async (req, res) => {
    const user = (req as AuthedRequest).user;
    const { data, error } = await supabaseAdmin
      .from("credit_requests")
      .select("*, profiles!credit_requests_user_id_fkey(display_name, email)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(25);

    if (error) {
      if (isMissingCreditRequestTable(error)) {
        res.json([]);
        return;
      }
      res.status(500).json({ error: error.message });
      return;
    }

    res.json(data.map(mapCreditRequest));
  });

  router.post("/wallet/redemptions", requireAuth, async (req, res) => {
    const parsed = createRedemptionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const user = (req as AuthedRequest).user;
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("credits_balance")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    const amount = parsed.data.amountCredits;
    const currentBalance = Number(profile.credits_balance);
    if (currentBalance < amount) {
      res.status(402).json({ error: "Not enough credits to redeem" });
      return;
    }

    const nextBalance = currentBalance - amount;
    const { error: balanceError } = await supabaseAdmin
      .from("profiles")
      .update({ credits_balance: nextBalance })
      .eq("id", user.id);

    if (balanceError) {
      res.status(500).json({ error: balanceError.message });
      return;
    }

    const { data: redemption, error: redemptionError } = await supabaseAdmin
      .from("redemption_requests")
      .insert({
        user_id: user.id,
        amount_credits: amount,
        claim_details: parsed.data.claimDetails
      })
      .select("*, profiles!redemption_requests_user_id_fkey(display_name, email)")
      .single();

    if (redemptionError) {
      await supabaseAdmin.from("profiles").update({ credits_balance: currentBalance }).eq("id", user.id);
      if (isMissingRedemptionTable(redemptionError)) {
        res.status(503).json({ error: "Redemption requests are not set up yet. Run supabase/migrations/0002_redemption_requests.sql." });
        return;
      }
      res.status(500).json({ error: redemptionError.message });
      return;
    }

    const { error: transactionError } = await supabaseAdmin.from("credit_transactions").insert({
      user_id: user.id,
      amount_credits: -amount,
      kind: "withdrawal",
      description: "Redemption request",
      created_by: user.id
    });

    if (transactionError) {
      res.status(500).json({ error: transactionError.message });
      return;
    }

    res.status(201).json(mapRedemptionRequest(redemption));
  });

  router.post("/wallet/credit-requests", requireAuth, async (req, res) => {
    const parsed = createCreditRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const user = (req as AuthedRequest).user;
    const { data, error } = await supabaseAdmin
      .from("credit_requests")
      .insert({
        user_id: user.id,
        amount_credits: parsed.data.amountCredits,
        request_reason: parsed.data.requestReason
      })
      .select("*, profiles!credit_requests_user_id_fkey(display_name, email)")
      .single();

    if (error) {
      if (isMissingCreditRequestTable(error)) {
        res.status(503).json({ error: "Credit requests are not set up yet. Run supabase/migrations/0003_credit_requests.sql." });
        return;
      }
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(201).json(mapCreditRequest(data));
  });

  router.get("/admin/summary", requireAuth, requireAdmin, async (_req, res) => {
    const [profiles, bets, openBets, transactions] = await Promise.all([
      supabaseAdmin.from("profiles").select("credits_balance", { count: "exact" }),
      supabaseAdmin.from("side_bets").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("side_bets").select("id", { count: "exact", head: true }).eq("status", "open"),
      supabaseAdmin.from("credit_transactions").select("id", { count: "exact", head: true })
    ]);

    const summary: AdminSummary = {
      totalUsers: profiles.count ?? profiles.data?.length ?? 0,
      totalBets: bets.count ?? 0,
      openBets: openBets.count ?? 0,
      totalCredits: (profiles.data ?? []).reduce((total, profile) => total + Number(profile.credits_balance), 0),
      totalTransactions: transactions.count ?? 0
    };

    res.json(summary);
  });

  router.get("/admin/users", requireAuth, requireAdmin, async (_req, res) => {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name, email, credits_balance")
      .order("display_name", { ascending: true });

    if (error) {
      if (isMissingRedemptionTable(error)) {
        res.json([]);
        return;
      }
      res.status(500).json({ error: error.message });
      return;
    }

    const users: AdminUser[] = data.map((profile) => ({
      id: profile.id,
      displayName: profile.display_name,
      email: profile.email,
      creditsBalance: Number(profile.credits_balance)
    }));

    res.json(users);
  });

  router.post("/admin/credits", requireAuth, requireAdmin, async (req, res) => {
    const parsed = adminCreditAdjustmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const admin = (req as AuthedRequest).user;
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("credits_balance")
      .eq("id", parsed.data.userId)
      .single();

    if (profileError || !profile) {
      res.status(404).json({ error: "User profile not found" });
      return;
    }

    const nextBalance = Number(profile.credits_balance) + parsed.data.amountCredits;
    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({ credits_balance: nextBalance })
      .eq("id", parsed.data.userId);

    if (updateError) {
      res.status(500).json({ error: updateError.message });
      return;
    }

    const { error: transactionError } = await supabaseAdmin.from("credit_transactions").insert({
      user_id: parsed.data.userId,
      amount_credits: parsed.data.amountCredits,
      kind: "adjustment",
      description: parsed.data.description,
      created_by: admin.id
    });

    if (transactionError) {
      res.status(500).json({ error: transactionError.message });
      return;
    }

    res.status(201).json({ ok: true, creditsBalance: nextBalance });
  });

  router.get("/admin/transactions", requireAuth, requireAdmin, async (_req, res) => {
    const { data, error } = await supabaseAdmin
      .from("credit_transactions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json(data.map(mapTransaction));
  });

  router.get("/admin/redemptions", requireAuth, requireAdmin, async (_req, res) => {
    const { data, error } = await supabaseAdmin
      .from("redemption_requests")
      .select("*, profiles!redemption_requests_user_id_fkey(display_name, email)")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json(data.map(mapRedemptionRequest));
  });

  router.get("/admin/credit-requests", requireAuth, requireAdmin, async (_req, res) => {
    const { data, error } = await supabaseAdmin
      .from("credit_requests")
      .select("*, profiles!credit_requests_user_id_fkey(display_name, email)")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      if (isMissingCreditRequestTable(error)) {
        res.json([]);
        return;
      }
      res.status(500).json({ error: error.message });
      return;
    }

    res.json(data.map(mapCreditRequest));
  });

  router.patch("/admin/redemptions/:id", requireAuth, requireAdmin, async (req, res) => {
    const parsed = updateRedemptionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const admin = (req as AuthedRequest).user;
    const { data: redemption, error: redemptionError } = await supabaseAdmin
      .from("redemption_requests")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (redemptionError || !redemption) {
      if (redemptionError && isMissingRedemptionTable(redemptionError)) {
        res.status(503).json({ error: "Redemption requests are not set up yet. Run supabase/migrations/0002_redemption_requests.sql." });
        return;
      }
      res.status(404).json({ error: "Redemption request not found" });
      return;
    }

    if (redemption.status !== "pending") {
      res.status(409).json({ error: "This redemption request has already been reviewed" });
      return;
    }

    if (parsed.data.status === "rejected") {
      const { data: profile, error: profileError } = await supabaseAdmin
        .from("profiles")
        .select("credits_balance")
        .eq("id", redemption.user_id)
        .single();

      if (profileError || !profile) {
        res.status(404).json({ error: "User profile not found" });
        return;
      }

      const refund = Number(redemption.amount_credits);
      const { error: refundError } = await supabaseAdmin
        .from("profiles")
        .update({ credits_balance: Number(profile.credits_balance) + refund })
        .eq("id", redemption.user_id);

      if (refundError) {
        res.status(500).json({ error: refundError.message });
        return;
      }

      await supabaseAdmin.from("credit_transactions").insert({
        user_id: redemption.user_id,
        amount_credits: refund,
        kind: "adjustment",
        description: "Rejected redemption refund",
        created_by: admin.id
      });
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("redemption_requests")
      .update({
        status: parsed.data.status,
        admin_note: parsed.data.adminNote ?? null,
        reviewed_by: admin.id,
        reviewed_at: new Date().toISOString()
      })
      .eq("id", redemption.id)
      .select("*, profiles!redemption_requests_user_id_fkey(display_name, email)")
      .single();

    if (updateError) {
      res.status(500).json({ error: updateError.message });
      return;
    }

    res.json(mapRedemptionRequest(updated));
  });

  router.patch("/admin/credit-requests/:id", requireAuth, requireAdmin, async (req, res) => {
    const parsed = updateCreditRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const admin = (req as AuthedRequest).user;
    const { data: creditRequest, error: requestError } = await supabaseAdmin
      .from("credit_requests")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (requestError || !creditRequest) {
      if (requestError && isMissingCreditRequestTable(requestError)) {
        res.status(503).json({ error: "Credit requests are not set up yet. Run supabase/migrations/0003_credit_requests.sql." });
        return;
      }
      res.status(404).json({ error: "Credit request not found" });
      return;
    }

    if (creditRequest.status !== "pending") {
      res.status(409).json({ error: "This credit request has already been reviewed" });
      return;
    }

    if (parsed.data.status === "approved") {
      const { data: profile, error: profileError } = await supabaseAdmin
        .from("profiles")
        .select("credits_balance")
        .eq("id", creditRequest.user_id)
        .single();

      if (profileError || !profile) {
        res.status(404).json({ error: "User profile not found" });
        return;
      }

      const amount = Number(creditRequest.amount_credits);
      const { error: balanceError } = await supabaseAdmin
        .from("profiles")
        .update({ credits_balance: Number(profile.credits_balance) + amount })
        .eq("id", creditRequest.user_id);

      if (balanceError) {
        res.status(500).json({ error: balanceError.message });
        return;
      }

      const { error: transactionError } = await supabaseAdmin.from("credit_transactions").insert({
        user_id: creditRequest.user_id,
        amount_credits: amount,
        kind: "adjustment",
        description: "Approved credit request",
        created_by: admin.id
      });

      if (transactionError) {
        res.status(500).json({ error: transactionError.message });
        return;
      }
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("credit_requests")
      .update({
        status: parsed.data.status,
        admin_note: parsed.data.adminNote ?? null,
        reviewed_by: admin.id,
        reviewed_at: new Date().toISOString()
      })
      .eq("id", creditRequest.id)
      .select("*, profiles!credit_requests_user_id_fkey(display_name, email)")
      .single();

    if (updateError) {
      res.status(500).json({ error: updateError.message });
      return;
    }

    res.json(mapCreditRequest(updated));
  });

  return router;
}

function mapRedemptionRequest(row: {
  id: string;
  user_id: string;
  amount_credits: string | number;
  status: RedemptionStatus;
  claim_details: string;
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  profiles?: { display_name: string; email: string | null } | null;
}): RedemptionRequest {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.profiles?.display_name ?? "Unknown user",
    userEmail: row.profiles?.email ?? null,
    amountCredits: Number(row.amount_credits),
    status: row.status,
    claimDetails: row.claim_details,
    adminNote: row.admin_note,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at
  };
}

function mapCreditRequest(row: {
  id: string;
  user_id: string;
  amount_credits: string | number;
  status: CreditRequestStatus;
  request_reason: string;
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  profiles?: { display_name: string; email: string | null } | null;
}): CreditRequest {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.profiles?.display_name ?? "Unknown user",
    userEmail: row.profiles?.email ?? null,
    amountCredits: Number(row.amount_credits),
    status: row.status,
    requestReason: row.request_reason,
    adminNote: row.admin_note,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at
  };
}

function isMissingRedemptionTable(error: { code?: string; message?: string }) {
  return (
    error.code === "42P01" ||
    error.message?.includes("redemption_requests") ||
    error.message?.includes("schema cache") ||
    false
  );
}

function isMissingCreditRequestTable(error: { code?: string; message?: string }) {
  return (
    error.code === "42P01" ||
    error.message?.includes("credit_requests") ||
    error.message?.includes("schema cache") ||
    false
  );
}

function mapTransaction(row: {
  id: string;
  user_id: string;
  amount_credits: string | number;
  kind: CreditTransaction["kind"];
  description: string;
  side_bet_id: string | null;
  created_at: string;
}): CreditTransaction {
  return {
    id: row.id,
    userId: row.user_id,
    amountCredits: Number(row.amount_credits),
    kind: row.kind,
    description: row.description,
    sideBetId: row.side_bet_id,
    createdAt: row.created_at
  };
}
