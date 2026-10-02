const mongoose = require("mongoose");
const config = require("./config");

async function connectDb() {
  if (!config.mongoUrl) throw new Error("MONGO_URL yo'q");
  mongoose.set("strictQuery", true);
  await mongoose.connect(config.mongoUrl, { dbName: "checkers" });
  console.log("mongo: checkers");
}

module.exports = { connectDb };
