import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { logger, sendServerError } from "../src/logger";

function fakeRes() {
  const res = {
    headersSent: false,
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

const req = { method: "POST", originalUrl: "/api/credentials/verify?x=1" } as Request;

describe("logger", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.LOG_LEVEL = "info";
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.LOG_LEVEL = "silent";
  });

  it("writes a timestamped line with level, message and metadata", () => {
    logger.info("Server started", { port: 4000, url: "http://x" });
    const line = String(logSpy.mock.calls[0][0]);
    expect(line).toMatch(
      /^\d{4}-\d{2}-\d{2}T\S+Z INFO Server started port=4000 url=http:\/\/x$/,
    );
  });

  it("quotes metadata values that contain spaces", () => {
    logger.info("x", { route: "GET /api/health" });
    expect(String(logSpy.mock.calls[0][0])).toContain('route="GET /api/health"');
  });

  it("sends warnings and errors to stderr with the stack trace", () => {
    logger.error("Boom", undefined, new Error("disk full"));
    const line = String(errorSpy.mock.calls[0][0]);
    expect(line).toContain("ERROR Boom");
    expect(line).toContain("Error: disk full");
    expect(line).toMatch(/\n\s+at /); // stack frames follow the message
  });

  it("skips entries below LOG_LEVEL", () => {
    process.env.LOG_LEVEL = "warn";
    logger.info("hidden");
    logger.warn("shown");
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("writes nothing when LOG_LEVEL is silent", () => {
    process.env.LOG_LEVEL = "silent";
    logger.error("hidden", undefined, new Error("x"));
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("sendServerError", () => {
  beforeEach(() => {
    process.env.LOG_LEVEL = "info";
  });
  afterEach(() => {
    process.env.LOG_LEVEL = "silent";
  });

  it("logs the real error but sends the client only a generic message and id", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = fakeRes();
    sendServerError(
      req,
      res as unknown as Response,
      new Error('password authentication failed for user "app"'),
    );

    const body = res.body as { error: string; errorId: string };
    expect(res.statusCode).toBe(500);
    expect(body.errorId).toMatch(/^[0-9a-f]{8}$/);
    expect(body.error).toContain(`Reference: ${body.errorId}`);
    expect(body.error).not.toContain("password");

    const line = String(errorSpy.mock.calls[0][0]);
    expect(line).toContain(`id=${body.errorId}`);
    expect(line).toContain('route="POST /api/credentials/verify"'); // no query string
    expect(line).toContain("password authentication failed");
  });

  it("does not try to respond twice", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = fakeRes();
    res.headersSent = true;
    sendServerError(req, res as unknown as Response, new Error("late"));
    expect(res.body).toBeUndefined();
  });
});
