import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pc from "picocolors";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ServeOptions {
  host?: string;
  port?: string;
  tls?: boolean;
  cert?: string;
  key?: string;
}

export async function serveCommand(options: ServeOptions): Promise<void> {
  const host = options.host || "127.0.0.1";
  const port = options.port || "8765";
  const protocol = options.tls ? "https" : "http";

  const trainerDir = path.resolve(process.cwd(), "trainer");

  console.log(pc.bold(pc.cyan("\n  exterm trainer")) + pc.dim(` - Listening on ${protocol}://${host}:${port}\n`));

  const trainerArgs = ["run", "--directory", trainerDir, "python", "-m", "exterm_trainer", "--host", host, "--port", port];
  if (options.tls) trainerArgs.push("--tls");
  if (options.cert) trainerArgs.push("--cert", options.cert);
  if (options.key) trainerArgs.push("--key", options.key);

  const child = spawn(
    "uv",
    trainerArgs,
    {
      stdio: "inherit",
    }
  );

  child.on("exit", (code) => {
    process.exitCode = code ?? 0;
  });
}
