import type { BetEntry, BetOption, SideBet, SideBetDetail } from "../shared/types.js";

type SideBetRow = {
  id: string;
  title: string;
  description: string;
  source_url: string | null;
  buy_in_credits: string | number;
  house_fee_percent: string | number;
  status: SideBet["status"];
  starts_at: string;
  closes_at: string;
  settles_at: string | null;
  manager_id: string;
  winning_option_id: string | null;
  created_at: string;
  options: BetOption[];
  profiles?: { display_name: string } | null;
  bet_entries?: { id: string; stake_credits: string | number }[];
};

type BetEntryRow = {
  id: string;
  side_bet_id: string;
  user_id: string;
  option_id: string;
  stake_credits: string | number;
  created_at: string;
  profiles?: { display_name: string; email: string | null } | null;
};

export function mapSideBet(row: SideBetRow): SideBet {
  const entries = row.bet_entries ?? [];
  const buyInCredits = Number(row.buy_in_credits);

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    sourceUrl: row.source_url,
    buyInCredits,
    houseFeePercent: Number(row.house_fee_percent),
    status: row.status,
    startsAt: row.starts_at,
    closesAt: row.closes_at,
    settlesAt: row.settles_at,
    managerId: row.manager_id,
    managerName: row.profiles?.display_name ?? "Unknown manager",
    participantCount: entries.length,
    potCredits: entries.reduce((total, entry) => total + Number(entry.stake_credits), 0),
    options: row.options,
    winningOptionId: row.winning_option_id,
    createdAt: row.created_at
  };
}

export function mapSideBetDetail(row: Omit<SideBetRow, "bet_entries"> & { bet_entries?: BetEntryRow[] }): SideBetDetail {
  const bet = mapSideBet(row);
  const optionLabels = new Map(bet.options.map((option) => [option.id, option.label]));

  return {
    ...bet,
    entries: (row.bet_entries ?? []).map((entry) => mapBetEntry(entry, optionLabels))
  };
}

function mapBetEntry(entry: BetEntryRow, optionLabels: Map<string, string>): BetEntry {
  return {
    id: entry.id,
    sideBetId: entry.side_bet_id,
    userId: entry.user_id,
    userName: entry.profiles?.display_name ?? "Unknown user",
    userEmail: entry.profiles?.email ?? null,
    optionId: entry.option_id,
    optionLabel: optionLabels.get(entry.option_id) ?? "Unknown option",
    stakeCredits: Number(entry.stake_credits),
    createdAt: entry.created_at
  };
}
