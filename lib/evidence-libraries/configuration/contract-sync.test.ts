import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  createContractSnapshot,
  inspectContractCheckout,
  readContractArtifactsAtCommit,
  synchronizeContractSnapshot,
} from "./contract-sync.mjs";

const schemaText = `${JSON.stringify({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    schemaVersion: { const: 1 },
    revision: { type: "string" },
    updatedAt: { type: "string" },
    identity: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    },
    theme: { type: "object" },
    localization: { type: "object" },
    footer: { type: "object" },
  },
})}\n`;

const catalogText = `${JSON.stringify({
  schemaVersion: 1,
  catalogVersion: 1,
  fields: { writeOnlyPaths: [] },
})}\n`;

describe("createContractSnapshot", () => {
  test("rejects a moving branch name", () => {
    expect(() =>
      createContractSnapshot({
        repository: "https://github.com/OpenDevEd/new-el",
        commit: "main",
        schemaText,
        catalogText,
      }),
    ).toThrow(/40-character commit SHA/i);
  });

  test("rejects missing repository provenance", () => {
    expect(() =>
      createContractSnapshot({
        repository: "",
        commit: "4a07fd6176d827d3382b392f847639167ec741ed",
        schemaText,
        catalogText,
      }),
    ).toThrow(/repository provenance/i);
  });

  test("rejects a source artifact whose expected digest does not match", () => {
    expect(() =>
      createContractSnapshot({
        repository: "https://github.com/OpenDevEd/new-el",
        commit: "4a07fd6176d827d3382b392f847639167ec741ed",
        schemaText,
        catalogText,
        expectedDigests: {
          schema: "0".repeat(64),
        },
      }),
    ).toThrow(/schema digest mismatch/i);
  });

  test("rejects artifacts whose declared schema versions disagree", () => {
    const mismatchedCatalogText = `${JSON.stringify({
      schemaVersion: 2,
      catalogVersion: 1,
      fields: { writeOnlyPaths: [] },
    })}\n`;

    expect(() =>
      createContractSnapshot({
        repository: "https://github.com/OpenDevEd/new-el",
        commit: "4a07fd6176d827d3382b392f847639167ec741ed",
        schemaText,
        catalogText: mismatchedCatalogText,
      }),
    ).toThrow(/schema version mismatch/i);
  });

  test("rejects a schema that is not JSON Schema draft 2020-12", () => {
    const draftSevenSchemaText = `${JSON.stringify({
      $schema: "http://json-schema.org/draft-07/schema#",
      properties: { schemaVersion: { const: 1 } },
    })}\n`;

    expect(() =>
      createContractSnapshot({
        repository: "https://github.com/OpenDevEd/new-el",
        commit: "4a07fd6176d827d3382b392f847639167ec741ed",
        schemaText: draftSevenSchemaText,
        catalogText,
      }),
    ).toThrow(/draft 2020-12/i);
  });
});

test("writes exact artifact bytes and verifies them without rewriting", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "openscholar-library-contract-"));
  const snapshot = createContractSnapshot({
    repository: "https://github.com/OpenDevEd/new-el",
    commit: "4a07fd6176d827d3382b392f847639167ec741ed",
    schemaText,
    catalogText,
  });

  try {
    await synchronizeContractSnapshot({
      snapshot,
      outputRoot,
      check: false,
    });

    await expect(
      readFile(join(outputRoot, "generated/library-config.schema.json"), "utf8"),
    ).resolves.toBe(schemaText);
    await expect(
      readFile(join(outputRoot, "generated/library-config.catalogs.json"), "utf8"),
    ).resolves.toBe(catalogText);
    await expect(
      readFile(join(outputRoot, "generated/library-config.validator.cjs"), "utf8"),
    ).resolves.toContain("exports.fullValidator");
    const { createRequire } = await import("node:module");
    const generated = createRequire(import.meta.url)(
      join(outputRoot, "generated/library-config.validator.cjs"),
    ) as {
      fullValidator: (input: unknown) => boolean;
      sectionValidators: Record<string, (input: unknown) => boolean>;
    };
    expect(Object.keys(generated.sectionValidators)).toEqual([
      "identity",
      "theme",
      "localization",
      "footer",
    ]);
    expect(generated.sectionValidators.identity!({ name: "Library" })).toBe(
      true,
    );
    expect(
      generated.sectionValidators.identity!({ name: "Library", nope: 1 }),
    ).toBe(false);
    expect(generated.fullValidator({ schemaVersion: 1 })).toBe(true);
    await expect(
      synchronizeContractSnapshot({
        snapshot,
        outputRoot,
        check: true,
      }),
    ).resolves.toEqual({ changed: false });
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("produces identical output when only the local checkout HEAD changes", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "evidence-library-source-"));
  const outputRoot = await mkdtemp(join(tmpdir(), "openscholar-library-contract-"));
  const publicRoot = join(sourceRoot, "public");

  try {
    await mkdir(publicRoot, { recursive: true });
    await writeFile(join(publicRoot, "library-config.schema.json"), schemaText, "utf8");
    await writeFile(join(publicRoot, "library-config.catalogs.json"), catalogText, "utf8");
    execFileSync("git", ["init", "--quiet", sourceRoot]);
    execFileSync("git", ["-C", sourceRoot, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", sourceRoot, "config", "user.name", "Contract Test"]);
    execFileSync("git", ["-C", sourceRoot, "checkout", "--quiet", "-b", "main"]);
    execFileSync("git", ["-C", sourceRoot, "add", "public"]);
    execFileSync("git", ["-C", sourceRoot, "commit", "--quiet", "-m", "artifacts"]);
    execFileSync("git", [
      "-C",
      sourceRoot,
      "remote",
      "add",
      "origin",
      "git@github.com:OpenDevEd/new-el.git",
    ]);
    const artifactCommit = execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    execFileSync("git", [
      "-C",
      sourceRoot,
      "update-ref",
      "refs/remotes/origin/main",
      artifactCommit,
    ]);

    const synchronizeFromCheckout = async () => {
      const checkout = await inspectContractCheckout({
        sourceRoot,
        expectedRepository: "https://github.com/OpenDevEd/new-el",
        expectedBranch: "main",
        artifactCommit,
      });
      const artifacts = await readContractArtifactsAtCommit({
        sourceRoot,
        commit: artifactCommit,
      });
      const snapshot = createContractSnapshot({
        repository: checkout.repository,
        commit: artifactCommit,
        ...artifacts,
      });
      await synchronizeContractSnapshot({ snapshot, outputRoot, check: false });
    };

    await synchronizeFromCheckout();
    const firstLock = await readFile(join(outputRoot, "contract-lock.json"), "utf8");
    const firstReadme = await readFile(join(outputRoot, "generated/README.md"), "utf8");

    await writeFile(join(sourceRoot, "README.md"), "unrelated local change\n", "utf8");
    execFileSync("git", ["-C", sourceRoot, "add", "README.md"]);
    execFileSync("git", ["-C", sourceRoot, "commit", "--quiet", "-m", "local only"]);
    await synchronizeFromCheckout();

    await expect(readFile(join(outputRoot, "contract-lock.json"), "utf8")).resolves.toBe(
      firstLock,
    );
    await expect(readFile(join(outputRoot, "generated/README.md"), "utf8")).resolves.toBe(
      firstReadme,
    );
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("check mode reports drift without repairing the file", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "openscholar-library-contract-"));
  const schemaPath = join(outputRoot, "generated/library-config.schema.json");
  const snapshot = createContractSnapshot({
    repository: "https://github.com/OpenDevEd/new-el",
    commit: "4a07fd6176d827d3382b392f847639167ec741ed",
    schemaText,
    catalogText,
  });

  try {
    await synchronizeContractSnapshot({
      snapshot,
      outputRoot,
      check: false,
    });
    await writeFile(schemaPath, "tampered\n", "utf8");

    await expect(
      synchronizeContractSnapshot({
        snapshot,
        outputRoot,
        check: true,
      }),
    ).rejects.toThrow(/contract drift.*library-config\.schema\.json/i);
    await expect(readFile(schemaPath, "utf8")).resolves.toBe("tampered\n");
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("reads contract bytes from the exact commit instead of the worktree", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "evidence-library-source-"));
  const publicRoot = join(sourceRoot, "public");

  try {
    await mkdir(publicRoot, { recursive: true });
    await writeFile(join(publicRoot, "library-config.schema.json"), schemaText, "utf8");
    await writeFile(join(publicRoot, "library-config.catalogs.json"), catalogText, "utf8");
    execFileSync("git", ["init", "--quiet", sourceRoot]);
    execFileSync("git", ["-C", sourceRoot, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", sourceRoot, "config", "user.name", "Contract Test"]);
    execFileSync("git", ["-C", sourceRoot, "add", "public"]);
    execFileSync("git", ["-C", sourceRoot, "commit", "--quiet", "-m", "add artifacts"]);
    const commit = execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    await writeFile(join(publicRoot, "library-config.schema.json"), "worktree drift\n", "utf8");

    await expect(readContractArtifactsAtCommit({ sourceRoot, commit })).resolves.toEqual({
      schemaText,
      catalogText,
    });
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
  }
});

test("normalizes the verified checkout origin", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "evidence-library-source-"));

  try {
    execFileSync("git", ["init", "--quiet", sourceRoot]);
    execFileSync("git", ["-C", sourceRoot, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", sourceRoot, "config", "user.name", "Contract Test"]);
    execFileSync("git", ["-C", sourceRoot, "checkout", "--quiet", "-b", "main"]);
    await writeFile(join(sourceRoot, "README.md"), "fixture\n", "utf8");
    execFileSync("git", ["-C", sourceRoot, "add", "README.md"]);
    execFileSync("git", ["-C", sourceRoot, "commit", "--quiet", "-m", "fixture"]);
    execFileSync("git", [
      "-C",
      sourceRoot,
      "remote",
      "add",
      "origin",
      "git@github.com:OpenDevEd/new-el.git",
    ]);
    const head = execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    execFileSync("git", [
      "-C",
      sourceRoot,
      "update-ref",
      "refs/remotes/origin/main",
      head,
    ]);

    await expect(
      inspectContractCheckout({
        sourceRoot,
        expectedRepository: "https://github.com/OpenDevEd/new-el",
        expectedBranch: "main",
        artifactCommit: head,
      }),
    ).resolves.toEqual({
      repository: "https://github.com/OpenDevEd/new-el",
    });
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
  }
});

test("rejects a checkout on the wrong branch", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "evidence-library-source-"));

  try {
    execFileSync("git", ["init", "--quiet", sourceRoot]);
    execFileSync("git", ["-C", sourceRoot, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", sourceRoot, "config", "user.name", "Contract Test"]);
    execFileSync("git", ["-C", sourceRoot, "checkout", "--quiet", "-b", "other"]);
    await writeFile(join(sourceRoot, "README.md"), "fixture\n", "utf8");
    execFileSync("git", ["-C", sourceRoot, "add", "README.md"]);
    execFileSync("git", ["-C", sourceRoot, "commit", "--quiet", "-m", "fixture"]);
    execFileSync("git", [
      "-C",
      sourceRoot,
      "remote",
      "add",
      "origin",
      "git@github.com:OpenDevEd/new-el.git",
    ]);
    const head = execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    execFileSync("git", [
      "-C",
      sourceRoot,
      "update-ref",
      "refs/remotes/origin/main",
      head,
    ]);

    await expect(
      inspectContractCheckout({
        sourceRoot,
        expectedRepository: "https://github.com/OpenDevEd/new-el",
        expectedBranch: "main",
        artifactCommit: head,
      }),
    ).rejects.toThrow(/branch mismatch/i);
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
  }
});

test("rejects a checkout from the wrong origin", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "evidence-library-source-"));

  try {
    execFileSync("git", ["init", "--quiet", sourceRoot]);
    execFileSync("git", ["-C", sourceRoot, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", sourceRoot, "config", "user.name", "Contract Test"]);
    execFileSync("git", ["-C", sourceRoot, "checkout", "--quiet", "-b", "main"]);
    await writeFile(join(sourceRoot, "README.md"), "fixture\n", "utf8");
    execFileSync("git", ["-C", sourceRoot, "add", "README.md"]);
    execFileSync("git", ["-C", sourceRoot, "commit", "--quiet", "-m", "fixture"]);
    execFileSync("git", [
      "-C",
      sourceRoot,
      "remote",
      "add",
      "origin",
      "git@github.com:someone-else/new-el.git",
    ]);
    const head = execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    execFileSync("git", [
      "-C",
      sourceRoot,
      "update-ref",
      "refs/remotes/origin/main",
      head,
    ]);

    await expect(
      inspectContractCheckout({
        sourceRoot,
        expectedRepository: "https://github.com/OpenDevEd/new-el",
        expectedBranch: "main",
        artifactCommit: head,
      }),
    ).rejects.toThrow(/origin mismatch/i);
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
  }
});

test("rejects an artifact commit absent from origin/main", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "evidence-library-source-"));

  try {
    execFileSync("git", ["init", "--quiet", sourceRoot]);
    execFileSync("git", ["-C", sourceRoot, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", sourceRoot, "config", "user.name", "Contract Test"]);
    execFileSync("git", ["-C", sourceRoot, "checkout", "--quiet", "-b", "main"]);
    await writeFile(join(sourceRoot, "README.md"), "remote fixture\n", "utf8");
    execFileSync("git", ["-C", sourceRoot, "add", "README.md"]);
    execFileSync("git", ["-C", sourceRoot, "commit", "--quiet", "-m", "remote fixture"]);
    execFileSync("git", [
      "-C",
      sourceRoot,
      "remote",
      "add",
      "origin",
      "git@github.com:OpenDevEd/new-el.git",
    ]);
    const remoteHead = execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    execFileSync("git", [
      "-C",
      sourceRoot,
      "update-ref",
      "refs/remotes/origin/main",
      remoteHead,
    ]);

    await writeFile(join(sourceRoot, "README.md"), "local-only fixture\n", "utf8");
    execFileSync("git", ["-C", sourceRoot, "add", "README.md"]);
    execFileSync("git", ["-C", sourceRoot, "commit", "--quiet", "-m", "local only"]);
    const localOnlyCommit = execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();

    await expect(
      inspectContractCheckout({
        sourceRoot,
        expectedRepository: "https://github.com/OpenDevEd/new-el",
        expectedBranch: "main",
        artifactCommit: localOnlyCommit,
      }),
    ).rejects.toThrow(/artifact commit.*origin\/main/i);
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
  }
});

test("rejects a checkout without origin/main", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "evidence-library-source-"));

  try {
    execFileSync("git", ["init", "--quiet", sourceRoot]);
    execFileSync("git", ["-C", sourceRoot, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", sourceRoot, "config", "user.name", "Contract Test"]);
    execFileSync("git", ["-C", sourceRoot, "checkout", "--quiet", "-b", "main"]);
    await writeFile(join(sourceRoot, "README.md"), "fixture\n", "utf8");
    execFileSync("git", ["-C", sourceRoot, "add", "README.md"]);
    execFileSync("git", ["-C", sourceRoot, "commit", "--quiet", "-m", "fixture"]);
    execFileSync("git", [
      "-C",
      sourceRoot,
      "remote",
      "add",
      "origin",
      "git@github.com:OpenDevEd/new-el.git",
    ]);
    const head = execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();

    await expect(
      inspectContractCheckout({
        sourceRoot,
        expectedRepository: "https://github.com/OpenDevEd/new-el",
        expectedBranch: "main",
        artifactCommit: head,
      }),
    ).rejects.toThrow(/missing refs\/remotes\/origin\/main/i);
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
  }
});
