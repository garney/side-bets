import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import type { ShopOffer } from "../../shared/types";
import { api } from "./api";

type Props = {
  experiencePoints: number;
};

export function ShopView({ experiencePoints }: Props) {
  const [offers, setOffers] = useState<ShopOffer[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api
      .shop()
      .then((next) => {
        if (!cancelled) setOffers(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the shop");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="shop-view">
      <div className="section-heading">
        <h2>XP Shop</h2>
        <span>You have {experiencePoints} XP</span>
      </div>
      <p className="muted">
        Spend is not open yet. These are the experience-to-credit rates admins have set. Wins and blackjacks earn extra XP at the table.
      </p>
      {loading ? <p>Loading…</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <div className="shop-grid">
        {offers.map((offer) => (
          <article className="shop-card" key={offer.id}>
            <Sparkles size={18} />
            <strong>{offer.title}</strong>
            <p>
              {offer.xpCost} XP for {offer.creditsGranted} credits
            </p>
            <span className={experiencePoints >= offer.xpCost ? "muted" : "muted"}>
              {experiencePoints >= offer.xpCost ? "Enough XP when spending opens" : "Keep playing to reach this"}
            </span>
          </article>
        ))}
      </div>
      {!loading && !error && offers.length === 0 ? <p className="muted">No shop rates yet. Admins can add them in Admin.</p> : null}
    </section>
  );
}
