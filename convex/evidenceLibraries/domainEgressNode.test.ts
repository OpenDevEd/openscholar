/**
 * Real sockets, real TLS. The pinned client is the one thing standing
 * between a repointed customer domain and our own network, so it is tested
 * against a server rather than a stub.
 *
 * @vitest-environment node
 */
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:https";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPinnedFetch } from "./domainEgressNode";
import { DomainEgressRefused } from "./domainEgress";

const HOST = "evidence.example.org";

let server: Server;
let port: number;
let ca: string;
let directory: string;
let answer: { status: number; body: string } = { status: 200, body: "ok" };
let delayMs = 0;
let served = 0;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "pinned-"));
  const key = join(directory, "key.pem");
  const cert = join(directory, "cert.pem");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", key, "-out", cert, "-days", "1",
    "-subj", `/CN=${HOST}`,
    "-addext", `subjectAltName=DNS:${HOST}`,
  ]);
  ca = readFileSync(cert, "utf8");
  server = createServer(
    { key: readFileSync(key), cert: readFileSync(cert) },
    (request, response) => {
      served += 1;
      setTimeout(() => {
        response.writeHead(answer.status, { "content-type": "text/plain" });
        response.end(answer.body);
      }, delayMs);
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(directory, { recursive: true, force: true });
});

/** A client pinned to where the test server is listening. */
function pinnedToServer() {
  return createPinnedFetch({
    host: HOST,
    addresses: ["127.0.0.1"],
    tlsOptions: { ca },
  });
}

describe("createPinnedFetch", () => {
  it("reaches the pinned address while offering the real name to TLS", async () => {
    answer = { status: 200, body: "hello" };
    const response = await pinnedToServer()(`https://${HOST}:${port}/health`);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("hello");
  });

  it("refuses any other host", async () => {
    const before = served;
    await expect(
      pinnedToServer()(`https://elsewhere.example.org:${port}/health`),
    ).rejects.toBeInstanceOf(DomainEgressRefused);
    expect(served).toBe(before);
  });

  it("refuses plain HTTP", async () => {
    await expect(
      pinnedToServer()(`http://${HOST}:${port}/health`),
    ).rejects.toBeInstanceOf(DomainEgressRefused);
  });

  it("never reaches a server it was not pinned to", async () => {
    // With nothing on its list the connector has nothing to offer, so the
    // request cannot leave however the name resolves. No routing is
    // involved, which is what makes this the same everywhere.
    const before = served;
    const pinned = createPinnedFetch({
      host: HOST,
      addresses: [],
      tlsOptions: { ca },
    });
    await expect(
      pinned(`https://${HOST}:${port}/health`),
    ).rejects.toBeInstanceOf(DomainEgressRefused);
    expect(served).toBe(before);
  });

  it("gives up when the caller does", async () => {
    delayMs = 5_000;
    const controller = new AbortController();
    const pending = pinnedToServer()(`https://${HOST}:${port}/slow`, {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toThrow(/aborted/);
    delayMs = 0;
  });

  it("refuses an answer that is too large, and settles once", async () => {
    answer = { status: 200, body: "x".repeat(300 * 1024) };
    await expect(
      pinnedToServer()(`https://${HOST}:${port}/big`),
    ).rejects.toBeInstanceOf(DomainEgressRefused);
    answer = { status: 200, body: "ok" };
  });
});
