function errorResult(stderr, step) {
    return { error: true, step, stderr }
}

let cwd = process.cwd();
console.log(`process cwd: ${cwd}`);

const Mutex = require('async-mutex').Mutex;
const mutex = new Mutex();
var shell = require('shelljs');

var libCollector = require("./collector");

function BenchContext(app, config) {
    var self = this;
    self.app = app;
    self.config = config;

    self.runTask = function(cmd, title) {
        if (title) app.log(title);

        const { stdout, stderr, code } = shell.exec(cmd, { silent: true });
        var error = false;

        if (code != 0) {
            app.log(`ops.. Something went wrong (error code ${code})`);
            app.log(`stderr: ${stderr}`);
            error = true;
        }

        return { stdout, stderr, error };
    }
}

//::node::import::native::sr25519::transfer_keep_alive::paritydb::small

var BenchConfigs = {
    "import": {
        title: "Import Benchmark (random transfers)",
        branchCommand: 'cargo run --release -p node-bench --quiet -- node::import::native::sr25519::transfer_keep_alive::rocksdb::medium --json'
    },
    "import/small": {
        title: "Import Benchmark (Small block (10tx) with random transfers)",
        branchCommand: 'cargo run --release -p node-bench --quiet -- node::import::native::sr25519::transfer_keep_alive::rocksdb::small --json'
    },
    "import/large": {
        title: "Import Benchmark (Large block (500tx) with random transfers)",
        branchCommand: 'cargo run --release -p node-bench --quiet -- node::import::native::sr25519::transfer_keep_alive::rocksdb::large --json'
    },
    "import/full-wasm": {
        title: "Import Benchmark (Full block with wasm, for weights validation)",
        branchCommand: 'cargo run --release -p node-bench --quiet -- node::import::wasm::sr25519::transfer_keep_alive::rocksdb::full --json'
    },
    "import/wasm": {
        title: "Import Benchmark via wasm (random transfers)",
        branchCommand: 'cargo run --release -p node-bench --quiet -- node::import::wasm::sr25519::transfer_keep_alive::rocksdb::medium --json'
    },
    "ed25519": {
        title: "Import Benchmark (random transfers, ed25519 signed)",
        branchCommand: 'cargo run --release -p node-bench --quiet -- node::import::native::ed25519::transfer_keep_alive::rocksdb::medium --json'
    }
}

const prepareBranch = function(
  {
    contributor,
    owner,
    repo,
    branch,
    baseBranch,
  },
  {
    benchContext
  }
) {
  shell.mkdir("git")
  shell.cd(cwd + "/git")
  benchContext.runTask(`git clone --recursive https://github.com/${owner}/${repo}`, "Cloning git repository...");
  shell.cd(cwd + `/git/${repo}`);

  var { error, stdout } = benchContext.runTask("git rev-parse HEAD");
  if (error) return errorResult(stderr);
  const detachedHead = stdout.trim()

  // Check out to the detached head so that any branch can be deleted
  var { error, stderr } = benchContext.runTask(`git checkout ${detachedHead}`);
  if (error) return errorResult(stderr);

  // Recreate PR remote
  benchContext.runTask(`git remote remove pr`);
  var { error, stderr } = benchContext.runTask(`git remote add pr https://github.com/${contributor}/${repo}.git`);
  if (error) return errorResult(stderr);

  // Fetch and recreate the PR's branch
  benchContext.runTask(`git branch -D ${branch}`);
  var { error, stderr } = benchContext.runTask(`git fetch pr ${branch} && git checkout --track pr/${branch}`, `Checking out ${branch}...`);
  if (error) return errorResult(stderr);

  // Fetch and merge master
  var { error, stderr } = benchContext.runTask(`git pull origin ${baseBranch}`, `Merging branch ${baseBranch}`);
  if (error) return errorResult(stderr);
}

async function benchBranch(app, config) {
    app.log("Waiting our turn to run benchmark...")

    const release = await mutex.acquire();

    try {
        if (config.repo != "substrate") {
            return errorResult("Node benchmarks only available on Substrate.")
        }

        var benchConfig = BenchConfigs[config.id || "import"];
        collector = new libCollector.Collector();

        var benchContext = new BenchContext(app, config);
        console.log(`Started benchmark "${benchConfig.title}."`);

        var error = prepareBranch(config, { benchContext })
        if (error) return error

        var { stderr, error, stdout } = benchContext.runTask(benchConfig.branchCommand, `Benching new branch: ${config.branch}...`);

        await collector.CollectBranchCustomRunner(stdout);

        let report = await collector.Report();
        report = `Benchmark: **${benchConfig.title}**\n\n` + report;

        return report;
    }
    catch (error) {
        return errorResult(error.toString());
    }
    finally {
        release();
    }
}

var SubstrateRuntimeBenchmarkConfigs = {
    "pallet": {
        title: "Benchmark Runtime Pallet",
        branchCommand: [
            'cargo run --release',
            '--features=runtime-benchmarks',
            '--',
            'benchmark',
            'pallet',
            '--chain=parallel-dev',
            '--steps=50',
            '--repeat=20',
            '--pallet={pallet_name}',
            '--extrinsic="*"',
            '--execution=wasm',
            '--wasm-execution=compiled',
            '--heap-pages=4096',
            '--output=./pallets/{pallet_folder}/src/weights.rs',
        ].join(' '),
    },
    "vanilla": {
        title: "Benchmark Vanilla Runtime Substrate Pallet",
        branchCommand: [
            'cargo run --release',
            '--features=runtime-benchmarks',
            '--',
            'benchmark',
            'pallet',
            '--chain=vanilla-dev',
            '--steps=50',
            '--repeat=20',
            '--pallet={pallet_name}',
            '--extrinsic="*"',
            '--execution=wasm',
            '--wasm-execution=compiled',
            '--heap-pages=4096',
            '--output=./runtime/vanilla/src/weights/pallet_{pallet_folder}.rs',
        ].join(' '),
    },
    "parallel": {
        title: "Benchmark Parallel Runtime Substrate Pallet",
        branchCommand: [
            'cargo run --release',
            '--features=runtime-benchmarks',
            '--',
            'benchmark',
            'pallet',
            '--chain=parallel-dev',
            '--steps=50',
            '--repeat=20',
            '--pallet={pallet_name}',
            '--extrinsic="*"',
            '--execution=wasm',
            '--wasm-execution=compiled',
            '--heap-pages=4096',
            '--output=./runtime/parallel/src/weights/pallet_{pallet_folder}.rs',
        ].join(' '),
    },
    "heiko": {
        title: "Benchmark Heiko Runtime Substrate Pallet",
        branchCommand: [
            'cargo run --release',
            '--features=runtime-benchmarks',
            '--',
            'benchmark',
            'pallet',
            '--chain=heiko-dev',
            '--steps=50',
            '--repeat=20',
            '--pallet={pallet_name}',
            '--extrinsic="*"',
            '--execution=wasm',
            '--wasm-execution=compiled',
            '--heap-pages=4096',
            '--output=./runtime/heiko/src/weights/pallet_{pallet_folder}.rs',
        ].join(' '),
    },
    "kerria": {
        title: "Benchmark Kerria Runtime Substrate Pallet",
        branchCommand: [
            'cargo run --release',
            '--features=runtime-benchmarks',
            '--',
            'benchmark',
            'pallet',
            '--chain=kerria-dev',
            '--steps=50',
            '--repeat=20',
            '--pallet={pallet_name}',
            '--extrinsic="*"',
            '--execution=wasm',
            '--wasm-execution=compiled',
            '--heap-pages=4096',
            '--output=./runtime/kerria/src/weights/pallet_{pallet_folder}.rs',
        ].join(' '),
    },
    "custom": {
        title: "Benchmark Runtime Custom",
        branchCommand: 'cargo run --release --features runtime-benchmarks --manifest-path bin/node/cli/Cargo.toml -- benchmark pallet',
    }
}

var PolkadotRuntimeBenchmarkConfigs = {
    "pallet": {
        title: "Benchmark Runtime Pallet",
        branchCommand: [
            'cargo run --release',
            '--features=runtime-benchmarks',
            '--',
            'benchmark',
            'pallet',
            '--chain=polkadot-dev',
            '--steps=50',
            '--repeat=20',
            '--pallet={pallet_name}',
            '--extrinsic="*"',
            '--execution=wasm',
            '--wasm-execution=compiled',
            '--heap-pages=4096',
            '--header=./file_header.txt',
            '--output=./runtime/polkadot/src/weights/{output_file}',
        ].join(' '),
    },
    "polkadot": {
        title: "Benchmark Runtime Polkadot Pallet",
        branchCommand: [
            'cargo run --release',
            '--features=runtime-benchmarks',
            '--',
            'benchmark',
            'pallet',
            '--chain=polkadot-dev',
            '--steps=50',
            '--repeat=20',
            '--pallet={pallet_name}',
            '--extrinsic="*"',
            '--execution=wasm',
            '--wasm-execution=compiled',
            '--heap-pages=4096',
            '--header=./file_header.txt',
            '--output=./runtime/polkadot/src/weights/{output_file}',
        ].join(' '),
    },
    "kusama": {
        title: "Benchmark Runtime Kusama Pallet",
        branchCommand: [
            'cargo run --release',
            '--features=runtime-benchmarks',
            '--',
            'benchmark',
            'pallet',
            '--chain=kusama-dev',
            '--steps=50',
            '--repeat=20',
            '--pallet={pallet_name}',
            '--extrinsic="*"',
            '--execution=wasm',
            '--wasm-execution=compiled',
            '--heap-pages=4096',
            '--header=./file_header.txt',
            '--output=./runtime/kusama/src/weights/{output_file}',
        ].join(' '),
    },
    "westend": {
        title: "Benchmark Runtime Westend Pallet",
        branchCommand: [
            'cargo run --release',
            '--features=runtime-benchmarks',
            '--',
            'benchmark',
            'pallet',
            '--chain=westend-dev',
            '--steps=50',
            '--repeat=20',
            '--pallet={pallet_name}',
            '--extrinsic="*"',
            '--execution=wasm',
            '--wasm-execution=compiled',
            '--heap-pages=4096',
            '--header=./file_header.txt',
            '--output=./runtime/westend/src/weights/{output_file}',
        ].join(' '),
    },
    "custom": {
        title: "Benchmark Runtime Custom",
        branchCommand: 'cargo run --release --features runtime-benchmarks -- benchmark pallet',
    }
}

function checkRuntimeBenchmarkCommand(command) {
    let required = ["benchmark", "pallet", "--pallet", "--extrinsic", "--execution", "--wasm-execution", "--steps", "--repeat", "--chain"];
    let missing = [];
    for (const flag of required) {
        if (!command.includes(flag)) {
            missing.push(flag);
        }
    }

    return missing;
}

function checkAllowedCharacters(command) {
    let banned = ["#", "&", "|", ";"];
    for (const token of banned) {
        if (command.includes(token)) {
            return false;
        }
    }

    return true;
}

async function benchmarkRuntime(app, config) {
    app.log("Waiting our turn to run benchmark...")

    const release = await mutex.acquire();

    try {
        if (config.extra.split(" ").length < 2) {
            return errorResult(`Incomplete command.`)
        }

        let command = config.extra.split(" ")[0];

        var benchConfig;
        if (config.repo == "parallel") {
            benchConfig = SubstrateRuntimeBenchmarkConfigs[command];
        } else if (config.repo == "polkadot") {
            benchConfig = PolkadotRuntimeBenchmarkConfigs[command];
        } else {
            return errorResult(`${config.repo} repo is not supported.`)
        }

        var extra = config.extra.split(" ").slice(1).join(" ").trim();

        if (!checkAllowedCharacters(extra)) {
            return errorResult(`Not allowed to use #&|; in the command!`);
        }

        // Append extra flags to the end of the command
        let branchCommand = benchConfig.branchCommand;
        if (command == "custom") {
            // extra here should just be raw arguments to add to the command
            branchCommand += " " + extra;
        } else {
            branchCommand = branchCommand.replace("cargo", config.cargo);
            // extra here should be the name of a pallet
            branchCommand = branchCommand.replace("{pallet_name}", extra);
            // custom output file name so that pallets with path don't cause issues
            let outputFile = extra.includes("::") ? extra.replace("::", "_") + ".rs" : '';
            branchCommand = branchCommand.replace("{output_file}", outputFile);
            // pallet folder should be just the name of the pallet, without the leading
            // "pallet_" or "frame_", then separated with "-"
            let palletFolder = extra.split("_").slice(1).join("-").trim();
            branchCommand = branchCommand.replace("{pallet_folder}", palletFolder);
        }

        let missing = checkRuntimeBenchmarkCommand(branchCommand);
        let output = branchCommand.includes("--output");

        if (missing.length > 0) {
            return errorResult(`Missing required flags: ${missing.toString()}`)
        }

        var benchContext = new BenchContext(app, config);
        console.log(`Started runtime benchmark "${benchConfig.title}."`);

        var error = prepareBranch(config, { benchContext })
        if (error) return error

        var { error, stdout, stderr } = benchContext.runTask(branchCommand, `Benching branch: ${config.branch}...`);

        // If `--output` is set, we commit the benchmark file to the repo
        if (output) {
            const regex = /--output(?:=|\s+)(".+?"|\S+)/;
            const path = branchCommand.match(regex)[1];
            benchContext.runTask(`git add ${path}`, `Adding new files.`);
            benchContext.runTask(`git commit -m "${branchCommand}"`, `Committing changes.`);
            if (config.pushToken) {
                benchContext.runTask(`git push https://${config.pushToken}@github.com/${config.contributor}/${config.repo}.git HEAD`, `Pushing commit with pushToken.`);
            } else {
                benchContext.runTask(`git push`, `Pushing commit.`);
            }
        }
        let report = `Benchmark: **${benchConfig.title}**\n\n`
            + branchCommand
            + "\n\n<details>\n<summary>&#10132; Results</summary>\n\n"
            + (stdout ? stdout : stderr)
            + "\n\n </details>";

        return report;
    }
    catch (error) {
        return errorResult(error.toString());
    }
    finally {
        release();
    }
}

module.exports = {
    benchBranch: benchBranch,
    benchmarkRuntime: benchmarkRuntime,
};
