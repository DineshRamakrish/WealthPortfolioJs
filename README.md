# Wealth Portfolio (Paper Trading)

A dependency-free JavaScript app for a simulated wealth-management portfolio.
It serves a small dashboard, updates fictional market prices, streams price
changes over server-sent events, and supports idempotent buy/sell paper trades.

## Run

```text
npm start
```

Open <http://localhost:8082>. Run the automated tests with `npm test`.

## API

- `GET /api/portfolio` — simulated cash, positions, and portfolio value.
- `GET /api/prices` — current fictional prices.
- `POST /api/trades` — JSON `{ "symbol": "DEMO", "side": "buy", "quantity": 2 }`;
  include an `Idempotency-Key` header.
- `GET /api/events` — server-sent simulated price and trade updates.

Prices are random demo values, not quotes. The portfolio, balances, and trades
are in memory and reset on restart. This is not a bank, broker, investment
recommendation, or connection to a market; trades cannot move real money.
