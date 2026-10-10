const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { createApp } = require("./server");

const app = createApp();
let baseUrl;

before(async () => {
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${app.server.address().port}`;
});

after(async () => {
  app.stopFeed();
  await new Promise((resolve, reject) => app.server.close(error => error ? reject(error) : resolve()));
});

test("portfolio reports a simulation and starts with fictional cash", async () => {
  const response = await fetch(`${baseUrl}/api/portfolio`);
  const portfolio = await response.json();
  assert.equal(response.status, 200);
  assert.equal(portfolio.mode, "paper-trading");
  assert.equal(portfolio.cash, 100_000);
});

test("a paper buy is idempotent and updates the simulated portfolio once", async () => {
  const send = () => fetch(`${baseUrl}/api/trades`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "test-buy-1" },
    body: JSON.stringify({ symbol: "ACME", side: "buy", quantity: 2 })
  });
  const firstResponse = await send();
  const first = await firstResponse.json();
  const replayResponse = await send();
  const replay = await replayResponse.json();
  const portfolio = await (await fetch(`${baseUrl}/api/portfolio`)).json();
  assert.equal(firstResponse.status, 201);
  assert.equal(replayResponse.status, 200);
  assert.equal(replay.id, first.id);
  assert.equal(portfolio.cash, 99_760);
  assert.equal(portfolio.positions.find(position => position.symbol === "ACME").quantity, 2);
});

test("rejects requests without an idempotency key", async () => {
  const response = await fetch(`${baseUrl}/api/trades`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol: "ACME", side: "buy", quantity: 1 })
  });
  assert.equal(response.status, 400);
});

test("concurrent retries with one idempotency key execute only one paper trade", async () => {
  const send = () => fetch(`${baseUrl}/api/trades`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "concurrent-buy-1" },
    body: JSON.stringify({ symbol: "NORTH", side: "buy", quantity: 1 })
  });
  const [firstResponse, retryResponse] = await Promise.all([send(), send()]);
  const [first, retry] = await Promise.all([firstResponse.json(), retryResponse.json()]);
  const portfolio = await (await fetch(`${baseUrl}/api/portfolio`)).json();
  assert.deepEqual([firstResponse.status, retryResponse.status].sort(), [200, 201]);
  assert.equal(first.id, retry.id);
  assert.equal(portfolio.positions.find(position => position.symbol === "NORTH").quantity, 1);
});

test("paper trade updates stream to connected event clients", async () => {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/events`, { signal: controller.signal });
  assert.equal(response.headers.get("content-type").split(";")[0], "text/event-stream");
  const reader = response.body.getReader();
  await reader.read();
  const decoder = new TextDecoder();
  const eventPromise = (async () => {
    let message = "";
    while (!message.includes("event: trade")) {
      const { done, value } = await reader.read();
      assert.equal(done, false);
      message += decoder.decode(value, { stream: true });
    }
    return message;
  })();
  try {
    const tradeResponse = await fetch(`${baseUrl}/api/trades`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "sse-trade-1" },
      body: JSON.stringify({ symbol: "GREEN", side: "buy", quantity: 1 })
    });
    assert.equal(tradeResponse.status, 201);
    const trade = await tradeResponse.json();
    assert.match(await eventPromise, new RegExp(trade.id));
  } finally {
    controller.abort();
    await reader.cancel().catch(() => {});
  }
});
