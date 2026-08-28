import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pc from "picocolors";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ServeOptions {
  host?: string;
  port?: string;
}

export async function serveCommand(options: ServeOptions): Promise<void> {
  const host = options.host || "127.0.0.1";
  const port = options.port || "8765";

  const trainerDir = path.resolve(process.cwd(), "trainer");

  console.log(pc.bold(pc.cyan("\n  exterm trainer")) + pc.dim(` - Listening on http://${host}:${port}\n`));

  const child = spawn(
    "uv",
    ["run", "--directory", trainerDir, "python", "-m", "exterm_trainer", "--host", host, "--port", port],
    {
      stdio: "inherit",
    }
  );

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}
