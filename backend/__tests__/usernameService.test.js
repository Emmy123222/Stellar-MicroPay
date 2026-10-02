/**
 * __tests__/usernameService.test.js
 * Tests for the persistent username service (Issue #1056).
 *
 * Covers: persistence across "restarts" (fresh module load), O(1) index
 * behavior (Map-backed lookups), and the unchanged v1 API contract
 * (validation errors with proper HTTP statuses).
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const G1 = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const G2 = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const G3 = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

// Each test gets an isolated store file via USERNAMES_DATA_FILE.
let dataDir;
let dataFile;

function freshService() {
  jest.resetModules();
  return require("../src/services/usernameService");
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "micropay-usernames-"));
  dataFile = path.join(dataDir, "usernames.json");
  process.env.USERNAMES_DATA_FILE = dataFile;
});

afterEach(() => {
  delete process.env.USERNAMES_DATA_FILE;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("usernameService — persistent storage (Issue #1056)", () => {
  it("registers, resolves, lists, and removes usernames", () => {
    const service = freshService();

    const registered = service.registerUsername("alice", G1);
    expect(registered).toEqual({ username: "alice", publicKey: G1 });

    expect(service.resolveUsername("alice")).toEqual({
      username: "alice",
      publicKey: G1,
    });

    expect(service.getAllUsernames()).toEqual([
      { username: "alice", publicKey: G1 },
    ]);

    expect(service.removeUsername("alice")).toEqual({ username: "alice" });
    expect(() => service.resolveUsername("alice")).toThrow(
      expect.objectContaining({ status: 404 })
    );
  });

  it("survives a server restart — data written by one module load is readable by the next", () => {
    const first = freshService();
    first.registerUsername("alice", G1);
    first.registerUsername("bob42", G2);

    // Writes are debounced; flush so the simulated restart can read them.
    first.flushSync();

    // Simulated restart: fresh module load re-creates the store from disk.
    const second = freshService();
    expect(second.resolveUsername("alice")).toEqual({
      username: "alice",
      publicKey: G1,
    });
    expect(second.resolveUsername("bob42")).toEqual({
      username: "bob42",
      publicKey: G2,
    });
    expect(second.getAllUsernames()).toHaveLength(2);
  });

  it("writes the store file after registration", () => {
    const service = freshService();
    service.registerUsername("persistme", G1);

    // The debounced write is scheduled synchronously after `set`; wait one
    // macrotask for it to fire, then assert the file exists on disk.
    return new Promise((resolve) => setTimeout(resolve, 150)).then(() => {
      expect(fs.existsSync(dataFile)).toBe(true);
      const document = JSON.parse(fs.readFileSync(dataFile, "utf8"));
      expect(document.version).toBe(1);
      expect(document.usernames.persistme.publicKey).toBe(G1);
    });
  });

  it("loads a legacy flat JSON file (username -> publicKey) without data loss", () => {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.writeFileSync(
      dataFile,
      JSON.stringify({ legacyuser: G3 }),
      "utf8"
    );

    const service = freshService();
    expect(service.resolveUsername("legacyuser")).toEqual({
      username: "legacyuser",
      publicKey: G3,
    });
  });

  it("starts empty (and keeps the corrupt file) when the store file is unparseable", () => {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.writeFileSync(dataFile, "{ not valid json !!", "utf8");

    const service = freshService();
    expect(service.getAllUsernames()).toEqual([]);
    // The corrupt file is left in place for manual recovery, not wiped.
    expect(fs.existsSync(dataFile)).toBe(true);
  });

  it("keeps lookups O(1) via the in-memory index (no disk read on resolve)", () => {
    const service = freshService();
    for (let i = 0; i < 500; i++) {
      // Distinct valid-format keys: the public-key uniqueness scan must not
      // reject repeated registrations under the stress load.
      service.registerUsername(`user${i}`, `G${String(i).padStart(55, "0")}`);
    }
    // Map-backed: repeated lookups are constant-time object lookups. We
    // assert correctness here; the structural guarantee lives in
    // src/storage/usernameStore.js (Map over the file contents).
    const start = process.hrtime.bigint();
    for (let i = 0; i < 500; i++) {
      expect(service.resolveUsername(`user${i}`).publicKey).toBe(
        `G${String(i).padStart(55, "0")}`
      );
    }
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    expect(elapsedMs).toBeLessThan(1000); // generous CI bound for 1000 lookups
  });

  it("rejects a public key already registered to another username (409)", () => {
    const service = freshService();
    service.registerUsername("alice", G1);
    expect(() => service.registerUsername("bob42", G1)).toThrow(
      expect.objectContaining({ status: 409 })
    );
  });

  it("rejects duplicate usernames (409)", () => {
    const service = freshService();
    service.registerUsername("alice", G1);
    expect(() => service.registerUsername("alice", G2)).toThrow(
      expect.objectContaining({ status: 409 })
    );
  });

  it("keeps the v1 validation contract (400 with HTTP status)", () => {
    const service = freshService();

    expect(() => service.registerUsername("", G1)).toThrow(
      expect.objectContaining({ status: 400 })
    );
    expect(() => service.registerUsername("ab", G1)).toThrow(
      expect.objectContaining({ status: 400 })
    );
    expect(() => service.registerUsername("bad name!", G1)).toThrow(
      expect.objectContaining({ status: 400 })
    );
    expect(() => service.registerUsername("validname", "not-a-key")).toThrow(
      expect.objectContaining({ status: 400 })
    );
    expect(() => service.resolveUsername(undefined)).toThrow(
      expect.objectContaining({ status: 400 })
    );
  });

  it("does not lose registrations when the public-key uniqueness scan runs", () => {
    const service = freshService();
    service.registerUsername("alice", G1);
    service.registerUsername("bob42", G2);
    // Registering a third distinct user must succeed even though the store
    // already holds two entries.
    expect(service.registerUsername("carol99", G3)).toEqual({
      username: "carol99",
      publicKey: G3,
    });
  });
});
