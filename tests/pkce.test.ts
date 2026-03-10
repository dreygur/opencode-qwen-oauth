import { test, describe } from "node:test";
import assert from "node:assert";
import { createPkcePair } from "../src/pkce.js";

describe("PKCE", () => {
  test("should generate valid PKCE pair", () => {
    const { verifier, challenge } = createPkcePair();

    assert.ok(verifier);
    assert.ok(challenge);
    assert.strictEqual(typeof verifier, "string");
    assert.strictEqual(typeof challenge, "string");
  });

  test("verifier should be long enough", () => {
    const { verifier } = createPkcePair();
    assert.ok(verifier.length > 40);
  });

  test("challenge should be different from verifier", () => {
    const { verifier, challenge } = createPkcePair();
    assert.notStrictEqual(challenge, verifier);
  });

  test("should generate unique pairs", () => {
    const pair1 = createPkcePair();
    const pair2 = createPkcePair();

    assert.notStrictEqual(pair1.verifier, pair2.verifier);
    assert.notStrictEqual(pair1.challenge, pair2.challenge);
  });

  test("should use URL-safe base64 encoding", () => {
    const { verifier, challenge } = createPkcePair();

    // Should not contain +, /, or =
    assert.ok(!verifier.match(/[+/=]/));
    assert.ok(!challenge.match(/[+/=]/));
  });
});

