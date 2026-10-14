import { readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, test } from "bun:test";
import { validatePackageArtifact } from "../../scripts/check-package.ts";

describe("write-for package artifact", () => {
  test.each(["@earendil-works/pi-coding-agent", "typebox"])(
    "declares host-provided %s only as a wildcard peer",
    (name) => {
      const manifest = JSON.parse(
        readFileSync(new URL("../../packages/write-for/package.json", import.meta.url), "utf8"),
      ) as {
        dependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      expect(manifest.dependencies?.[name]).toBeUndefined();
      expect(manifest.optionalDependencies?.[name]).toBeUndefined();
      expect(manifest.peerDependencies?.[name]).toBe("*");
    },
  );

  test("ships the extension, public contract, and private document worker", () => {
    const services = validatePackageArtifact({ keepTemp: true });
    try {
      const writer = validatePackageArtifact({
        packagePath: "packages/write-for",
        dependencyTarballs: [services.tarball],
      });
      expect(writer.name).toBe("@birdcar/pi-write-for");
      expect(writer.files).toContain("dist/index.js");
      expect(writer.files).toContain("dist/contract.d.ts");
      expect(writer.files).toContain("dist/document-worker.js");
      expect(
        writer.files.some(
          (file) => file.startsWith("src/") || (file.endsWith(".ts") && !file.endsWith(".d.ts")),
        ),
      ).toBe(false);
    } finally {
      rmSync(dirname(services.tarball), { recursive: true, force: true });
    }
  }, 60_000);
});
