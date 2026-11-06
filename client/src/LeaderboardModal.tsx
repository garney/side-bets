import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { LeaderboardRow } from "../../shared/types";
import { api } from "./api";

type Props = {
  currentUserId: string;
  onClose: () => void;
};

export function LeaderboardModal({ currentUserId, onClose }: Props) {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"rate" | "wins">("wins");

  const ranked = [...rows].sort((a, b) =>
    tab === "wins"
      ? b.wins - a.wins || b.winRate - a.winRate || b.played - a.played
      : b.winRate - a.winRate || b.wins - a.wins || b.played - a.played
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api
      .leaderboard()
      .then((next) => {
        if (!cancelled) setRows(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the leaderboard");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="modal-panel leaderboard-panel" role="dialog" aria-modal="true" aria-labelledby="leaderboard-title" onClick={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div>
            <h2 id="leaderboard-title">Leaderboard</h2>
            <p className="muted">Settled side bets in your groups</p>
          </div>
          <button className="icon-button modal-close" type="button" onClick={onClose} aria-label="Close leaderboard">
            <X size={18} />
          </button>
        </header>
        <div className="view-switch" role="tablist" aria-label="Leaderboard ranking">
          <button type="button" className={tab === "rate" ? "active" : ""} role="tab" aria-selected={tab === "rate"} onClick={() => setTab("rate")}>
            Win rate
          </button>
          <button type="button" className={tab === "wins" ? "active" : ""} role="tab" aria-selected={tab === "wins"} onClick={() => setTab("wins")}>
            Wins
          </button>
        </div>
        {loading ? <p>Loading…</p> : null}
        {error ? <p className="error">{error}</p> : null}
        {!loading && !error && rows.length === 0 ? <p className="muted">No settled bets in this group yet.</p> : null}
        {rows.length > 0 ? (
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Player</th>
                <th scope="col">Wins</th>
                <th scope="col">Played</th>
                <th scope="col">Win rate</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((row, index) => (
                <tr key={row.userId} className={row.userId === currentUserId ? "mine" : ""}>
                  <td>{index + 1}</td>
                  <td>{row.displayName}</td>
                  <td>{row.wins}</td>
                  <td>{row.played}</td>
                  <td>{Math.round(row.winRate * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </div>
  );
}
