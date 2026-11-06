import { supabaseAdmin } from "./supabase.js";

export function xpForBlackjackHand(outcome: string, mode: "live" | "practice") {
  const base =
    outcome === "blackjack" ? 70 : outcome === "win" ? 40 : outcome === "push" ? 15 : 10;
  return base * (mode === "live" ? 2 : 1);
}

export async function awardExperience(userId: string, amount: number, reason: string) {
  if (amount <= 0) return 0;
  const { data, error } = await supabaseAdmin.rpc("add_experience", {
    p_user_id: userId,
    p_amount: amount
  });
  if (error) {
    console.error("Could not award experience:", error.message);
    return 0;
  }
  const { error: eventError } = await supabaseAdmin.from("xp_events").insert({
    user_id: userId,
    amount,
    reason
  });
  if (eventError) {
    console.error("Could not record experience event:", eventError.message);
  }
  return Number(data ?? 0);
}
