import { bytesToHex, type H256Hex } from "@kollectyve/core";
import { blake2_256, canonicalize, CredentialError } from "./canonical.js";

/**
 * Credential templates: what an issuer can issue without designing a schema.
 *
 * A template is a JSON Schema for `credentialSubject` plus form metadata. Its on-chain schema id
 * is `blake2_256(JCS(jsonSchema))`, so the issuer web app, the issuer API and any other
 * implementation compute the same id from the same template. Changing a template's schema makes
 * it a new schema: bump `version`, never edit one in place.
 */

export interface TemplateField {
  key: string;
  label: string;
  type: "string" | "date";
  required: boolean;
  /** Shown as the input's placeholder. */
  example?: string;
}

export interface CredentialTemplate {
  id: string;
  version: number;
  /** The VC `type` added after `VerifiableCredential`. */
  vcType: string;
  title: string;
  description: string;
  fields: TemplateField[];
}

function jsonSchema(t: CredentialTemplate): object {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `kollectyve:template:${t.id}:v${t.version}`,
    title: t.title,
    type: "object",
    properties: {
      id: { type: "string" },
      ...Object.fromEntries(
        t.fields.map((f) => [f.key, f.type === "date" ? { type: "string", format: "date" } : { type: "string" }]),
      ),
    },
    required: ["id", ...t.fields.filter((f) => f.required).map((f) => f.key)],
  };
}

/** The on-chain schema id of a template. */
export function templateSchema(t: CredentialTemplate): H256Hex {
  return bytesToHex(blake2_256(new TextEncoder().encode(canonicalize(jsonSchema(t)))));
}

export const CREDENTIAL_TEMPLATES: CredentialTemplate[] = [
  {
    id: "university-diploma",
    version: 1,
    vcType: "UniversityDiploma",
    title: "University diploma",
    description: "A degree awarded by a university or school.",
    fields: [
      { key: "name", label: "Holder's full name", type: "string", required: true, example: "Awa Ndiaye" },
      { key: "degree", label: "Degree", type: "string", required: true, example: "Bachelor of Science" },
      { key: "field", label: "Field of study", type: "string", required: true, example: "Computer Science" },
      { key: "graduated", label: "Graduation date", type: "date", required: true, example: "2026-07-15" },
      { key: "honours", label: "Honours", type: "string", required: false, example: "Magna cum laude" },
    ],
  },
  {
    id: "professional-certificate",
    version: 1,
    vcType: "ProfessionalCertificate",
    title: "Professional certificate",
    description: "A course, training or certification completed.",
    fields: [
      { key: "name", label: "Holder's full name", type: "string", required: true, example: "Moussa Diop" },
      { key: "certificate", label: "Certificate", type: "string", required: true, example: "Cloud Infrastructure Fundamentals" },
      { key: "completed", label: "Completion date", type: "date", required: true, example: "2026-09-30" },
      { key: "level", label: "Level or grade", type: "string", required: false, example: "Advanced" },
    ],
  },
  {
    id: "membership",
    version: 1,
    vcType: "Membership",
    title: "Membership",
    description: "Membership of an organisation, association or cooperative.",
    fields: [
      { key: "name", label: "Member's full name", type: "string", required: true, example: "Fatou Sow" },
      { key: "organisation", label: "Organisation", type: "string", required: true, example: "Dakar Developers Association" },
      { key: "role", label: "Role", type: "string", required: false, example: "Member" },
      { key: "since", label: "Member since", type: "date", required: true, example: "2025-01-01" },
    ],
  },
  {
    id: "institution-accreditation",
    version: 1,
    vcType: "InstitutionAccreditation",
    title: "Institution accreditation",
    description: "An authority recognises an institution as entitled to issue credentials.",
    fields: [
      { key: "name", label: "Institution name", type: "string", required: true, example: "DAUST" },
      { key: "scope", label: "Accredited to issue", type: "string", required: true, example: "University diplomas" },
    ],
  },
];

export function template(id: string): CredentialTemplate {
  const t = CREDENTIAL_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new CredentialError(`unknown template ${id}`);
  return t;
}

/** The template a schema id belongs to, if it is one of ours. */
export function templateForSchema(schema: string): CredentialTemplate | undefined {
  return CREDENTIAL_TEMPLATES.find((t) => templateSchema(t) === schema);
}

/** Validate and normalise claims for a template. Throws with a message fit for a form or API. */
export function checkClaims(t: CredentialTemplate, claims: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of t.fields) {
    const raw = claims[f.key];
    const v = typeof raw === "string" ? raw.trim() : raw === undefined || raw === null ? "" : String(raw);
    if (!v) {
      if (f.required) throw new CredentialError(`${f.label} is required`);
      continue;
    }
    if (v.length > 200) throw new CredentialError(`${f.label} is too long`);
    if (f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new CredentialError(`${f.label} must be a date (YYYY-MM-DD)`);
    out[f.key] = v;
  }
  const unknown = Object.keys(claims).filter((k) => !t.fields.some((f) => f.key === k));
  if (unknown.length) throw new CredentialError(`unknown field ${unknown.join(", ")}`);
  return out;
}
