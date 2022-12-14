# Integration Testing a Write Only DB

Notes and thoughts on writing integration tests with TigerBeetle.


## The Challenge

One of the primary reasons for choosing TigerBeetle was for the ability to run it locally.

Other ledgers I evaluated either required our tests to call a live API (great for simple tests but doesn't scale to large teams or automated tests), or spin up a flock of docker containers in order to run a local ledger. There's another post I'm yet to write about my choices for TigerBeetle, and where it fits in the spectrum of ledger databases, so I won't go into all of the choices here.

During my evaluation phase of TigerBeetle, when I tried to write integration tests for services which created Accounts or Transfers in TigerBeetle, I ran into a problem: TigerBeetle has no `TRUNCATE` or `DELETE`!

I can see the appeal of an append only ledger for the critical business functions that TigerBeetle will handle, but in order to adequately test our code that depends on TigerBeetle, we need a way to either isolate our tests from one another or reset the database in between tests.


## The Approach

When I'm writing integration tests that depend on external services (say, for example, a MySQL database), I normally do something like the following:

1. Spin up the dependencies with `docker-compose up -d`
2. Start the test runner: `jest ./test --runInBand` [todo: double check command]
  - `--runInBand` makes sure that Jest runs only one file at a time, so no two files will contend over the database
  - Additionally, each test case, or test file is responsible for cleaning up after itself, either by keeping track of the rows that they created and deleting them from the database table, or (if I'm too lazy), truncating each table in the database.
3. Pass/Fail the tests based on the results.

### Inspiration from SQL-Lite

Another approach that I've seen is to use an in-memory version of a database for integration tests, and that's the approach that inspired this post.

<!-- TODO: insert screenshot of this feature request on GitHub -->

This has the added improved developer experience of spinning up the dependencies inside the scope of each test file, so there's no need to run something like `docker-compose up -d` _before_ running the tests. It's easier to create a test experience that 'just works'.

## The Code

For this example, let's use Typescript with Jest as our test runner. As you'll see, this approach could easily be adapted for other languages and test runners, since all we are doing is calling the local TigerBeetle executable with `os.exec`. 


### First Pass - Spawning an instance

Let's start with a simple test file, `example_1.test.ts`:

```ts
import { Client, createClient } from "tigerbeetle-node"
import NativeTBRunner, { RunningTBResult } from "./TBRunner"

describe('TigerBeetle', () => {
  const runner = new NativeTBRunner()
  let instance: RunningTBResult
  let client: Client

  beforeEach(async () => {
    instance = await runner.spawnTBInstance();
    client = createClient({
      cluster_id: 0,
      replica_addresses: [instance.port]
    })
  })

  it('has spawned the tb instance', async () => {
    console.log(instance)
  })
})
```

_note: you can find the full working code examples in the associated Github repo [here](TODO: link)_

You can see here, in the `beforeEach()` hook, that we are spawning a new TigerBeetle instance for each individual test.

This test file depends on the following file `TBRunner.ts`:

```ts
import * as fs from 'fs';
import * as net from "net";
import { mkdtemp } from 'node:fs/promises';
import * as os from 'os';

import * as child_process from 'node:child_process';
import * as path from 'path';

export interface RunOptions {
  // Defaults to ./node_modules/tigerbeetle-node/tigerbeetle
  pathToTBBinary?: string,
  // Will be assigned a random clusterId if not set
  clusterId?: bigint,
  // Will be assigned a random port if not set
  port?: number,
  // data file path, will default to a temporary directory
  pathToTigerBeetleFile?: string
}

export interface RunningTBResult {
  process: child_process.ChildProcessWithoutNullStreams,
  pid: number,
  port: number
}

/**
 * @class TBRunner
 * @description Runs a locally installed binary of TigerBeetle
 *   Exposes the same interface as ContainerRunner, but just 
 *   without the containers!
 */
export default class TBRunner {
  // A map of pid -> RunningTBResult
  private _tbInstances: Record<string, RunningTBResult>

  constructor() {
    this._tbInstances = {}
  }

  /**
   * @description Spawns a single instance TB container and waits
   *   for it to be ready
   */
  public async spawnTBInstance(options: RunOptions = {}): Promise<RunningTBResult> {
    // sensible defaults
    let pathToTBBinary = process.env.PATH_TO_TIGERBEETLE 
    fs.statSync(pathToTBBinary)

    let clusterId = 0n
    
    let port = options.port
    if (!port) {
      port = await this._getRandomFreePort()
    }
    
    let pathToTigerBeetleFile = options.pathToTigerBeetleFile
    if (!pathToTigerBeetleFile) {
      const tmpDir = await this._openTempDir()
      pathToTigerBeetleFile = `${tmpDir}/0_0.tigerbeetle`
    }

    // format the file
    // equivalent to running:
    // `./tigerbeetle format --cluster=0 --replica=0 0_0.tigerbeetle`
    const formatCmd = [
      pathToTBBinary,
      'format',
      `--cluster=${clusterId.toString()}`,
      `--replica=0`,
      pathToTigerBeetleFile
    ]
    console.log(`execSync cmd: ${formatCmd.join(' ')}`)
    const formatResult = child_process.execSync(formatCmd.join(' '), {
      stdio: 'pipe'
    })
    console.log(`spawnTBInstance format output is: ${formatResult.toString('utf-8')}`)

    // start tigerbeetle
    // equivalent to running:
    // `./tigerbeetle start --addresses=0.0.0.0:3000 0_0.tigerbeetle`
    const startCmd = [
      'start',
      `--addresses=0.0.0.0:${port}`,
      pathToTigerBeetleFile
    ]
    console.log(`spawn cmd: ${pathToTBBinary} ${startCmd.join(' ')}`)
    const tbStartProcess = child_process.spawn(
      pathToTBBinary,
      startCmd
    )
    
    console.log('sleeping for 2s to wait for TB to be up!')
    // TODO can we improve this?
    // await testSleep(2 * 1000)

    tbStartProcess.stdout.on('data', (data) => {
      console.log(`stdout: ${data}`);
    });

    tbStartProcess.stderr.on('data', (data) => {
      console.log(`stderr: ${data}`);
    });

    tbStartProcess.on('close', (code) => {
      console.log(`child process exited with code ${code}`);
      // Clean up the file
      fs.rmSync(pathToTigerBeetleFile!)
    });
    
    const result = {
      process: tbStartProcess,
      pid: tbStartProcess.pid,
      port
    }
    // Save internally in case we want to be able to kill all TB Instances
    this._tbInstances[tbStartProcess.pid] = result

    return result
  }

  /**
   * @description Kill a running tb instance process
   */
  public async killTBInstance(instance: RunningTBResult): Promise<void> {
    instance.process.kill('SIGTERM')
  }


  /**
   * @description Cleans up all instances of TigerBeetle
   */
  public async cleanUp() {
    // Not sure if we'll need this
    await Promise.all(Object.values(this._tbInstances)
      .map(i => this.killTBInstance(i)))
  }

  /**
   * @description Looks for an open port by sneakily starting a server with a random
   *   port and quickly closing it. Very nice and sneaky.
   */
  public async _getRandomFreePort(): Promise<number> {
    return new Promise((res, rej) => {
      const srv = net.createServer();
      srv.listen(0, () => {
        const address = srv.address()
        if (address === null || typeof address === 'string') {
          console.log('createServer() failed')
          rej(new Error('createServer() failed.'))
          return
        }
        const port = address.port

        // Then close the server
        srv.close((err) => {
          if (err) {
            console.log(err)
            rej(err)
            return
          }
          res(port)
        })
      });
    })
  }

  /**
   * @description Create a random temporary directory
   */
  public async _openTempDir(): Promise<string> {
    const tmpDir = os.tmpdir()
    return await mkdtemp(path.join(tmpDir, 'foo-'));
  }
}
```

In these ~170 lines we define a `TBRunner` class, which is responsbile for spawning and keeping track of multiple instances of TigerBeetle.

The main magic is here inside `spawnTBInstance()`, with the following sections:

```ts
const formatCmd = [
  pathToTBBinary,
  'format',
  `--cluster=${clusterId.toString()}`,
  `--replica=0`,
  pathToTigerBeetleFile
]
const formatResult = child_process.execSync(formatCmd.join(' '), {stdio: 'pipe'})
```

Which is NodeJS for `./tigerbeetle format --cluster=0 --replica=0 0_0.tigerbeetle`,

And:

```ts 
// ...
const startCmd = [
  'start',
  `--addresses=0.0.0.0:${port}`,
  pathToTigerBeetleFile
]
console.log(`spawn cmd: ${pathToTBBinary} ${startCmd.join(' ')}`)
const tbStartProcess = child_process.spawn( pathToTBBinary, startCmd)
// ...
```

Which is our way of running `./tigerbeetle start --addresses=0.0.0.0:3000 0_0.tigerbeetle`.

The other code around these two commands sets some sensible defaults, finds a random free port to run TigerBeetle on, 
and creates a temporary directory to put the `.tigerbeetle` file.


### Installing TigerBeetle

You can [follow the instructions](https://github.com/tigerbeetledb/tigerbeetle#single-binary) on the TigerBeetle repo to 
install the TigerBeetle binary - and it looks like they have precompiled binaries hosted on GitHub you can download.

The important thing is to grab the same version that the client, `tigerbeetle-node` uses, which as of the time of writing is 

After that, in your local environment, set `PATH_TO_TIGERBEETLE` to wherever you installed the `tigerbeetle` binary.

### Running the test:

There's a bit of other config for our `package.json` and `tsconfig.json` that needs to be set up (you can check out my code [here]()), but once that's in place we can run our test file:

```bash
npx jest example_1.test.ts
```

Which prints some output like the following:
```bash
# TODO!!!
```


## Cleaning up

We also should go about cleaning up these TigerBeetle instances as we go, which `TBRunner` can do for us, either one at a time, or all at once.

We can simply add the following to our test files:

```ts
afterAll(async () => {
  await runner.cleanUp()
})
```

## An exapanded test case

Now to prove that this approach works really well, let's run two tests with different TigerBeetles:

```
```

It works! 

## Other Approachs



### But Lewis, why not use docker containers?

I did! And it didn't work as nicely for me when getting this wode working on my CI/CD environment.

You see


### How about random `ledgerId`, `accountId` and `transferId`?

For example, every test could use a random set of ids (namely ledgerId) that would allow us to isolate tests from one another. 
Each test would essentially live in a different ledger from one another, so we wouldn't need to clean up the Accounts and 
Transfers. In MySQL terms, its akin to creating a new database for every test, with a random name and ids we keep track of. 

I had considered this approach (and I think it could work nicely), but I wanted to make my tests deterministic, and 
I know that debugging random ids across different test files and console outputs gets old pretty quickly.

## In Summary

That's it for this post - I hope you managed to learn something about how TigerBeetle works, and how we can use unique 
TigerBeetle instances for test isolation. With any luck, this will make your experience getting up and running with TigerBeetle
just a little bit easier!