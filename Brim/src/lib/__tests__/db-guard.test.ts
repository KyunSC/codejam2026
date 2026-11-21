import { describe, expect, it } from "vitest";
import { assertLocalDbIfRequired, assertLocalSeedTarget, dbHost } from "../db-guard";

const LOCAL = "postgresql://postgres:brim@localhost:5433/brim";
const REMOTE = "postgresql://u:p@ep-example-123.us-east-2.aws.neon.tech/db?sslmode=require";

describe("assertLocalDbIfRequired", () => {
  it("does nothing unless BRIM_LOCAL_DB_ONLY=1", () => {
    expect(() => assertLocalDbIfRequired({ DATABASE_URL: REMOTE })).not.toThrow();
    expect(() => assertLocalDbIfRequired({ BRIM_LOCAL_DB_ONLY: "0", DATABASE_URL: REMOTE })).not.toThrow();
  });

  it.each([
    ["localhost", LOCAL],
    ["127.0.0.1", "postgresql://postgres:brim@127.0.0.1:5433/brim"],
    ["::1", "postgresql://postgres:brim@[::1]:5433/brim"],
  ])("allows %s", (_name, url) => {
    expect(() =>
      assertLocalDbIfRequired({ BRIM_LOCAL_DB_ONLY: "1", DATABASE_URL: url, DATABASE_URL_UNPOOLED: url }),
    ).not.toThrow();
  });

  it("refuses a remote pooled URL", () => {
    expect(() => assertLocalDbIfRequired({ BRIM_LOCAL_DB_ONLY: "1", DATABASE_URL: REMOTE })).toThrow(
      /DATABASE_URL points at ep-example-123/,
    );
  });

  it("refuses a remote direct URL even when the pooled one is local", () => {
    expect(() =>
      assertLocalDbIfRequired({ BRIM_LOCAL_DB_ONLY: "1", DATABASE_URL: LOCAL, DATABASE_URL_UNPOOLED: REMOTE }),
    ).toThrow(/DATABASE_URL_UNPOOLED/);
  });

  it("refuses a URL that does not parse", () => {
    expect(() => assertLocalDbIfRequired({ BRIM_LOCAL_DB_ONLY: "1", DATABASE_URL: "not a url" })).toThrow(
      /does not parse/,
    );
  });

  it("ignores blank variables", () => {
    expect(() => assertLocalDbIfRequired({ BRIM_LOCAL_DB_ONLY: "1", DATABASE_URL: "  " })).not.toThrow();
  });
});

describe("dbHost", () => {
  it("reads the host name", () => {
    expect(dbHost(LOCAL)).toBe("localhost");
    expect(dbHost("nope")).toBeNull();
  });
});

describe("destructive seed target", () => {
  it("requires explicit local mode and a local URL", () => {
    expect(() => assertLocalSeedTarget({ DATABASE_URL: LOCAL })).toThrow();
    expect(() => assertLocalSeedTarget({ BRIM_LOCAL_DB_ONLY: "1", DATABASE_URL: REMOTE })).toThrow();
    expect(() => assertLocalSeedTarget({ BRIM_LOCAL_DB_ONLY: "1", DATABASE_URL: LOCAL })).not.toThrow();
  });
});
