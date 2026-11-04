import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { io, type Socket } from "socket.io-client";
import type { Group, Profile, PublicTable } from "../../../shared/types";
import { api } from "../api";
import { supabase } from "../supabase";
import { BlackjackTableView } from "./components/BlackjackTableView";
import { preloadCardAssets } from "./cardAssets";
import "./blackjack.css";

type Props = {
  onExit: () => void;
};

function socketAck<T>(socket: Socket, event: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    socket.timeout(8000).emit(event, payload ?? {}, (err: Error | null, response: T) => {
      if (err) reject(err);
      else resolve(response);
    });
  });
}

function pickDefaultGroup(groups: Group[], profile: Profile | null) {
  const approved = groups.filter((g) => profile?.isAdmin || g.membershipStatus === "approved");
  if (approved.length === 0) return null;
  return approved[0].id;
}

export function BlackjackPage({ onExit }: Props) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState<string>("");
  const [lobby, setLobby] = useState<PublicTable[]>([]);
  const [table, setTable] = useState<PublicTable | null>(null);
  const [socketState, setSocketState] = useState<"off" | "live">("off");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [hostTitle, setHostTitle] = useState("Friday night");
  const [hostBankroll, setHostBankroll] = useState("500");
  const [hostMin, setHostMin] = useState("5");
  const [hostMax, setHostMax] = useState("50");
  const [betAmount, setBetAmount] = useState("10");
  const socketRef = useRef<Socket | null>(null);
  const profileIdRef = useRef<string | null>(null);
  const tableIdRef = useRef<string | null>(null);
  const groupIdRef = useRef("");
  profileIdRef.current = profile?.id ?? null;
  tableIdRef.current = table?.id ?? null;
  groupIdRef.current = groupId;

  const approvedGroups = groups.filter((g) => profile?.isAdmin || g.membershipStatus === "approved");

  useEffect(() => {
    void preloadCardAssets().catch(() => undefined);
    void Promise.all([api.me(), api.groups()])
      .then(([me, nextGroups]) => {
        setProfile(me);
        setGroups(nextGroups);
        setGroupId((current) => current || pickDefaultGroup(nextGroups, me) || "");
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Could not load profile"));
  }, []);

  async function watchTableById(tableId: string) {
    const socket = socketRef.current;
    if (!socket) throw new Error("Not connected");
    const res = await socketAck<{ ok: boolean; error?: string; table?: PublicTable }>(socket, "blackjack:watch", {
      tableId
    });
    if (!res.ok || !res.table) throw new Error(res.error ?? "Table not found");
    setTable(res.table);
  }

  useEffect(() => {
    if (!profile || !groupId) return;
    let cancelled = false;

    void supabase.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token;
      if (!token || cancelled) return;

      socketRef.current?.disconnect();
      const socket = io(window.location.origin, {
        path: "/socket.io",
        auth: { token }
      });
      socketRef.current = socket;

      socket.on("connect", () => {
        setSocketState("live");
        void socketAck(socket, "blackjack:join-group", { groupId }).catch((error) => {
          setMessage(error instanceof Error ? error.message : "Could not join group lobby");
        });
      });
      socket.on("disconnect", () => setSocketState("off"));
      socket.on("blackjack:lobby", (rows: PublicTable[]) => setLobby(rows));
      socket.on("blackjack:state", (state: PublicTable) => {
        const pid = profileIdRef.current;
        const watchingId = tableIdRef.current;
        const relevant =
          state.groupId === groupIdRef.current &&
          (state.id === watchingId ||
            state.dealerUserId === pid ||
            (pid != null && state.seats.some((s) => s.userId === pid)));

        if (state.phase === "finished") {
          if (relevant) setTable(null);
          return;
        }
        if (relevant) setTable(state);
      });
      socket.on("blackjack:error", (payload: { message?: string }) => {
        if (payload?.message) setMessage(payload.message);
      });
      socket.on("blackjack:kicked", (payload: { message?: string }) => {
        setTable(null);
        setMessage(payload?.message || "You were removed from the table for inactivity");
      });
      socket.on("wallet:changed", (payload: { creditsBalance?: number }) => {
        if (typeof payload?.creditsBalance === "number") {
          setProfile((current) => (current ? { ...current, creditsBalance: payload.creditsBalance! } : current));
        } else {
          void api.me().then(setProfile).catch(() => undefined);
        }
      });
    });

    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
      setSocketState("off");
    };
  }, [profile?.id, groupId]);

  async function withBusy(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const socket = socketRef.current;
  const myHostedTable = lobby.find((row) => row.mode === "live" && row.dealerUserId === profile?.id);

  return (
    <div className="shell blackjack-shell">
      <header className="topbar">
        <div>
          <button type="button" className="secondary icon-btn" onClick={onExit} aria-label="Back to Side Bets">
            <ArrowLeft size={18} />
          </button>
          <strong>Blackjack</strong>
          <span className="muted">
            {profile?.displayName} · {profile?.creditsBalance ?? 0} credits · socket {socketState}
          </span>
        </div>
        <nav className="tabs">
          {myHostedTable && table?.id !== myHostedTable.id ? (
            <button type="button" className="watch-hosted" disabled={!socket || busy} onClick={() => void withBusy(() => watchTableById(myHostedTable.id))}>
              Watch {myHostedTable.title}
            </button>
          ) : null}
        </nav>
      </header>

      {message ? <p className="error banner">{message}</p> : null}

      <div className="panel" style={{ marginBottom: 12 }}>
        <label>
          Group table
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)} disabled={approvedGroups.length === 0}>
            {approvedGroups.length === 0 ? <option value="">Join a group in Side Bets first</option> : null}
            {approvedGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">Live and practice tables are scoped to this group. Wallet credits are shared with Side Bets.</p>
      </div>

      <div className="bj-split">
        <section className="panel">
          <h2>Lobby</h2>
          <div className="actions">
            <button
              type="button"
              disabled={!socket || busy || !groupId}
              onClick={() =>
                void withBusy(async () => {
                  if (!socket) return;
                  const res = await socketAck<{ ok: boolean; error?: string; table?: PublicTable }>(socket, "blackjack:join-practice", {
                    groupId
                  });
                  if (!res.ok) throw new Error(res.error);
                  if (res.table) setTable(res.table);
                })
              }
            >
              Join CPU practice
            </button>
          </div>
          <h3>Host a live table (you are the dealer)</h3>
          <p className="hint">Bankroll is taken from your wallet credits and pays player wins until you close the table.</p>
          <div className="host-form">
            <label>
              Table name
              <input value={hostTitle} onChange={(e) => setHostTitle(e.target.value)} placeholder="Friday night" />
            </label>
            <label>
              Dealer bankroll (chips)
              <input value={hostBankroll} onChange={(e) => setHostBankroll(e.target.value)} type="number" min={1} />
            </label>
            <label>
              Minimum bet per hand
              <input value={hostMin} onChange={(e) => setHostMin(e.target.value)} type="number" min={1} />
            </label>
            <label>
              Maximum bet per hand
              <input value={hostMax} onChange={(e) => setHostMax(e.target.value)} type="number" min={1} />
            </label>
            <button
              type="button"
              disabled={!socket || busy || !groupId}
              onClick={() =>
                void withBusy(async () => {
                  if (!socket) return;
                  const res = await socketAck<{ ok: boolean; error?: string; table?: PublicTable }>(socket, "blackjack:create-table", {
                    title: hostTitle,
                    bankroll: Number(hostBankroll),
                    minBet: Number(hostMin),
                    maxBet: Number(hostMax),
                    groupId
                  });
                  if (!res.ok) throw new Error(res.error);
                  const me = await api.me();
                  setProfile(me);
                  if (res.table) setTable(res.table);
                })
              }
            >
              Open table
            </button>
          </div>
          <ul className="table-list">
            {lobby.map((row) => (
              <li key={row.id}>
                <div>
                  <strong>{row.title}</strong>
                  <span className="muted">
                    {row.mode}
                    {row.mode === "live" && row.dealerBankroll != null ? ` · bankroll ${row.dealerBankroll}` : ""}
                    {" · "}
                    {row.seatedCount}/{row.maxSeats} · {row.phase}
                    {row.dealerAway ? " · host away" : ""}
                  </span>
                </div>
                {row.mode === "live" && row.dealerUserId === profile?.id ? (
                  <button type="button" disabled={!socket || busy} onClick={() => void withBusy(() => watchTableById(row.id))}>
                    Watch table
                  </button>
                ) : null}
                {row.mode === "live" && row.dealerUserId !== profile?.id ? (
                  <button
                    type="button"
                    disabled={!socket || busy || Boolean(table)}
                    onClick={() =>
                      void withBusy(async () => {
                        if (!socket) return;
                        const res = await socketAck<{ ok: boolean; error?: string; table?: PublicTable }>(socket, "blackjack:join", {
                          tableId: row.id
                        });
                        if (!res.ok) throw new Error(res.error);
                        if (res.table) setTable(res.table);
                      })
                    }
                  >
                    Join
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <section className="panel table-view panel-wide">
          <h2>{table ? table.title : "No table"}</h2>
          {!table ? <p className="muted">Join practice or host a table for your group.</p> : null}
          {table && profile ? (
            <BlackjackTableView
              table={table}
              profile={profile}
              betAmount={betAmount}
              setBetAmount={setBetAmount}
              busy={busy}
              socketReady={Boolean(socket)}
              onBet={() =>
                void withBusy(async () => {
                  if (!socket) return;
                  const res = await socketAck<{ ok: boolean; error?: string }>(socket, "blackjack:bet", {
                    amount: Number(betAmount)
                  });
                  if (!res.ok) throw new Error(res.error);
                })
              }
              onHit={() =>
                void withBusy(async () => {
                  if (!socket) return;
                  const res = await socketAck<{ ok: boolean; error?: string }>(socket, "blackjack:hit");
                  if (!res.ok) throw new Error(res.error);
                })
              }
              onStand={() =>
                void withBusy(async () => {
                  if (!socket) return;
                  const res = await socketAck<{ ok: boolean; error?: string }>(socket, "blackjack:stand");
                  if (!res.ok) throw new Error(res.error);
                })
              }
              onLeave={() =>
                void withBusy(async () => {
                  if (!socket) return;
                  const res = await socketAck<{ ok: boolean; error?: string }>(socket, "blackjack:leave");
                  if (!res.ok) throw new Error(res.error);
                  if (table.dealerUserId !== profile.id) setTable(null);
                })
              }
              onLeaveHost={() =>
                void withBusy(async () => {
                  if (!socket || !table) return;
                  const tableId = table.id;
                  const res = await socketAck<{ ok: boolean; error?: string }>(socket, "blackjack:leave-host");
                  if (!res.ok) throw new Error(res.error);
                  await watchTableById(tableId);
                })
              }
              onStartBetting={() =>
                void withBusy(async () => {
                  if (!socket) return;
                  const res = await socketAck<{ ok: boolean; error?: string }>(socket, "blackjack:start-betting");
                  if (!res.ok) throw new Error(res.error);
                })
              }
              onDeal={() =>
                void withBusy(async () => {
                  if (!socket) return;
                  const res = await socketAck<{ ok: boolean; error?: string }>(socket, "blackjack:deal");
                  if (!res.ok) throw new Error(res.error);
                })
              }
              onEndTable={() =>
                void withBusy(async () => {
                  if (!socket) return;
                  const res = await socketAck<{ ok: boolean; error?: string }>(socket, "blackjack:end-table");
                  if (!res.ok) throw new Error(res.error);
                  setTable(null);
                  setProfile(await api.me());
                })
              }
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}
