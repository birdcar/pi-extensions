import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  createProfileProposal,
  reviewedBodyFromText,
  reviewTextForProposal,
  saveApprovedProposal,
  snapshotTarget,
  splitProfileFile,
  type TrainingTarget,
} from "../src/training-store.ts";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "write-for-store-"));
}

describe("write-for training store", () => {
  test("preserves frontmatter and saves exact approved body", async () => {
    const root = temp();
    mkdirSync(join(root, "registers"));
    const path = join(root, "registers", "pro.md");
    writeFileSync(path, "---\nmodel: test/m1\n---\nManual rule stays.\n");
    const target: TrainingTarget = { kind: "register", name: "pro", root };
    const snapshot = await snapshotTarget(target);
    const proposal = createProfileProposal({
      snapshots: [snapshot],
      bodies: { "register:pro": "Manual rule stays.\n\n## Evidence\nA short approved excerpt." },
    });
    const result = await saveApprovedProposal(proposal);
    expect(result.failed).toEqual([]);
    const saved = readFileSync(path, "utf8");
    expect(saved).toStartWith("---\nmodel: test/m1\n---\n");
    expect(splitProfileFile(saved).body).toContain("approved excerpt");
  });

  test("review text shows destination, existing content, and additions/removals", async () => {
    const root = temp();
    mkdirSync(join(root, "registers"));
    const path = join(root, "registers", "pro.md");
    writeFileSync(path, "Manual rule stays.\nOld rule.\n");
    const target: TrainingTarget = { kind: "register", name: "pro", root };
    const snapshot = await snapshotTarget(target);
    const proposal = createProfileProposal({
      snapshots: [snapshot],
      bodies: { "register:pro": "Manual rule stays.\nNew evidence rule." },
    });
    const review = reviewTextForProposal(proposal, snapshot);
    expect(review).toContain(`Destination: ${path}`);
    expect(review).toContain("Existing content:");
    expect(review).toContain("+ New evidence rule.");
    expect(review).toContain("- Old rule.");
    expect(reviewedBodyFromText(review)).toBe("Manual rule stays.\nNew evidence rule.");
  });

  test("rejects stale proposals and unapproved model paths", async () => {
    const root = temp();
    mkdirSync(join(root, "channels"));
    const target: TrainingTarget = { kind: "channel", name: "email", root };
    const snapshot = await snapshotTarget(target);
    expect(() =>
      createProfileProposal({ snapshots: [snapshot], bodies: { "register:pro": "wrong" } }),
    ).toThrow("unapproved");
    const proposal = createProfileProposal({
      snapshots: [snapshot],
      bodies: { "channel:email": "body" },
    });
    writeFileSync(join(root, "channels", "email.md"), "created externally");
    const result = await saveApprovedProposal(proposal);
    expect(result.saved).toEqual([]);
    expect(result.failed[0]?.message).toContain("changed after review");
  });

  test("strips closed generated frontmatter and rejects malformed frontmatter", async () => {
    const root = temp();
    mkdirSync(join(root, "channels"));
    const target: TrainingTarget = { kind: "channel", name: "email", root };
    const snapshot = await snapshotTarget(target);
    const proposal = createProfileProposal({
      snapshots: [snapshot],
      bodies: { "channel:email": "---\nmodel: injected\n---\nBody" },
    });
    expect(proposal.bodies["channel:email"]).toBe("Body");
    expect(() =>
      createProfileProposal({
        snapshots: [snapshot],
        bodies: { "channel:email": "---\nmodel: injected\nBody" },
      }),
    ).toThrow("frontmatter is not closed");
  });
});
