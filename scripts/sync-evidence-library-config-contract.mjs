#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createContractSnapshot,
  inspectContractCheckout,
  readContractArtifactsAtCommit,
  synchronizeContractSnapshot,
} from "../lib/evidence-libraries/configuration/contract-sync.mjs";

const EXPECTED_REPOSITORY = "https://github.com/OpenDevEd/new-el";
const EXPECTED_BRANCH = "openscholar";
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const options = {
    check: false,
    commit: undefined,
    outputRoot: resolve(projectRoot, "lib/evidence-libraries/configuration"),
    sourceRoot: resolve(projectRoot, "../../new-el-optimize"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    if (["--commit", "--output-root", "--source-root"].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      index += 1;
      if (argument === "--commit") options.commit = value;
      if (argument === "--output-root") options.outputRoot = resolve(value);
      if (argument === "--source-root") options.sourceRoot = resolve(value);
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

async function readExistingLock(outputRoot) {
  const text = await readFile(resolve(outputRoot, "contract-lock.json"), "utf8");
  return JSON.parse(text);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const existingLock = options.check ? await readExistingLock(options.outputRoot) : undefined;
  if (!options.check && !options.commit) {
    throw new Error("--commit is required for mutating contract synchronization");
  }
  const commit = options.commit ?? existingLock?.source?.commit;
  if (!commit) {
    throw new Error("The committed contract lock does not contain a source commit");
  }
  const checkout = await inspectContractCheckout({
    sourceRoot: options.sourceRoot,
    expectedRepository: EXPECTED_REPOSITORY,
    expectedBranch: EXPECTED_BRANCH,
    artifactCommit: commit,
  });
  const artifacts = await readContractArtifactsAtCommit({
    sourceRoot: options.sourceRoot,
    commit,
  });
  const snapshot = createContractSnapshot({
    repository: checkout.repository,
    commit,
    ...artifacts,
    expectedDigests: existingLock
      ? {
          schema: existingLock.artifacts?.schema?.sha256,
          catalogs: existingLock.artifacts?.catalogs?.sha256,
        }
      : undefined,
  });

  await synchronizeContractSnapshot({
    snapshot,
    outputRoot: options.outputRoot,
    inspectedCheckoutCommit:
      existingLock?.source?.inspectedCheckoutCommit ?? checkout.head,
    check: options.check,
  });

  const verb = options.check ? "verified" : "synchronized";
  process.stdout.write(`Evidence Library configuration contract ${verb} at ${commit}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
