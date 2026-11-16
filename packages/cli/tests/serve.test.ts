import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("serve forwards TLS certificate options to the trainer", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "exterm-serve-"));
  try {
    const fakeUv = path.join(tempDir, "uv");
    await writeFile(fakeUv, "#!/bin/sh\nprintf '%s\\n' \"$@\"\n");
    await chmod(fakeUv, 0o755);

    const cliDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const result = spawnSync(process.execPath, ["--import", "tsx", path.join(cliDir, "src/index.ts"), "serve", "--host", "0.0.0.0", "--port", "9876", "--tls", "--cert", "fullchain.pem", "--key", "private.key"], {
      cwd: path.resolve(cliDir, "../.."),
      env: { ...process.env, PATH: `${tempDir}${path.delimiter}${process.env.PATH || ""}` },
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--directory\n.*\/trainer\n/);
    assert.match(result.stdout, /--tls\n--cert\nfullchain\.pem\n--key\nprivate\.key/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
