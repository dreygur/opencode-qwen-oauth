import { test, expect, describe } from "bun:test";
import { createPkcePair } from "../src/pkce";

describe("PKCE", () => {
  test("should generate valid PKCE pair", () => {
    const { verifier, challenge } = createPkcePair();

    expect(verifier).toBeTruthy();
    expect(challenge).toBeTruthy();
    expect(typeof verifier).toBe("string");
    expect(typeof challenge).toBe("string");
  });

  test("verifier should be long enough", () => {
    const { verifier } = createPkcePair();
    expect(verifier.length).toBeGreaterThan(40);
  });

  test("challenge should be different from verifier", () => {
    const { verifier, challenge } = createPkcePair();
    expect(challenge).not.toBe(verifier);
  });

  test("should generate unique pairs", () => {
    const pair1 = createPkcePair();
    const pair2 = createPkcePair();

    expect(pair1.verifier).not.toBe(pair2.verifier);
    expect(pair1.challenge).not.toBe(pair2.challenge);
  });

  test("should use URL-safe base64 encoding", () => {
    const { verifier, challenge } = createPkcePair();

    // Should not contain +, /, or =
    expect(verifier).not.toMatch(/[+/=]/);
    expect(challenge).not.toMatch(/[+/=]/);
  });
});
