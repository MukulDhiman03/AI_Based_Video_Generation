import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { bundle } from "@remotion/bundler";
import { selectComposition } from "@remotion/renderer";

const root = process.cwd();
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "vidsutra-clean-"));
try {
  // Stage only source/configuration. Reuse installed dependencies, but no
  // ignored generated assets, environment files, build caches, or declarations.
  await fs.cp(path.join(root, "src"), path.join(workspace, "src"), {
    recursive: true,
  });
  await fs.copyFile(
    path.join(root, "tsconfig.json"),
    path.join(workspace, "tsconfig.json"),
  );
  await fs.copyFile(
    path.join(root, "package.json"),
    path.join(workspace, "package.json"),
  );
  await fs.mkdir(path.join(workspace, "scripts"));
  await fs.copyFile(
    path.join(root, "scripts/render.mjs"),
    path.join(workspace, "scripts/render.mjs"),
  );
  await fs.mkdir(path.join(workspace, "public"));
  await fs.symlink(
    path.join(root, "node_modules"),
    path.join(workspace, "node_modules"),
    "dir",
  );
  await assert.rejects(
    fs.access(path.join(workspace, "public/generated/plan.json")),
  );

  const typecheck = spawnSync(
    process.execPath,
    [
      path.join(root, "node_modules/typescript/bin/tsc"),
      "--project",
      path.join(workspace, "tsconfig.json"),
      "--noEmit",
      "--incremental",
      "false",
    ],
    { cwd: workspace, encoding: "utf8" },
  );
  assert.equal(typecheck.status, 0, typecheck.stdout + typecheck.stderr);
  console.log(
    "PASS: typecheck without generated assets, environment files, or Next build artifacts.",
  );

  const missingPlan = spawnSync(process.execPath, ["scripts/render.mjs"], {
    cwd: workspace,
    encoding: "utf8",
  });
  assert.notEqual(missingPlan.status, 0);
  assert.match(missingPlan.stderr, /Run npm run generate before rendering/);
  console.log(
    "PASS: rendering without a plan fails with an actionable message.",
  );

  const serveUrl = await bundle({
    entryPoint: path.join(workspace, "src/index.tsx"),
    publicDir: path.join(workspace, "public"),
    outDir: path.join(workspace, "bundle"),
  });
  console.log("PASS: Remotion bundles without generated assets.");

  if (process.argv.includes("--metadata")) {
    // This opt-in smoke check needs Remotion's headless browser. It checks the
    // real composition, not a mock, without narration files or provider calls.
    const plan = {
      title: "Runtime input regression",
      voice: "viraj",
      fps: 24,
      width: 540,
      height: 960,
      duration: 2,
      words: [{ text: "Test", start: 0, end: 1 }],
      scenes: [
        {
          title: "Runtime input",
          label: "TEST",
          kind: "intro",
          from: 0,
          to: 48,
        },
      ],
    };
    const composition = await selectComposition({
      serveUrl,
      id: "InternetExplainer",
      inputProps: { plan },
    });
    assert.equal(composition.fps, 24);
    assert.equal(composition.width, 540);
    assert.equal(composition.height, 960);
    assert.equal(composition.durationInFrames, 48);
    assert.equal(composition.props.plan.title, plan.title);
    await assert.rejects(
      selectComposition({ serveUrl, id: "InternetExplainer", inputProps: {} }),
      /valid render plan is required/,
    );
    console.log(
      "PASS: runtime plan controls composition metadata; missing input is rejected.",
    );
  }
} finally {
  await fs.rm(workspace, { recursive: true, force: true });
}
