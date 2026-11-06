import { supabaseAdmin } from "../supabase.js";
import { invalidateCache } from "../memoryCache.js";
import { awardExperience, xpForBlackjackHand } from "../xp.js";

export async function recordBlackjackResults(
  table: { groupId: string; mode: "live" | "practice" },
  results: Array<{ userId: string; outcome: string }>
) {
  if (results.length === 0) return;
  const { error } = await supabaseAdmin.from("blackjack_round_results").insert(
    results.map((result) => ({
      user_id: result.userId,
      group_id: table.groupId,
      mode: table.mode,
      outcome: result.outcome
    }))
  );
  if (error) {
    console.error("Could not save blackjack results:", error.message);
    return;
  }
  invalidateCache("blackjack-leaderboard");
  for (const result of results) {
    const amount = xpForBlackjackHand(result.outcome, table.mode);
    await awardExperience(
      result.userId,
      amount,
      `Blackjack ${table.mode} ${result.outcome}`
    );
  }
}
