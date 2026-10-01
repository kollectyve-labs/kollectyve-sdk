import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_TEMPLATES,
  checkClaims,
  decodePayload,
  encodePayload,
  template,
  templateForSchema,
  templateSchema,
  buildCredential,
} from "../src/index.js";

describe("templates", () => {
  it("each template has a distinct, stable schema id", () => {
    const ids = CREDENTIAL_TEMPLATES.map(templateSchema);
    expect(new Set(ids).size).toBe(ids.length);
    // Pinned: changing a template's schema silently would orphan credentials issued under it.
    expect(templateSchema(template("university-diploma"))).toMatchInlineSnapshot(`"0x2faf8038d21a9600ea3bfeae760c144a2803ffd1df517e073bfdd5403b99c8f7"`);
    expect(templateForSchema(ids[0]!)?.id).toBe(CREDENTIAL_TEMPLATES[0]!.id);
  });

  it("validates claims for forms and the API", () => {
    const t = template("university-diploma");
    expect(() => checkClaims(t, { name: "Awa" })).toThrow(/Degree is required/);
    expect(() => checkClaims(t, { name: "A", degree: "B", field: "C", graduated: "July" })).toThrow(/YYYY-MM-DD/);
    expect(() => checkClaims(t, { name: "A", degree: "B", field: "C", graduated: "2026-07-01", gpa: "4" })).toThrow(/unknown field gpa/);
    expect(checkClaims(t, { name: " A ", degree: "B", field: "C", graduated: "2026-07-01", honours: "" })).toEqual({
      name: "A",
      degree: "B",
      field: "C",
      graduated: "2026-07-01",
    });
  });
});

describe("offer codes", () => {
  it("round-trips a credential offer compactly enough for one QR", () => {
    const { credential } = buildCredential({
      issuer: 4n,
      subject: 7n,
      schema: templateSchema(template("university-diploma")),
      types: ["UniversityDiploma"],
      claims: { name: "Awa Ndiaye", degree: "Bachelor of Science", field: "Computer Science", graduated: "2026-07-15" },
      network: "testnet",
      authorizedBy: `0x${"98".repeat(32)}`,
    });
    const code = encodePayload({ kind: "cred", value: credential });
    expect(code.startsWith("KW1.cred.")).toBe(true);
    expect(code.length).toBeLessThan(900);
    expect(decodePayload(code)).toEqual({ kind: "cred", value: credential });
  });
});
