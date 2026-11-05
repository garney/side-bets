import { useEffect, useMemo, useState } from "react";
import type { Profile, PublicTable } from "../../../../shared/types";
import { PlayingCard } from "./PlayingCard";
import { cardKey } from "../cardUtils";
import { useCardReveal } from "./useCardReveal";

type Props = {
  table: PublicTable;
  profile: Profile;
  betAmount: string;
  setBetAmount: (v: string) => void;
  busy: boolean;
  socketReady: boolean;
  onBet: () => void;
  onHit: () => void;
  onStand: () => void;
  onLeave: () => void;
  onLeaveHost: () => void;
  onStartBetting: () => void;
  onDeal: () => void;
  onEndTable: () => void;
};

function outcomeLabel(outcome: string, net: number) {
  if (outcome === "blackjack") return `Blackjack! +${net}`;
  if (outcome === "win") return `You win +${net}`;
  if (outcome === "push") return "Push — bet returned";
  if (outcome === "bust") return `Bust — lost ${Math.abs(net)}`;
  return `You lose — lost ${Math.abs(net)}`;
}

export function BlackjackTableView({
  table,
  profile,
  betAmount,
  setBetAmount,
  busy,
  socketReady,
  onBet,
  onHit,
  onStand,
  onLeave,
  onLeaveHost,
  onStartBetting,
  onDeal,
  onEndTable
}: Props) {
  const mySeat = table.seats.find((s) => s.userId === profile.id);
  const isHost = table.dealerUserId === profile.id;
  const isLiveAuto = table.mode === "live";
  const myResult = table.lastRoundResults?.find((r) => r.userId === profile.id);
  const holeHidden = table.dealerHand.some((c) => c.suit === "hidden");

  const [flipHole, setFlipHole] = useState(false);
  const reveal = useCardReveal(table);

  useEffect(() => {
    if (!holeHidden && table.dealerHand.length >= 2) {
      const t = window.setTimeout(() => setFlipHole(true), 200);
      return () => window.clearTimeout(t);
    }
    setFlipHole(false);
  }, [holeHidden, table.dealerHand.length, table.round]);

  const dealerTotalLabel = reveal.dealerDisplayTotal(holeHidden, flipHole);

  const seatSlots = useMemo(() => {
    const slots = Array.from({ length: table.maxSeats }, () => null as (typeof table.seats)[0] | null);
    for (const seat of table.seats) slots[seat.seatIndex] = seat;
    return slots;
  }, [table.seats, table.maxSeats]);

  return (
    <div className="bj-table-wrap">
      <div className="bj-table-header">
        <div>
          {isHost && table.mode === "live" ? (
            <p className="dealer-view-hint">
              Dealer view — watch hands and bankroll here. You are not seated; use Deal now / Close table below.
              {table.dealerAway ? " (Table marked host away — still runs on your bankroll.)" : null}
            </p>
          ) : null}
          <span className="phase-pill">{table.phase}</span>
          <span className="muted">Round {table.round}</span>
        </div>
        {table.mode === "practice" && mySeat ? (
          <div className="chip-balance">
            <span className="chip-dot" aria-hidden />
            <strong>{mySeat.practiceChips ?? 0}</strong>
            <span className="muted">practice chips</span>
          </div>
        ) : null}
        {table.mode === "live" ? (
          <div className="chip-balance live">
            Bankroll <strong>{table.dealerBankroll ?? 0}</strong>
            {table.dealerAway ? <span className="muted"> · host away</span> : null}
          </div>
        ) : null}
      </div>

      {myResult ? (
        <div className={`result-banner ${myResult.net >= 0 ? "win" : "lose"}`}>
          {outcomeLabel(myResult.outcome, myResult.net)}
          {table.mode === "practice" && mySeat ? (
            <span className="muted"> · Balance {mySeat.practiceChips} chips</span>
          ) : null}
        </div>
      ) : null}

      <div className="felt">
        <div className="deck-pile" aria-hidden>
          <PlayingCard suit="hidden" rank={0} faceDown small />
          <PlayingCard suit="hidden" rank={0} faceDown small />
        </div>

        <div className="dealer-zone">
          <div className="zone-label">
            Dealer · {table.dealerName}
            {dealerTotalLabel != null ? ` · ${dealerTotalLabel}` : ""}
          </div>
          <div className="card-row">
            {table.dealerHand.length === 0 ? (
              <span className="muted empty-hand">Waiting for deal</span>
            ) : (
              table.dealerHand.map((card, i) => {
                const facedown = card.suit === "hidden" || (i === 1 && holeHidden && !flipHole);
                return (
                  <PlayingCard
                    key={cardKey(card, i, "dealer")}
                    suit={facedown ? "hidden" : card.suit}
                    rank={facedown ? 0 : card.rank}
                    faceDown={facedown}
                    dealDelayMs={i * 120}
                  />
                );
              })
            )}
          </div>
        </div>

        <div className="player-zones">
          {seatSlots.map((seat, slot) => (
            <div
              key={slot}
              className={`player-spot ${seat?.userId === profile.id ? "mine" : ""} ${
                seat && table.activeSeatIndex === seat.seatIndex ? "active-turn" : ""
              }`}
            >
              {seat ? (
                <>
                  <div className="spot-name">
                    {seat.displayName}
                    {seat.bet > 0 ? <span className="bet-chip">{seat.bet}</span> : null}
                  </div>
                  <div className="card-row">
                    {seat.hand.length === 0 ? (
                      <span className="muted empty-hand">—</span>
                    ) : (
                      seat.hand.map((card, i) => (
                        <PlayingCard
                          key={cardKey(card, i, seat.userId)}
                          suit={card.suit}
                          rank={card.rank}
                          dealDelayMs={220 + seat.seatIndex * 60 + i * 140}
                        />
                      ))
                    )}
                  </div>
                  {(() => {
                    const total = reveal.playerHandTotal(seat.userId, seat.hand);
                    return total != null ? <div className="hand-total">{total}</div> : null;
                  })()}
                  {table.mode === "practice" && seat.userId === profile.id ? (
                    <div className="spot-chips">{seat.practiceChips ?? 0} chips</div>
                  ) : null}
                </>
              ) : (
                <div className="empty-spot">Seat {slot + 1}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {isLiveAuto && table.phase === "betting" ? (
        <p className="muted auto-hint">
          {(() => {
            const seated = table.seats.length;
            const withBet = table.seats.filter((s) => s.bet > 0).length;
            if (withBet === 0) return "Players place bets to start. Auto-deal when everyone seated has bet, or 8s after the first bet.";
            if (withBet < seated) return "Some players have not bet yet — auto-deal in up to 8s, or the host can tap Deal now.";
            return "All seated players have bet — dealing automatically.";
          })()}
        </p>
      ) : null}

      <div className="actions table-actions">
        {isHost && isLiveAuto ? (
          <>
            {table.phase === "betting" && table.seats.some((s) => s.bet > 0) ? (
              <button type="button" disabled={!socketReady || busy} onClick={onDeal}>
                Deal now
              </button>
            ) : null}
            <button type="button" className="secondary" disabled={!socketReady || busy} onClick={onLeaveHost}>
              Back to lobby (keep watching)
            </button>
            <button type="button" className="secondary" disabled={!socketReady || busy} onClick={onEndTable}>
              Close table and refund bankroll
            </button>
          </>
        ) : null}
        {isHost && !isLiveAuto && table.phase === "open" ? (
          <button type="button" disabled={!socketReady || busy} onClick={onStartBetting}>
            Open betting
          </button>
        ) : null}
        {isHost && !isLiveAuto && table.phase === "betting" ? (
          <button type="button" disabled={!socketReady || busy} onClick={onDeal}>
            Deal
          </button>
        ) : null}
        {!isHost && mySeat && table.phase === "betting" && mySeat.bet <= 0 ? (
          <>
            <input value={betAmount} onChange={(e) => setBetAmount(e.target.value)} type="number" min={table.minBet} max={table.maxBet} />
            <button type="button" disabled={!socketReady || busy} onClick={onBet}>
              Bet ({table.minBet}–{table.maxBet})
            </button>
          </>
        ) : null}
        {!isHost && mySeat?.status === "acting" && table.activeSeatIndex === mySeat.seatIndex ? (
          <>
            <button type="button" disabled={!socketReady || busy} onClick={onHit}>
              Hit
            </button>
            <button type="button" disabled={!socketReady || busy} onClick={onStand}>
              Stand
            </button>
          </>
        ) : null}
        {!isHost && mySeat ? (
          <button type="button" className="secondary" disabled={!socketReady || busy} onClick={onLeave}>
            Leave seat
          </button>
        ) : null}
      </div>
    </div>
  );
}
