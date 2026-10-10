const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const STARTING_CASH = 100_000;
const INITIAL_PRICES = { ACME: 120, NORTH: 85, GREEN: 42 };

function createApp() {
  const state = {
    cash: STARTING_CASH,
    prices: { ...INITIAL_PRICES },
    positions: new Map(),
    trades: new Map(),
    clients: new Set()
  };
  let feedTimer;

  function sendJson(response, status, value) {
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(JSON.stringify(value));
  }

  function snapshot() {
    const positions = Object.entries(state.prices).map(([symbol, price]) => {
      const quantity = state.positions.get(symbol) || 0;
      return { symbol, quantity: round(quantity), price: round(price), value: round(quantity * price) };
    });
    return {
      mode: "paper-trading",
      cash: round(state.cash),
      positions,
      totalValue: round(state.cash + positions.reduce((total, item) => total + item.value, 0))
    };
  }

  function publish(event, value) {
    const message = `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;
    for (const response of state.clients) {
      if (!response.write(message)) state.clients.delete(response);
    }
  }

  async function readJson(request) {
    let body = "";
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 16_384) throw new Error("Request body is too large.");
    }
    return JSON.parse(body);
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(fs.readFileSync(path.join(__dirname, "index.html")));
    } else if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, { status: "ok", mode: "simulation" });
    } else if (request.method === "GET" && url.pathname === "/api/portfolio") {
      sendJson(response, 200, snapshot());
    } else if (request.method === "GET" && url.pathname === "/api/prices") {
      sendJson(response, 200, state.prices);
    } else if (request.method === "GET" && url.pathname === "/api/events") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });
      response.write("retry: 3000\n\n");
      state.clients.add(response);
      request.on("close", () => state.clients.delete(response));
    } else if (request.method === "POST" && url.pathname === "/api/trades") {
      try {
        const key = request.headers["idempotency-key"];
        if (typeof key !== "string" || !key.trim()) {
          return sendJson(response, 400, { error: "An Idempotency-Key header is required." });
        }
        if (state.trades.has(key)) return sendJson(response, 200, state.trades.get(key));
        const tradeRequest = await readJson(request);
        if (state.trades.has(key)) return sendJson(response, 200, state.trades.get(key));
        const symbol = typeof tradeRequest.symbol === "string" ? tradeRequest.symbol.toUpperCase() : "";
        const side = tradeRequest.side;
        const quantity = Number(tradeRequest.quantity);
        if (!(symbol in state.prices) || !["buy", "sell"].includes(side)
          || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) {
          return sendJson(response, 400, { error: "Use a supported symbol, buy or sell, and a positive quantity." });
        }
        const price = state.prices[symbol];
        const notional = round(quantity * price);
        const currentQuantity = state.positions.get(symbol) || 0;
        if (side === "buy" && state.cash < notional) {
          return sendJson(response, 422, { error: "Insufficient simulated cash." });
        }
        if (side === "sell" && currentQuantity < quantity) {
          return sendJson(response, 422, { error: "Insufficient paper shares." });
        }
        state.cash = round(state.cash + (side === "buy" ? -notional : notional));
        state.positions.set(symbol, round(currentQuantity + (side === "buy" ? quantity : -quantity)));
        const trade = { id: crypto.randomUUID(), symbol, side, quantity: round(quantity), price, notional, status: "simulated" };
        state.trades.set(key, trade);
        publish("trade", trade);
        sendJson(response, 201, trade);
      } catch (error) {
        sendJson(response, 400, { error: error instanceof SyntaxError ? "Request body must be valid JSON." : error.message });
      }
    } else {
      sendJson(response, 404, { error: "Route not found." });
    }
  });

  return {
    server,
    snapshot,
    startFeed(intervalMs = 1000) {
      if (feedTimer) return;
      feedTimer = setInterval(() => {
        for (const [symbol, price] of Object.entries(state.prices)) {
          const movement = (Math.random() - 0.5) * 0.02;
          state.prices[symbol] = Math.max(1, round(price * (1 + movement)));
        }
        publish("prices", state.prices);
      }, intervalMs);
      feedTimer.unref();
    },
    stopFeed() {
      if (feedTimer) clearInterval(feedTimer);
      feedTimer = undefined;
    }
  };
}

function round(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

if (require.main === module) {
  const app = createApp();
  const port = Number(process.env.PORT || 8082);
  app.startFeed();
  app.server.listen(port, () => console.log(`Paper portfolio running at http://localhost:${port}`));
}

module.exports = { createApp };
