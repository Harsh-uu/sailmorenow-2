import { createContext, useContext, useEffect, useState } from "react";

const MarketCtx = createContext({ market: "all", setMarket: () => {} });

export function MarketProvider({ children }) {
  const [market, setMarketState] = useState(() => localStorage.getItem("smn_market") || "all");
  useEffect(() => { localStorage.setItem("smn_market", market); }, [market]);
  const setMarket = (m) => setMarketState(m);
  return <MarketCtx.Provider value={{ market, setMarket }}>{children}</MarketCtx.Provider>;
}
export const useMarket = () => useContext(MarketCtx);
