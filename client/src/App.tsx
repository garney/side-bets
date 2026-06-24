import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Bell, CheckCircle2, CircleDollarSign, LogOut, Plus, Search, ShieldCheck, Trophy, UserCircle2 } from "lucide-react";
import { io, type Socket } from "socket.io-client";
import type { AdminSummary, AdminUser, CreditTransaction, Profile, RedemptionRequest, SideBet } from "../../shared/types";
import { api } from "./api";
import { supabase } from "./supabase";

type SessionState = "loading" | "signed-out" | "signed-in";

const defaultForm = {
  title: "Max temperature in Sydney tomorrow",
  description: "What will the maximum temperature in Sydney be tomorrow based on the BOM website?",
  sourceUrl: "https://www.bom.gov.au/nsw/forecasts/sydney.shtml",
  buyInCredits: 1,
  closesAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16),
  options: "Under 22\n22 to 25\nOver 25"
};

export function App() {
  const [sessionState, setSessionState] = useState<SessionState>("loading");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sideBets, setSideBets] = useState<SideBet[]>([]);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [redemptions, setRedemptions] = useState<RedemptionRequest[]>([]);
  const [adminSummary, setAdminSummary] = useState<AdminSummary | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminTransactions, setAdminTransactions] = useState<CreditTransaction[]>([]);
  const [adminRedemptions, setAdminRedemptions] = useState<RedemptionRequest[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [form, setForm] = useState(defaultForm);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const activeBets = useMemo(() => sideBets.filter((bet) => bet.status === "open").length, [sideBets]);

  const refreshData = useCallback(async () => {
    const [me, bets, wallet, walletRedemptions] = await Promise.all([
      api.me(),
      api.sideBets(search, status),
      api.transactions(),
      api.redemptions()
    ]);
    setProfile(me);
    setSideBets(bets);
    setTransactions(wallet);
    setRedemptions(walletRedemptions);

    if (me.isAdmin) {
      const [summary, users, adminTx, redemptionQueue] = await Promise.all([
        api.adminSummary(),
        api.adminUsers(),
        api.adminTransactions(),
        api.adminRedemptions()
      ]);
      setAdminSummary(summary);
      setAdminUsers(users);
      setAdminTransactions(adminTx);
      setAdminRedemptions(redemptionQueue);
    }
  }, [search, status]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSessionState(data.session ? "signed-in" : "signed-out");
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionState(session ? "signed-in" : "signed-out");
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (sessionState !== "signed-in") return;
    refreshData().catch((error) => setMessage(error.message));
  }, [sessionState, refreshData]);

  useEffect(() => {
    let socket: Socket | null = null;

    async function connectSocket() {
      const { data } = await supabase.auth.getSession();
      if (!data.session?.access_token) return;

      socket = io("/", { auth: { token: data.session.access_token } });
      socket.on("side-bet:changed", () => {
        refreshData().catch((error) => setMessage(error.message));
      });
    }

    if (sessionState === "signed-in") {
      connectSocket();
    }

    return () => {
      socket?.disconnect();
    };
  }, [sessionState, refreshData]);

  async function signIn() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin }
    });
  }

  async function signOut() {
    await supabase.auth.signOut();
    setProfile(null);
    setSideBets([]);
    setTransactions([]);
    setRedemptions([]);
    setAdminSummary(null);
    setAdminUsers([]);
    setAdminRedemptions([]);
    setSessionState("signed-out");
  }

  async function withAction(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      await refreshData();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function createBet(event: FormEvent) {
    event.preventDefault();
    await withAction(async () => {
      const now = new Date();
      await api.createSideBet({
        title: form.title,
        description: form.description,
        sourceUrl: form.sourceUrl || null,
        buyInCredits: Number(form.buyInCredits),
        houseFeePercent: 0,
        startsAt: now.toISOString(),
        closesAt: new Date(form.closesAt).toISOString(),
        options: form.options
          .split("\n")
          .map((option) => option.trim())
          .filter(Boolean)
      });
    }, "Side bet created");
  }

  if (sessionState === "loading") {
    return <main className="center-screen">Loading Side Bets...</main>;
  }

  if (sessionState === "signed-out") {
    return (
      <main className="auth-screen">
        <section className="auth-panel">
          <img className="auth-logo" src="/assets/sidebets.png" alt="SideBets" />
          <h1 className="sr-only">Side Bets</h1>
          <p>Create trusted prediction pools, buy in with credits, and settle results when the outcome is known.</p>
          <button className="primary-button" onClick={signIn}>
            <UserCircle2 size={18} />
            Continue with Google
          </button>
          <span className="setup-note">Google SSO is handled by Supabase Auth.</span>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand-row">
            <img className="brand-logo" src="/assets/sidebets.png" alt="SideBets" />
          </div>
          <span className="muted">Single-port app: web, API, and sockets together.</span>
        </div>
        <div className="topbar-actions">
          <span className="balance">
            <CircleDollarSign size={17} />
            {profile?.creditsBalance.toFixed(2) ?? "0.00"} credits
          </span>
          {profile?.isAdmin ? (
            <span className="admin-pill">
              <ShieldCheck size={15} />
              Admin
            </span>
          ) : null}
          <button className="icon-button" onClick={signOut} aria-label="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {message ? <div className="toast">{message}</div> : null}

      <section className="metrics">
        <Metric icon={<Bell size={18} />} label="Open bets" value={activeBets.toString()} />
        <Metric icon={<Trophy size={18} />} label="Total bets" value={sideBets.length.toString()} />
        <Metric icon={<CircleDollarSign size={18} />} label="Wallet" value={`${profile?.creditsBalance.toFixed(2) ?? "0.00"} cr`} />
        <Metric icon={<CheckCircle2 size={18} />} label="Fee" value="0%" />
      </section>

      <section className="workspace">
        <aside className="filters">
          <label className="search-box">
            <Search size={17} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search side bets" />
          </label>
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">All</option>
              <option value="open">Open</option>
              <option value="settled">Settled</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <p className="muted">Credits are added by admins from the admin centre.</p>
        </aside>

        <section className="bet-list" aria-label="Side bets">
          <div className="section-heading">
            <h2>All Side Bets</h2>
            <span>{sideBets.length} visible</span>
          </div>
          <div className="table">
            <div className="table-row table-head">
              <span>Bet</span>
              <span>Buy-in</span>
              <span>Pot</span>
              <span>Closes</span>
              <span>Action</span>
            </div>
            {sideBets.map((bet) => (
              <article className="table-row" key={bet.id}>
                <div>
                  <strong>{bet.title}</strong>
                  <p>{bet.description}</p>
                  <span className="muted">Manager: {bet.managerName}</span>
                </div>
                <span>{bet.buyInCredits} cr</span>
                <span>{bet.potCredits.toFixed(2)} cr</span>
                <span>{new Date(bet.closesAt).toLocaleString()}</span>
                <BetActions bet={bet} busy={busy} onAction={withAction} canSettle={profile?.id === bet.managerId || Boolean(profile?.isAdmin)} />
              </article>
            ))}
            {sideBets.length === 0 ? <div className="empty-state">No side bets match this view.</div> : null}
          </div>
        </section>

        <aside className="create-panel">
          <form onSubmit={createBet}>
            <div className="section-heading">
              <h2>Create</h2>
              <Plus size={18} />
            </div>
            <label>
              Title
              <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
            </label>
            <label>
              What is the bet about?
              <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
            </label>
            <label>
              Source URL
              <input value={form.sourceUrl} onChange={(event) => setForm({ ...form, sourceUrl: event.target.value })} />
            </label>
            <div className="split-fields">
              <label>
                Buy-in
                <input
                  type="number"
                  min="1"
                  value={form.buyInCredits}
                  onChange={(event) => setForm({ ...form, buyInCredits: Number(event.target.value) })}
                />
              </label>
              <label>
                Closes
                <input type="datetime-local" value={form.closesAt} onChange={(event) => setForm({ ...form, closesAt: event.target.value })} />
              </label>
            </div>
            <label>
              Options
              <textarea value={form.options} onChange={(event) => setForm({ ...form, options: event.target.value })} />
            </label>
            <button className="primary-button" disabled={busy}>
              Create side bet
            </button>
          </form>

          <Wallet transactions={transactions} redemptions={redemptions} busy={busy} onAction={withAction} />
        </aside>
      </section>

      {profile?.isAdmin ? (
        <AdminCentre
          summary={adminSummary}
          users={adminUsers}
          transactions={adminTransactions}
          redemptions={adminRedemptions}
          busy={busy}
          onAction={withAction}
        />
      ) : null}
    </main>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BetActions({
  bet,
  busy,
  canSettle,
  onAction
}: {
  bet: SideBet;
  busy: boolean;
  canSettle: boolean;
  onAction: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [optionId, setOptionId] = useState(bet.options[0]?.id ?? "");

  if (bet.status === "settled") {
    const winner = bet.options.find((option) => option.id === bet.winningOptionId);
    return <span className="status settled">{winner?.label ?? "Settled"}</span>;
  }

  return (
    <div className="row-actions">
      <select value={optionId} onChange={(event) => setOptionId(event.target.value)}>
        {bet.options.map((option) => (
          <option value={option.id} key={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <button disabled={busy || bet.status !== "open"} onClick={() => onAction(() => api.joinSideBet(bet.id, optionId), "Joined side bet")}>
        Join
      </button>
      {canSettle ? (
        <button className="text-button" disabled={busy} onClick={() => onAction(() => api.settleSideBet(bet.id, optionId), "Side bet settled")}>
          Settle
        </button>
      ) : null}
    </div>
  );
}

function Wallet({
  transactions,
  redemptions,
  busy,
  onAction
}: {
  transactions: CreditTransaction[];
  redemptions: RedemptionRequest[];
  busy: boolean;
  onAction: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [redeemAmount, setRedeemAmount] = useState(1);
  const [claimDetails, setClaimDetails] = useState("");

  async function requestRedemption(event: FormEvent) {
    event.preventDefault();
    await onAction(
      () =>
        api.createRedemption({
          amountCredits: Number(redeemAmount),
          claimDetails
        }),
      "Redemption requested"
    );
    setClaimDetails("");
  }

  return (
    <section className="wallet">
      <div className="section-heading">
        <h2>Wallet</h2>
        <span>Latest</span>
      </div>
      <form className="redemption-form" onSubmit={requestRedemption}>
        <div className="section-heading">
          <h2>Redeem Credits</h2>
          <span>Admin reviewed</span>
        </div>
        <label>
          Credits to redeem
          <input min="1" max="10000" type="number" value={redeemAmount} onChange={(event) => setRedeemAmount(Number(event.target.value))} />
        </label>
        <label>
          Claim details
          <textarea
            value={claimDetails}
            onChange={(event) => setClaimDetails(event.target.value)}
            placeholder="How should an admin settle this redemption?"
          />
        </label>
        <button className="primary-button" disabled={busy || !claimDetails.trim()}>
          Request redemption
        </button>
      </form>
      {redemptions.slice(0, 3).map((redemption) => (
        <div className="transaction" key={redemption.id}>
          <span>Redeem {redemption.status}</span>
          <strong>{redemption.amountCredits.toFixed(2)} cr</strong>
        </div>
      ))}
      {transactions.slice(0, 5).map((transaction) => (
        <div className="transaction" key={transaction.id}>
          <span>{transaction.description}</span>
          <strong className={transaction.amountCredits >= 0 ? "positive" : "negative"}>{transaction.amountCredits.toFixed(2)} cr</strong>
        </div>
      ))}
      {transactions.length === 0 ? <p className="muted">No credit transactions yet.</p> : null}
    </section>
  );
}

function AdminCentre({
  summary,
  users,
  transactions,
  redemptions,
  busy,
  onAction
}: {
  summary: AdminSummary | null;
  users: AdminUser[];
  transactions: CreditTransaction[];
  redemptions: RedemptionRequest[];
  busy: boolean;
  onAction: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [creditUserId, setCreditUserId] = useState("");
  const [creditAmount, setCreditAmount] = useState(10);
  const [creditDescription, setCreditDescription] = useState("Admin credit top-up");
  const selectedUserId = creditUserId || users[0]?.id || "";

  async function addCredits(event: FormEvent) {
    event.preventDefault();
    if (!selectedUserId) return;

    await onAction(
      () =>
        api.adminAddCredits({
          userId: selectedUserId,
          amountCredits: Number(creditAmount),
          description: creditDescription
        }),
      "Credits added"
    );
  }

  async function reviewRedemption(id: string, status: "approved" | "rejected") {
    await onAction(() => api.adminReviewRedemption(id, { status }), status === "approved" ? "Redemption approved" : "Redemption rejected");
  }

  return (
    <section className="admin-centre">
      <div className="section-heading">
        <h2>Admin Centre</h2>
        <span>Transactions and platform view</span>
      </div>
      <div className="admin-grid">
        <Metric icon={<UserCircle2 size={18} />} label="Users" value={String(summary?.totalUsers ?? 0)} />
        <Metric icon={<Trophy size={18} />} label="Open bets" value={String(summary?.openBets ?? 0)} />
        <Metric icon={<CircleDollarSign size={18} />} label="Credits" value={`${summary?.totalCredits.toFixed(2) ?? "0.00"} cr`} />
      </div>
      <form className="credit-adjustment" onSubmit={addCredits}>
        <div className="section-heading">
          <h2>Add Credits</h2>
          <span>Admin only</span>
        </div>
        <label>
          User
          <select value={selectedUserId} onChange={(event) => setCreditUserId(event.target.value)}>
            {users.map((user) => (
              <option value={user.id} key={user.id}>
                {user.displayName} {user.email ? `(${user.email})` : ""} - {user.creditsBalance.toFixed(2)} cr
              </option>
            ))}
          </select>
        </label>
        <div className="split-fields">
          <label>
            Credits
            <input min="1" max="10000" type="number" value={creditAmount} onChange={(event) => setCreditAmount(Number(event.target.value))} />
          </label>
          <label>
            Reason
            <input value={creditDescription} onChange={(event) => setCreditDescription(event.target.value)} />
          </label>
        </div>
        <button className="primary-button" disabled={busy || !selectedUserId}>
          Add credits
        </button>
      </form>
      <section className="redemption-queue">
        <div className="section-heading">
          <h2>Redemptions</h2>
          <span>{redemptions.filter((redemption) => redemption.status === "pending").length} pending</span>
        </div>
        {redemptions.slice(0, 8).map((redemption) => (
          <article className="redemption-item" key={redemption.id}>
            <div>
              <strong>
                {redemption.userName} wants {redemption.amountCredits.toFixed(2)} cr
              </strong>
              <p>{redemption.claimDetails}</p>
              <span className={`status ${redemption.status}`}>{redemption.status}</span>
            </div>
            {redemption.status === "pending" ? (
              <div className="row-actions">
                <button disabled={busy} onClick={() => reviewRedemption(redemption.id, "approved")}>
                  Approve
                </button>
                <button className="text-button danger" disabled={busy} onClick={() => reviewRedemption(redemption.id, "rejected")}>
                  Reject
                </button>
              </div>
            ) : null}
          </article>
        ))}
        {redemptions.length === 0 ? <p className="muted">No redemption requests yet.</p> : null}
      </section>
      <div className="admin-table">
        {transactions.slice(0, 8).map((transaction) => (
          <div className="transaction" key={transaction.id}>
            <span>{transaction.kind}: {transaction.description}</span>
            <strong>{transaction.amountCredits.toFixed(2)} cr</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
