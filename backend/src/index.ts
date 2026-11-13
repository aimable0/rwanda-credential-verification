import app from "./app";
import { logger } from "./logger";

// Errors that escape every handler are logged before anything else happens.
// An uncaught exception leaves the process in an unknown state, so it exits and
// pm2 starts a fresh one.
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", undefined, reason);
});
process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception, shutting down", undefined, err);
  process.exit(1);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  logger.info("Backend server running", { url: `http://localhost:${PORT}` });
  logger.info("Connected to Sepolia contract", {
    address: process.env.CONTRACT_ADDRESS,
  });
});
