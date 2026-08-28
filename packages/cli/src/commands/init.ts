import readline from "node:readline";
import pc from "picocolors";
import { matchEnvironments, EnvEntry, ENV_REGISTRY } from "../init/envMatcher.js";
import { selectAlgoDefaults } from "../init/algoDefaults.js";
import { scaffoldProject } from "../init/scaffolder.js";
import path from "node:path";
import { existsSync } from "node:fs";

export interface InitOptions {
  dir?: string;
  yes?: boolean;
}

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
}

function divider() {
  console.log(pc.dim("  " + "?".repeat(62)));
}

function printEnvCard(env: EnvEntry, rank: number, chosen = false) {
  const badge = chosen ? pc.bold(pc.green(" ? ")) : pc.dim(` ${rank}. `);
  const difficulty = {
    easy: pc.green("easy"),
    medium: pc.yellow("medium"),
    hard: pc.red("hard"),
  }[env.difficulty];
  const density = env.rewardDensity === "sparse" ? pc.red("sparse") : pc.green("dense");
  const space = env.actionSpace === "discrete" ? pc.cyan("discrete") : pc.magenta("continuous");

  console.log(
    `${badge}${pc.bold(env.name)} ${pc.dim(`(${env.id})`)}`
  );
  console.log(`      ${pc.dim(env.description)}`);
  console.log(
    `      Action: ${space}  Difficulty: ${difficulty}  Reward: ${density}  Budget: ${pc.yellow(env.defaultSteps.toLocaleString() + " steps")}`
  );
}

export async function initCommand(options: InitOptions): Promise<void> {
  console.log();
  console.log(pc.bold(pc.cyan("  ? exterm init")) + pc.dim(" ? Let's scaffold your RL agent."));
  divider();
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  // Ensure we exit cleanly
  rl.on("close", () => {});

  try {
    // ?? Step 1: Natural language description ??????????????????????????
    console.log(pc.bold("  Step 1/4") + pc.dim(" ? Describe the agent you want to build."));
    console.log(
      pc.dim("  Examples: ") +
        pc.italic(
          '"balance a pole on a cart"  ?  "land a rocket on the moon"  ?  "teach a robot to walk"'
        )
    );
    console.log();

    let description = "";
    while (!description) {
      description = await prompt(rl, pc.white("  > "));
      if (!description) {
        console.log(pc.yellow("  Please describe the agent you want ? even a few words work."));
      }
    }

    // ?? Step 2: Environment matching ??????????????????????????????????
    console.log();
    divider();
    console.log(pc.bold("  Step 2/4") + pc.dim(" ? Matching environments?"));
    console.log();

    const results = matchEnvironments(description);
    const topN = results.slice(0, 3).filter((r) => r.score > 0);
    const hasMatches = topN.length > 0;
    const candidates = hasMatches ? topN : results.slice(0, 3);

    if (hasMatches) {
      console.log(
        `  Found ${pc.bold(String(candidates.length))} environment${candidates.length > 1 ? "s" : ""} matching your description:\n`
      );
    } else {
      console.log(
        `  ${pc.yellow("Couldn't find a strong match.")} Here are the closest environments:\n`
      );
    }

    candidates.forEach((r, i) => printEnvCard(r.env, i + 1));

    console.log();
    let chosenEnv: EnvEntry;

    if (candidates.length === 1 || options.yes) {
      chosenEnv = candidates[0].env;
      console.log(pc.dim(`  Auto-selecting: `) + pc.bold(pc.green(chosenEnv.id)));
    } else {
      // Show list + let user pick
      const choices = candidates.map((r) => r.env.id);

      // Also offer "show all" and "enter ID manually"
      const otherOptions = [
        `${pc.dim("o")} ? show all ${ENV_REGISTRY.length} environments`,
        `${pc.dim("m")} ? enter environment ID manually`,
      ];

      console.log(`  ${pc.dim("Choose")} [${pc.cyan("1")}/${pc.cyan("2")}/${pc.cyan("3")} / o / m]: `);
      let pick = "";
      while (!pick) {
        pick = (await prompt(rl, pc.white("  > "))).toLowerCase();

        if (pick === "1" || pick === "") {
          chosenEnv = candidates[0].env;
        } else if (pick === "2" && candidates.length >= 2) {
          chosenEnv = candidates[1].env;
        } else if (pick === "3" && candidates.length >= 3) {
          chosenEnv = candidates[2].env;
        } else if (pick === "o") {
          console.log();
          ENV_REGISTRY.forEach((env, i) => printEnvCard(env, i + 1));
          console.log();
          pick = "";
          console.log(`  Enter number (1?${ENV_REGISTRY.length}):`);
        } else if (pick === "m") {
          console.log(pc.dim(`  Available IDs: ${ENV_REGISTRY.map((e) => e.id).join(", ")}`));
          const envId = await prompt(rl, pc.white("  Environment ID > "));
          const found = ENV_REGISTRY.find((e) => e.id === envId.trim());
          if (found) {
            chosenEnv = found;
          } else {
            console.log(pc.yellow(`  Unknown ID: ${envId}. Try again.`));
            pick = "";
          }
        } else {
          const idx = parseInt(pick, 10) - 1;
          if (!isNaN(idx) && idx >= 0 && idx < ENV_REGISTRY.length) {
            chosenEnv = ENV_REGISTRY[idx];
          } else {
            console.log(pc.yellow("  Invalid choice, try again."));
            pick = "";
          }
        }
      }
    }

    // ?? Step 3: Algorithm & hyperparameter defaults ????????????????????
    console.log();
    divider();
    console.log(pc.bold("  Step 3/4") + pc.dim(" ? Selecting algorithm?\n"));

    const algo = selectAlgoDefaults(chosenEnv!);

    console.log(
      `  Algorithm: ${pc.bold(pc.magenta(algo.algorithm))}  Policy: ${pc.dim(algo.policy)}`
    );
    console.log(`  ${pc.dim(algo.rationale)}`);
    console.log();

    const hpLines = Object.entries(algo.hyperparameters).map(
      ([k, v]) => `    ${pc.dim(k + ":")} ${pc.white(JSON.stringify(v))}`
    );
    if (hpLines.length) {
      console.log(`  ${pc.dim("Hyperparameters:")}`);
      hpLines.forEach((l) => console.log(l));
      console.log();
    }

    let totalTimesteps = chosenEnv!.defaultSteps;
    if (!options.yes) {
      const stepsAnswer = await prompt(
        rl,
        pc.white(`  Training budget`) +
          pc.dim(` [default ${totalTimesteps.toLocaleString()} steps, press Enter to accept]: `)
      );
      if (stepsAnswer && !isNaN(parseInt(stepsAnswer, 10))) {
        totalTimesteps = parseInt(stepsAnswer, 10);
      }
    } else {
      console.log(pc.dim("  Training budget: ") + pc.white(totalTimesteps.toLocaleString() + " steps (default)"));
    }

    // ?? Step 4: Project name & directory ??????????????????????????????
    console.log();
    divider();
    console.log(pc.bold("  Step 4/4") + pc.dim(" ? Project name & location.\n"));

    const defaultName = chosenEnv!.name.toLowerCase().replace(/\s+/g, "-") + "-agent";
    let projectName: string;
    if (!options.yes) {
      projectName = await prompt(
        rl,
        pc.white("  Project name") + pc.dim(` [${defaultName}]: `)
      ) || defaultName;
    } else {
      projectName = defaultName;
      console.log(pc.dim("  Project name: ") + pc.white(projectName + " (default)"));
    }

    const targetDir = options.dir || path.join(process.cwd(), projectName);

    if (existsSync(targetDir) && !options.yes) {
      const overwrite = await prompt(
        rl,
        pc.yellow(`  Directory ${targetDir} already exists. Overwrite? [y/N]: `)
      );
      if (!overwrite.toLowerCase().startsWith("y")) {
        console.log(pc.dim("\n  Aborted."));
        rl.close();
        process.exit(0);
      }
    }

    // ?? Scaffold ??????????????????????????????????????????????????????
    console.log();
    divider();
    console.log();

    await scaffoldProject(targetDir, {
      projectName,
      description,
      env: chosenEnv!,
      algo,
      totalTimesteps,
    });

    // ?? Summary ???????????????????????????????????????????????????????
    console.log(pc.bold(pc.green("  ? Project scaffolded successfully!\n")));
    console.log(`  ${pc.dim("Location:")} ${pc.white(targetDir)}`);
    console.log(`  ${pc.dim("Files created:")}`);
    console.log(`    ${pc.cyan("exterm.yaml")}  ${pc.dim("? training configuration")}`);
    console.log(`    ${pc.cyan("reward.py  ")}  ${pc.dim("? reward shaping wrapper (edit freely)")}`);
    console.log(`    ${pc.cyan("README.md  ")}  ${pc.dim("? quick-start guide")}`);
    console.log();
    console.log(`  ${pc.bold("Start training:")}`);
    console.log(
      `    ${pc.cyan("cd")} ${path.relative(process.cwd(), targetDir) || "."} ${pc.dim("&&")} ${pc.cyan("exterm train")}`
    );
    console.log();
  } catch (err: any) {
    console.error(pc.red(`\n  ? Error: ${err.message || err}`));
    rl.close();
    process.exit(1);
  }

  rl.close();
  process.exit(0);
}
