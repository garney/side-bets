export type BetStatus = "draft" | "open" | "locked" | "settled" | "cancelled";

export type BetOption = {
  id: string;
  label: string;
};

export type Profile = {
  id: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  creditsBalance: number;
  isAdmin: boolean;
};

export type SideBet = {
  id: string;
  title: string;
  description: string;
  sourceUrl: string | null;
  buyInCredits: number;
  houseFeePercent: number;
  status: BetStatus;
  startsAt: string;
  closesAt: string;
  settlesAt: string | null;
  managerId: string;
  managerName: string;
  participantCount: number;
  potCredits: number;
  options: BetOption[];
  winningOptionId: string | null;
  createdAt: string;
};

export type BetEntry = {
  id: string;
  sideBetId: string;
  userId: string;
  optionId: string;
  optionLabel: string;
  stakeCredits: number;
  createdAt: string;
};

export type CreditTransaction = {
  id: string;
  userId: string;
  amountCredits: number;
  kind: "deposit" | "withdrawal" | "adjustment" | "buy_in" | "payout" | "fee";
  description: string;
  sideBetId: string | null;
  createdAt: string;
};

export type RedemptionStatus = "pending" | "approved" | "rejected";

export type RedemptionRequest = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string | null;
  amountCredits: number;
  status: RedemptionStatus;
  claimDetails: string;
  adminNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

export type AdminSummary = {
  totalUsers: number;
  totalBets: number;
  openBets: number;
  totalCredits: number;
  totalTransactions: number;
};

export type AdminUser = {
  id: string;
  displayName: string;
  email: string | null;
  creditsBalance: number;
};
