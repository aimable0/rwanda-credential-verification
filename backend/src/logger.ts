import crypto from "crypto";
import { NextFunction, Request, Response } from "express";

// A small logger with no dependencies. Each entry is one line on stdout or stderr:
//   2026-11-12T09:14:03.120Z ERROR Request failed id=7f3a91c2 route="POST /api/credentials/verify"
// followed by the stack trace for errors. In production, pm2 captures these streams
// in ~/.pm2/logs/<name>-out.log and <name>-error.log.
//
// LOG_LEVEL sets the lowest level written: debug, info (default), warn, error or silent.

type Level = "debug" | "info" | "warn" | "error";
type Meta = Record<string, unknown>;

const ORDER: Record<Level | "silent", number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

function threshold(): number {
  const configured = String(process.env.LOG_LEVEL ?? "info").toLowerCase();
  return ORDER[configured as Level | "silent"] ?? ORDER.info;
}

function formatMeta(meta?: Meta): string {
  if (!meta) return "";
  return Object.entries(meta)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      return `${k}=${/[\s"=]/.test(s) ? JSON.stringify(s) : s}`;
    })
    .join(" ");
}

function write(level: Level, message: string, meta?: Meta, err?: unknown) {
  if (ORDER[level] < threshold()) return;
  const parts = [new Date().toISOString(), level.toUpperCase(), message];
  const extra = formatMeta(meta);
  if (extra) parts.push(extra);
  let line = parts.join(" ");
  if (err instanceof Error) {
    line += `\n${err.stack ?? `${err.name}: ${err.message}`}`;
  } else if (err !== undefined) {
    line += `\n${String(err)}`;
  }
  (level === "error" || level === "warn" ? console.error : console.log)(line);
}

export const logger = {
  debug: (message: string, meta?: Meta) => write("debug", message, meta),
  info: (message: string, meta?: Meta) => write("info", message, meta),
  warn: (message: string, meta?: Meta, err?: unknown) =>
    write("warn", message, meta, err),
  error: (message: string, meta?: Meta, err?: unknown) =>
    write("error", message, meta, err),
};

/** Short random id that links the message a user sees to the matching log entry. */
export function newErrorId(): string {
  return crypto.randomBytes(4).toString("hex");
}

function routeOf(req: Request): string {
  return `${req.method} ${req.originalUrl.split("?")[0]}`;
}

/**
 * Logs an unexpected error with its stack and sends the client a generic 500.
 * The real error text never reaches the browser; the reference id lets someone
 * report the failure and find it in the logs.
 */
export function sendServerError(req: Request, res: Response, err: unknown) {
  const id = newErrorId();
  logger.error("Request failed", { id, route: routeOf(req) }, err);
  if (res.headersSent) return;
  res.status(500).json({
    error: `Something went wrong on the server. Please try again. (Reference: ${id})`,
    errorId: id,
  });
}

/** Logs one line per finished request: method, path, status and duration. */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const meta = { status: res.statusCode, ms: Math.round(ms) };
    const message = routeOf(req);
    if (res.statusCode >= 500) logger.error(message, meta);
    else if (res.statusCode >= 400) logger.warn(message, meta);
    else logger.info(message, meta);
  });
  next();
}

/**
 * Last middleware in the chain. Turns a malformed JSON body into a 400 and logs
 * anything else that escaped a route as a 500.
 */
export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "The request body is not valid JSON." });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "The request body is too large." });
  }
  sendServerError(req, res, err);
}
