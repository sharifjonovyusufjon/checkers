const mongoose = require("mongoose");
const config = require("./src/config");
const { connectDb } = require("./src/db");
const { ensureDefaults } = require("./src/models");
const manager = require("./src/game/manager");
const { createServer } = require("./src/web/server");
const { startBots } = require("./src/telegram/bots");

async function main() {
  await connectDb();
  await ensureDefaults();
  await manager.loadActive();
  manager.startClock();
  const server = createServer();
  await new Promise((resolve) => server.listen(config.port, "127.0.0.1", resolve));
  console.log(`http://127.0.0.1:${config.port}`);
  const bots = startBots();
  bots.catch((err) => {
    console.error(err);
    process.exit(1);
  });
  const stop = async () => {
    server.close();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
