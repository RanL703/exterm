import { Command } from "commander";
import { trainCommand } from "./commands/train.js";
import { serveCommand } from "./commands/serve.js";
import { initCommand } from "./commands/init.js";

const program = new Command();

program
  .name("exterm")
  .description("Terminal-native CLI to scaffold, train, and steer reinforcement learning agents")
  .version("0.1.0");

program
  .command("init")
  .description("Conversationally scaffold a new RL agent project")
  .option("-d, --dir <path>", "Target directory (default: ./<project-name>)")
  .option("-y, --yes", "Accept all defaults without prompting")
  .action(initCommand);

program
  .command("train")
  .description("Start or connect to an RL training session")
  .option("-e, --env <envId>", "Gymnasium environment ID", "CartPole-v1")
  .option("-a, --algo <algorithm>", "RL algorithm (PPO, DQN, SAC, etc.)", "PPO")
  .option("-s, --steps <timesteps>", "Total training timesteps budget", "50000")
  .option("-H, --host <url>", "Trainer server HTTP URL", "http://127.0.0.1:8765")
  .option("--no-spawn", "Do not auto-spawn local trainer if not running")
  .option("--seed <seed>", "Random seed for reproducibility")
  .action(trainCommand);

program
  .command("serve")
  .description("Run the exterm trainer server process")
  .option("-h, --host <host>", "Host address to bind", "127.0.0.1")
  .option("-p, --port <port>", "Port to bind", "8765")
  .action(serveCommand);

program.parse(process.argv);
