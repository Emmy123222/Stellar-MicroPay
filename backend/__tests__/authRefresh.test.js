/**
 * #779 — refresh tokens must rotate on every use, detect reuse of an
 * already-rotated token by revoking the whole family, and support
 * logging out of every active session ("logout-all").
 */
"use strict";

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const { JWT_SECRET, SIGN_OPTIONS } = require("../src/middleware/auth");
const tokenFamilyStore = require("../src/services/tokenFamilyStore");
const authRoutes = require("../src/routes/auth");

const PUBLIC_KEY = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";

function appWithAuth() {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  return app;
}

// Mirrors issueToken() in src/routes/auth.js without going through the
// SEP-0010 challenge flow, so tests can seed a family + token directly.
function signToken(publicKey, { familyId, jti }, options = {}) {
  return jwt.sign({ publicKey, fam: familyId }, JWT_SECRET, {
    ...SIGN_OPTIONS,
    jwtid: jti,
    ...options,
  });
}

// The token family store is a module-level singleton with no reset hook (by
// design — same as webhookStore.js). Each test uses its own unique "public
// key" so families created in one test can't be picked up by another test's
// revokeAllFamiliesForUser() call.
let userCounter = 0;
function uniqueUser() {
  userCounter += 1;
  return `${PUBLIC_KEY}-test-user-${userCounter}`;
}

function startFamily(publicKey) {
  const { familyId, jti } = tokenFamilyStore.createFamily(publicKey);
  return { familyId, jti, token: signToken(publicKey, { familyId, jti }) };
}

describe("refresh token rotation & revocation (#779)", () => {
  const app = appWithAuth();

  test("normal rotation: a valid refresh token issues a new token, and the chain keeps working", async () => {
    const { token: firstToken } = startFamily(uniqueUser());

    const res1 = await request(app).post("/api/auth/refresh").send({ token: firstToken });
    expect(res1.status).toBe(200);
    expect(res1.body.token).toBeDefined();
    expect(res1.body.token).not.toBe(firstToken);

    // The newly-issued token is itself refreshable — rotation is a chain, not one-shot.
    const res2 = await request(app)
      .post("/api/auth/refresh")
      .send({ token: res1.body.token });
    expect(res2.status).toBe(200);
    expect(res2.body.token).not.toBe(res1.body.token);
  });

  test("the token invalidated by a rotation is rejected if presented again", async () => {
    const { token: firstToken } = startFamily(uniqueUser());

    const rotated = await request(app).post("/api/auth/refresh").send({ token: firstToken });
    expect(rotated.status).toBe(200);

    const reuseOfOldToken = await request(app)
      .post("/api/auth/refresh")
      .send({ token: firstToken });
    expect(reuseOfOldToken.status).toBe(401);
  });

  test("reuse detection: presenting an already-rotated token revokes the entire family", async () => {
    const { token: firstToken } = startFamily(uniqueUser());

    const rotated = await request(app).post("/api/auth/refresh").send({ token: firstToken });
    expect(rotated.status).toBe(200);
    const newToken = rotated.body.token;

    // Reuse the stale, already-rotated token — theft signal.
    const reuse = await request(app).post("/api/auth/refresh").send({ token: firstToken });
    expect(reuse.status).toBe(401);
    expect(reuse.body.code).toBe("token_reuse_detected");

    // The entire family is now dead — even the legitimately-rotated token
    // that followed it must be rejected.
    const afterReuse = await request(app)
      .post("/api/auth/refresh")
      .send({ token: newToken });
    expect(afterReuse.status).toBe(401);
  });

  test("logout-all revokes every family for the user; subsequent refresh attempts fail", async () => {
    const user = uniqueUser();
    const family1 = startFamily(user);
    const family2 = startFamily(user);
    const otherUserFamily = startFamily(uniqueUser());

    const logoutRes = await request(app)
      .post("/api/auth/logout-all")
      .set("Authorization", `Bearer ${family1.token}`);
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.revokedFamilies).toBe(2);

    const refresh1 = await request(app).post("/api/auth/refresh").send({ token: family1.token });
    expect(refresh1.status).toBe(401);

    const refresh2 = await request(app).post("/api/auth/refresh").send({ token: family2.token });
    expect(refresh2.status).toBe(401);

    // Another user's family is untouched.
    const refreshOther = await request(app)
      .post("/api/auth/refresh")
      .send({ token: otherUserFamily.token });
    expect(refreshOther.status).toBe(200);
  });

  test("a token missing family claims (pre-rotation-feature tokens) cannot be refreshed", async () => {
    const legacyToken = jwt.sign({ publicKey: uniqueUser() }, JWT_SECRET, SIGN_OPTIONS);
    const res = await request(app).post("/api/auth/refresh").send({ token: legacyToken });
    expect(res.status).toBe(401);
  });

  test("key rotation: a token signed with a different secret is rejected", async () => {
    const rogueToken = jwt.sign(
      { publicKey: uniqueUser(), fam: "fake-family", jti: "fake-jti" },
      "a-different-signing-key",
      SIGN_OPTIONS
    );
    const res = await request(app).post("/api/auth/refresh").send({ token: rogueToken });
    expect(res.status).toBe(401);
  });
});
