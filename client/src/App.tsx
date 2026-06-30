import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Bell, CheckCircle2, CircleDollarSign, LogOut, Plus, Search, ShieldCheck, Trophy, UserCircle2, X } from "lucide-react";
import { io, type Socket } from "socket.io-client";
import type { AdminSummary, AdminUser, CreditRequest, CreditTransaction, Profile, RedemptionRequest, SideBet, SideBetDetail } from "../../shared/types";
import { api } from "./api";
import { supabase } from "./supabase";

type SessionState = "loading" | "signed-out" | "signed-in";
type AppView = "side-bets" | "admin";

const defaultForm = {
  title: "Will volume exceed _M Yen on _ _",
  description: "Will volume exceed _M Yen on Tuesday _\nSide Bet closes 11:30 am _\nwill be settled 10 am the next day",
  sourceUrl: "https://mission-control-client.astro.space/login",
  buyInCredits: "",
  closesDate: "",
  closesTime: "11:30",
  options: "No\nYES"
};

export function App() {
  const [sessionState, setSessionState] = useState<SessionState>("loading");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sideBets, setSideBets] = useState<SideBet[]>([]);
  const [selectedSideBetId, setSelectedSideBetId] = useState<string | null>(null);
  const [selectedSideBet, setSelectedSideBet] = useState<SideBetDetail | null>(null);
  const [selectedSideBetLoading, setSelectedSideBetLoading] = useState(false);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [redemptions, setRedemptions] = useState<RedemptionRequest[]>([]);
  const [creditRequests, setCreditRequests] = useState<CreditRequest[]>([]);
  const [adminSummary, setAdminSummary] = useState<AdminSummary | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminTransactions, setAdminTransactions] = useState<CreditTransaction[]>([]);
  const [adminRedemptions, setAdminRedemptions] = useState<RedemptionRequest[]>([]);
  const [adminCreditRequests, setAdminCreditRequests] = useState<CreditRequest[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("open");
  const [form, setForm] = useState(defaultForm);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [view, setView] = useState<AppView>("side-bets");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const activeBets = useMemo(() => sideBets.filter((bet) => bet.status === "open").length, [sideBets]);

  const refreshData = useCallback(async () => {
    const [me, bets, wallet, walletRedemptions, walletCreditRequests] = await Promise.all([
      api.me(),
      api.sideBets(search, status),
      api.transactions(),
      api.redemptions(),
      api.creditRequests()
    ]);
    setProfile(me);
    setSideBets(bets);
    setTransactions(wallet);
    setRedemptions(walletRedemptions);
    setCreditRequests(walletCreditRequests);
    if (selectedSideBetId) {
      setSelectedSideBet(await api.sideBet(selectedSideBetId));
    }

    if (me.isAdmin) {
      const [summary, users, adminTx, redemptionQueue, creditRequestQueue] = await Promise.all([
        api.adminSummary(),
        api.adminUsers(),
        api.adminTransactions(),
        api.adminRedemptions(),
        api.adminCreditRequests()
      ]);
      setAdminSummary(summary);
      setAdminUsers(users);
      setAdminTransactions(adminTx);
      setAdminRedemptions(redemptionQueue);
      setAdminCreditRequests(creditRequestQueue);
    }
  }, [search, selectedSideBetId, status]);

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
    if (profile && !profile.isAdmin && view === "admin") {
      setView("side-bets");
    }
  }, [profile, view]);

  useEffect(() => {
    if (!selectedSideBetId && !createModalOpen) return;

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        if (selectedSideBetId) {
          setSelectedSideBetId(null);
          setSelectedSideBet(null);
          setSelectedSideBetLoading(false);
        }
        setCreateModalOpen(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [createModalOpen, selectedSideBetId]);

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
    setSelectedSideBetId(null);
    setSelectedSideBet(null);
    setTransactions([]);
    setRedemptions([]);
    setCreditRequests([]);
    setAdminSummary(null);
    setAdminUsers([]);
    setAdminRedemptions([]);
    setAdminCreditRequests([]);
    setView("side-bets");
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

  async function focusSideBet(id: string) {
    setSelectedSideBetId(id);
    setSelectedSideBetLoading(true);
    setMessage("");
    try {
      setSelectedSideBet(await api.sideBet(id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load side bet");
    } finally {
      setSelectedSideBetLoading(false);
    }
  }

  function closeSideBetModal() {
    setSelectedSideBetId(null);
    setSelectedSideBet(null);
    setSelectedSideBetLoading(false);
  }

  async function createBet(event: FormEvent) {
    event.preventDefault();
    await withAction(async () => {
      if (!form.buyInCredits || !form.closesDate || !form.closesTime) {
        throw new Error("Add a buy-in amount, close date, and close time before creating the side bet");
      }

      const now = new Date();
      const closesAt = new Date(`${form.closesDate}T${form.closesTime}`);
      if (Number.isNaN(closesAt.getTime())) {
        throw new Error("Close date or time is invalid");
      }

      await api.createSideBet({
        title: form.title,
        description: form.description,
        sourceUrl: form.sourceUrl || null,
        buyInCredits: Number(form.buyInCredits),
        houseFeePercent: 0,
        startsAt: now.toISOString(),
        closesAt: closesAt.toISOString(),
        options: form.options
          .split("\n")
          .map((option) => option.trim())
          .filter(Boolean)
      });
      setCreateModalOpen(false);
    }, "Side bet created");
  }

  if (sessionState === "loading") {
    return <main className="center-screen">Loading SideBet...</main>;
  }

  if (sessionState === "signed-out") {
    return (
      <main className="auth-screen">
        <section className="auth-panel">
          <img className="auth-logo" src="/assets/sidebets.png" alt="SideBet" />
          <h1 className="sr-only">SideBet</h1>
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
            <img className="brand-logo" src="/assets/sidebets.png" alt="SideBet" />
          </div>
          {/* <span className="muted">Single-port app: web, API, and sockets together.</span> */}
        </div>
        <div className="topbar-actions">
          {profile?.isAdmin ? (
            <div className="view-switch" aria-label="View switcher">
              <button className={view === "side-bets" ? "active" : ""} type="button" onClick={() => setView("side-bets")}>
                Side bets
              </button>
              <button className={view === "admin" ? "active" : ""} type="button" onClick={() => setView("admin")}>
                <ShieldCheck size={15} />
                Admin
              </button>
            </div>
          ) : null}
          <span className="balance">
            <CircleDollarSign size={17} />
            {profile?.creditsBalance.toFixed(2) ?? "0.00"} credits
          </span>
          <button className="icon-button" onClick={signOut} aria-label="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {message ? <div className="toast">{message}</div> : null}

      {view === "side-bets" ? (
        <>
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

            <div className="main-column">
              <section className="bet-list" aria-label="Side bets">
                <div className="section-heading">
                  <h2>{status === "all" ? "All Side Bets" : `${status[0].toUpperCase()}${status.slice(1)} Side Bets`}</h2>
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
                    <article className={`table-row ${selectedSideBetId === bet.id ? "selected" : ""}`} key={bet.id}>
                      <div>
                        <div className="bet-title-row">
                          <strong>{bet.title}</strong>
                          <button className="text-button" type="button" onClick={() => focusSideBet(bet.id)}>
                            View
                          </button>
                        </div>
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
            </div>

            <aside className="create-panel">
              <section className="create-entry">
                <div className="section-heading">
                  <h2>Create</h2>
                  <Plus size={18} />
                </div>
                <button className="primary-button" type="button" onClick={() => setCreateModalOpen(true)}>
                  Create side bet
                </button>
              </section>

              <Wallet transactions={transactions} redemptions={redemptions} creditRequests={creditRequests} busy={busy} onAction={withAction} />
            </aside>
          </section>
          {createModalOpen ? (
            <CreateSideBetModal form={form} busy={busy} onClose={() => setCreateModalOpen(false)} onSubmit={createBet} onChange={setForm} />
          ) : null}
          {selectedSideBetId ? (
            <SideBetModal
              bet={selectedSideBet}
              loading={selectedSideBetLoading}
              busy={busy}
              onClose={closeSideBetModal}
              onAction={withAction}
              canSettle={profile?.id === selectedSideBet?.managerId || Boolean(profile?.isAdmin)}
              canEdit={profile?.id === selectedSideBet?.managerId}
              canRectify={Boolean(profile?.isAdmin)}
            />
          ) : null}
        </>
      ) : profile?.isAdmin ? (
        <AdminCentre
          summary={adminSummary}
          users={adminUsers}
          transactions={adminTransactions}
          redemptions={adminRedemptions}
          creditRequests={adminCreditRequests}
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

function CreateSideBetModal({
  form,
  busy,
  onClose,
  onSubmit,
  onChange
}: {
  form: typeof defaultForm;
  busy: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent) => Promise<void>;
  onChange: (form: typeof defaultForm) => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal-panel" role="dialog" aria-modal="true" aria-label="Create side bet" onClick={(event) => event.stopPropagation()}>
        <button className="icon-button modal-close" type="button" onClick={onClose} aria-label="Close create side bet">
          <X size={18} />
        </button>
        <form className="side-bet-create-form" onSubmit={onSubmit}>
          <div className="section-heading">
            <h2>Create Side Bet</h2>
            <span>Draft details</span>
          </div>
          <label>
            Title
            <input value={form.title} onChange={(event) => onChange({ ...form, title: event.target.value })} />
          </label>
          <label>
            What is the bet about?
            <textarea value={form.description} onChange={(event) => onChange({ ...form, description: event.target.value })} />
          </label>
          <label>
            Source URL
            <input value={form.sourceUrl} onChange={(event) => onChange({ ...form, sourceUrl: event.target.value })} />
          </label>
          <div className="split-fields">
            <label>
              Buy-in
              <input
                type="number"
                min="1"
                value={form.buyInCredits}
                onChange={(event) => onChange({ ...form, buyInCredits: event.target.value })}
                placeholder="Credits"
              />
            </label>
            <label>
              Close date
              <input type="date" value={form.closesDate} onChange={(event) => onChange({ ...form, closesDate: event.target.value })} />
            </label>
          </div>
          <label>
            Close time
            <input type="time" value={form.closesTime} onChange={(event) => onChange({ ...form, closesTime: event.target.value })} />
          </label>
          <label>
            Options
            <textarea value={form.options} onChange={(event) => onChange({ ...form, options: event.target.value })} />
          </label>
          <button className="primary-button" disabled={busy || !form.buyInCredits || !form.closesDate || !form.closesTime}>
            Create side bet
          </button>
        </form>
      </div>
    </div>
  );
}

function SideBetModal({
  bet,
  loading,
  busy,
  canSettle,
  canEdit,
  canRectify,
  onClose,
  onAction
}: {
  bet: SideBetDetail | null;
  loading: boolean;
  busy: boolean;
  canSettle: boolean;
  canEdit: boolean;
  canRectify: boolean;
  onClose: () => void;
  onAction: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal-panel" role="dialog" aria-modal="true" aria-label={bet ? `${bet.title} details` : "Side bet details"} onClick={(event) => event.stopPropagation()}>
        <button className="icon-button modal-close" type="button" onClick={onClose} aria-label="Close side bet details">
          <X size={18} />
        </button>
        <SideBetFocusPanel bet={bet} loading={loading} busy={busy} canSettle={canSettle} canEdit={canEdit} canRectify={canRectify} onAction={onAction} />
      </div>
    </div>
  );
}

function SideBetFocusPanel({
  bet,
  loading,
  busy,
  canSettle,
  canEdit,
  canRectify,
  onAction
}: {
  bet: SideBetDetail | null;
  loading: boolean;
  busy: boolean;
  canSettle: boolean;
  canEdit: boolean;
  canRectify: boolean;
  onAction: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const optionStats = useMemo(() => {
    if (!bet) return [];

    return bet.options.map((option) => {
      const entries = bet.entries.filter((entry) => entry.optionId === option.id);
      const stakeCredits = entries.reduce((total, entry) => total + entry.stakeCredits, 0);
      return {
        ...option,
        entries,
        stakeCredits,
        percent: bet.potCredits > 0 ? (stakeCredits / bet.potCredits) * 100 : 0
      };
    });
  }, [bet]);

  if (loading) {
    return <section className="side-bet-focus empty-state">Loading side bet...</section>;
  }

  if (!bet) {
    return <section className="side-bet-focus empty-state">No side bet selected.</section>;
  }

  const winningOption = bet.options.find((option) => option.id === bet.winningOptionId);

  return (
    <section className="side-bet-focus" aria-label={`${bet.title} details`}>
      <div className="section-heading">
        <div>
          <h2>{bet.title}</h2>
          <span>
            {bet.status} · Manager: {bet.managerName}
          </span>
        </div>
        <span>{bet.participantCount} guesses</span>
      </div>

      <p className="detail-copy">{bet.description}</p>
      {bet.sourceUrl ? (
        <a className="source-link" href={bet.sourceUrl} target="_blank" rel="noreferrer">
          Source
        </a>
      ) : null}

      <div className="detail-metrics">
        <Metric icon={<CircleDollarSign size={18} />} label="Buy-in" value={`${bet.buyInCredits.toFixed(2)} cr`} />
        <Metric icon={<Trophy size={18} />} label="Pot" value={`${bet.potCredits.toFixed(2)} cr`} />
        <Metric icon={<CheckCircle2 size={18} />} label="Fee" value={`${bet.houseFeePercent}%`} />
      </div>

      <div className="detail-times">
        <span>Starts {new Date(bet.startsAt).toLocaleString()}</span>
        <span>Closes {new Date(bet.closesAt).toLocaleString()}</span>
        {bet.settlesAt ? <span>Settled {new Date(bet.settlesAt).toLocaleString()}</span> : null}
      </div>

      <section className="option-breakdown">
        <div className="section-heading">
          <h2>Options</h2>
          {winningOption ? <span>Winner: {winningOption.label}</span> : null}
        </div>
        {optionStats.map((option) => (
          <article className="option-row" key={option.id}>
            <div>
              <strong>{option.label}</strong>
              <span>
                {option.entries.length} guesses · {option.stakeCredits.toFixed(2)} cr
              </span>
            </div>
            <div className="option-bar" aria-hidden="true">
              <span style={{ width: `${option.percent}%` }} />
            </div>
          </article>
        ))}
      </section>

      <section className="guess-list">
        <div className="section-heading">
          <h2>Guesses</h2>
          <span>{bet.entries.length} total</span>
        </div>
        {bet.entries.map((entry) => (
          <article className="guess-row" key={entry.id}>
            <div>
              <strong>{entry.userName}</strong>
              <span>{entry.userEmail ?? "No email"}</span>
            </div>
            <div>
              <strong>{entry.optionLabel}</strong>
              <span>{new Date(entry.createdAt).toLocaleString()}</span>
            </div>
            <strong>{entry.stakeCredits.toFixed(2)} cr</strong>
          </article>
        ))}
        {bet.entries.length === 0 ? <p className="muted">No guesses yet.</p> : null}
      </section>

      {canEdit && bet.status === "open" ? <EditSideBetForm bet={bet} busy={busy} onAction={onAction} /> : null}
      <BetActions bet={bet} busy={busy} onAction={onAction} canSettle={canSettle} />
      {canRectify && bet.status === "settled" ? <RectifySettlementForm bet={bet} busy={busy} onAction={onAction} /> : null}
    </section>
  );
}

function EditSideBetForm({
  bet,
  busy,
  onAction
}: {
  bet: SideBetDetail;
  busy: boolean;
  onAction: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [editForm, setEditForm] = useState(() => sideBetToEditForm(bet));
  const hasEntries = bet.entries.length > 0;

  useEffect(() => {
    setEditForm(sideBetToEditForm(bet));
  }, [bet]);

  async function updateSideBet(event: FormEvent) {
    event.preventDefault();
    await onAction(
      () =>
        api.updateSideBet(bet.id, {
          title: editForm.title,
          description: editForm.description,
          sourceUrl: editForm.sourceUrl || null,
          buyInCredits: Number(editForm.buyInCredits),
          closesAt: new Date(editForm.closesAt).toISOString(),
          options: editForm.options
            .split("\n")
            .map((option) => option.trim())
            .filter(Boolean)
        }),
      "Side bet updated"
    );
  }

  return (
    <form className="side-bet-edit-form" onSubmit={updateSideBet}>
      <div className="section-heading">
        <h2>Edit Side Bet</h2>
        <span>Creator only</span>
      </div>
      <label>
        Title
        <input value={editForm.title} onChange={(event) => setEditForm({ ...editForm, title: event.target.value })} />
      </label>
      <label>
        What is the bet about?
        <textarea value={editForm.description} onChange={(event) => setEditForm({ ...editForm, description: event.target.value })} />
      </label>
      <label>
        Source URL
        <input value={editForm.sourceUrl} onChange={(event) => setEditForm({ ...editForm, sourceUrl: event.target.value })} />
      </label>
      <div className="split-fields">
        <label>
          Buy-in
          <input
            type="number"
            min="1"
            value={editForm.buyInCredits}
            disabled={hasEntries}
            onChange={(event) => setEditForm({ ...editForm, buyInCredits: Number(event.target.value) })}
          />
        </label>
        <label>
          Closes
          <input type="datetime-local" value={editForm.closesAt} onChange={(event) => setEditForm({ ...editForm, closesAt: event.target.value })} />
        </label>
      </div>
      <label>
        Options
        <textarea value={editForm.options} disabled={hasEntries} onChange={(event) => setEditForm({ ...editForm, options: event.target.value })} />
      </label>
      {hasEntries ? <p className="muted">Buy-in and options are locked because users have already joined.</p> : null}
      <button className="primary-button" disabled={busy}>
        Save side bet
      </button>
    </form>
  );
}

function sideBetToEditForm(bet: SideBetDetail) {
  return {
    title: bet.title,
    description: bet.description,
    sourceUrl: bet.sourceUrl ?? "",
    buyInCredits: bet.buyInCredits,
    closesAt: toDatetimeLocalValue(bet.closesAt),
    options: bet.options.map((option) => option.label).join("\n")
  };
}

function toDatetimeLocalValue(value: string) {
  const date = new Date(value);
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function RectifySettlementForm({
  bet,
  busy,
  onAction
}: {
  bet: SideBetDetail;
  busy: boolean;
  onAction: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [correctedOptionId, setCorrectedOptionId] = useState(bet.winningOptionId ?? bet.options[0]?.id ?? "");

  useEffect(() => {
    setCorrectedOptionId(bet.winningOptionId ?? bet.options[0]?.id ?? "");
  }, [bet.id, bet.options, bet.winningOptionId]);

  async function rectifySettlement(event: FormEvent) {
    event.preventDefault();
    await onAction(() => api.rectifySideBet(bet.id, correctedOptionId), "Side bet settlement rectified");
  }

  return (
    <form className="rectification-form" onSubmit={rectifySettlement}>
      <div className="section-heading">
        <h2>Rectify Settlement</h2>
        <span>Admin only</span>
      </div>
      <label>
        Correct winning option
        <select value={correctedOptionId} onChange={(event) => setCorrectedOptionId(event.target.value)}>
          {bet.options.map((option) => (
            <option value={option.id} key={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button className="primary-button" disabled={busy || !correctedOptionId || correctedOptionId === bet.winningOptionId}>
        Rectify settlement
      </button>
    </form>
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
  creditRequests,
  busy,
  onAction
}: {
  transactions: CreditTransaction[];
  redemptions: RedemptionRequest[];
  creditRequests: CreditRequest[];
  busy: boolean;
  onAction: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [requestAmount, setRequestAmount] = useState(10);
  const [requestReason, setRequestReason] = useState("");
  const [redeemAmount, setRedeemAmount] = useState(1);
  const [claimDetails, setClaimDetails] = useState("");

  async function submitCreditRequest(event: FormEvent) {
    event.preventDefault();
    await onAction(
      () =>
        api.createCreditRequest({
          amountCredits: Number(requestAmount),
          requestReason
        }),
      "Credit request submitted"
    );
    setRequestReason("");
  }

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
      <form className="credit-request-form" onSubmit={submitCreditRequest}>
        <div className="section-heading">
          <h2>Request Credits</h2>
          <span>Admin approved</span>
        </div>
        <label>
          Credits to request
          <input min="1" max="10000" type="number" value={requestAmount} onChange={(event) => setRequestAmount(Number(event.target.value))} />
        </label>
        <label>
          Reason
          <textarea
            value={requestReason}
            onChange={(event) => setRequestReason(event.target.value)}
            placeholder="Why do you need credits added?"
          />
        </label>
        <button className="primary-button" disabled={busy || !requestReason.trim()}>
          Request credits
        </button>
      </form>
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
      {creditRequests.slice(0, 3).map((creditRequest) => (
        <div className="transaction" key={creditRequest.id}>
          <span>Credit request {creditRequest.status}</span>
          <strong>{creditRequest.amountCredits.toFixed(2)} cr</strong>
        </div>
      ))}
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
  creditRequests,
  busy,
  onAction
}: {
  summary: AdminSummary | null;
  users: AdminUser[];
  transactions: CreditTransaction[];
  redemptions: RedemptionRequest[];
  creditRequests: CreditRequest[];
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

  async function reviewCreditRequest(id: string, status: "approved" | "rejected") {
    await onAction(
      () => api.adminReviewCreditRequest(id, { status }),
      status === "approved" ? "Credit request approved" : "Credit request rejected"
    );
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
      <section className="credit-request-queue">
        <div className="section-heading">
          <h2>Credit Requests</h2>
          <span>{creditRequests.filter((creditRequest) => creditRequest.status === "pending").length} pending</span>
        </div>
        {creditRequests.slice(0, 8).map((creditRequest) => (
          <article className="credit-request-item" key={creditRequest.id}>
            <div>
              <strong>
                {creditRequest.userName} requests {creditRequest.amountCredits.toFixed(2)} cr
              </strong>
              <p>{creditRequest.requestReason}</p>
              <span className={`status ${creditRequest.status}`}>{creditRequest.status}</span>
            </div>
            {creditRequest.status === "pending" ? (
              <div className="row-actions">
                <button disabled={busy} onClick={() => reviewCreditRequest(creditRequest.id, "approved")}>
                  Approve
                </button>
                <button className="text-button danger" disabled={busy} onClick={() => reviewCreditRequest(creditRequest.id, "rejected")}>
                  Reject
                </button>
              </div>
            ) : null}
          </article>
        ))}
        {creditRequests.length === 0 ? <p className="muted">No credit requests yet.</p> : null}
      </section>
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
