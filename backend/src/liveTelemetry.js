const clients = new Set();

function streamTelemetry(req, res) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write(": connected\n\n");

  clients.add(res);
  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 25000);
  res.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
}

function publishLiveTelemetry(data) {
  const event = `event: telemetry\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try { client.write(event); }
    catch { clients.delete(client); }
  }
}

module.exports = { streamTelemetry, publishLiveTelemetry };
