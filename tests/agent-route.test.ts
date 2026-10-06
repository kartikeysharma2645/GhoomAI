/**
 * Route-level tests for POST /api/agent.
 * Validation and orchestration-plumbing paths only — live capability
 * execution is covered by orchestrator service tests with fakes plus a
 * controlled smoke test. Never reaches the network here.
 */
import { describe, expect, it } from "vitest";
import { POST } from "../app/api/agent/route";
import { createEmptySession } from "../src/server/agent/session";

function post(body: string): Request {
  return new Request("http://localhost/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("POST /api/agent", () => {
  it("rejects malformed JSON with 400", async () => {
    const res = await POST(post("{not-json"));
    expect(res.status).toBe(400);
  });

  it("rejects a missing session or message with 400", async () => {
    const session = createEmptySession();
    const noMessage = await POST(post(JSON.stringify({ session })));
    expect(noMessage.status).toBe(400);
    const noSession = await POST(post(JSON.stringify({ message: "hi" })));
    expect(noSession.status).toBe(400);
  });

  it("rejects an invalid session with 400", async () => {
    const res = await POST(
      post(JSON.stringify({ session: { sessionVersion: 99 }, message: "hi" })),
    );
    expect(res.status).toBe(400);
  });

  it("rejects an oversized image payload with 400", async () => {
    const res = await POST(
      post(
        JSON.stringify({
          session: createEmptySession(),
          message: "What is this?",
          imageBase64: "a".repeat(12_000_001),
        }),
      ),
    );
    expect(res.status).toBe(400);
  });

  it("answers out_of_scope turns without any service call", async () => {
    const res = await POST(
      post(
        JSON.stringify({ session: createEmptySession(), message: "Write a poem" }),
      ),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data: { intent: string; outcome: string; session: { transcript: unknown[] } };
    };
    expect(json.ok).toBe(true);
    expect(json.data.intent).toBe("out_of_scope");
    expect(json.data.outcome).toBe("out_of_scope");
    expect(json.data.session.transcript).toHaveLength(2);
  });

  it("rejects a mismatched confirmation without executing", async () => {
    const res = await POST(
      post(
        JSON.stringify({
          session: createEmptySession(),
          message: "Yes",
          confirm: { action: "activate_trip" },
        }),
      ),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data: { outcome: string };
    };
    expect(json.data.outcome).toBe("confirmation_rejected");
  });

  it("processes an image turn without storing the image", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const res = await POST(
      post(
        JSON.stringify({
          session: createEmptySession(),
          message: "What is this monument?",
          imageBase64: Buffer.from(binary, "binary").toString("base64"),
          imageMimeType: "image/jpeg",
        }),
      ),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data: { outcome: string; errorCode?: string; session: object };
    };
    // No vision provider in this environment: honest failed outcome.
    expect(json.data.outcome).toBe("failed");
    expect(json.data.errorCode).toBe("VISION_NOT_CONFIGURED");
    expect(JSON.stringify(json.data.session)).not.toContain("base64");
  });
});
