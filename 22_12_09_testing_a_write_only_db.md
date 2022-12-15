# Integration Testing a Write Only DB

Notes and thoughts on writing integration tests with TigerBeetle.


## The Challenge

One of the primary reasons for choosing TigerBeetle was for the ability to run it locally.

Other ledgers I evaluated either required our tests to call a live API (great for simple tests but doesn't scale to large teams or automated tests), or spin up a flock of docker containers in order to run a local ledger. There's another post I'm yet to write about my choices for TigerBeetle, and where it fits in the spectrum of ledger databases, so I won't go into all of the choices here.

During my evaluation phase of TigerBeetle, when I tried to write integration tests for services which created Accounts or Transfers in TigerBeetle, I ran into a problem: TigerBeetle has no `TRUNCATE TABLE` or `DELETE FROM`!

I can see the appeal of an append only ledger for the critical business functions that TigerBeetle will handle, but in order to adequately test our code that depends on TigerBeetle, we need a way to either isolate the state of our tests from one another or reset the database in between tests.


## The Approach

When I'm writing integration tests that depend on external services (say, for example, a MySQL database), I normally do something like the following:

1. Spin up the dependencies with `docker-compose up -d`
2. Start the test runner: `jest ./test --runInBand` [todo: double check command]
  - `--runInBand` makes sure that Jest runs only one file at a time, so no two files will contend over the database
  - Additionally, each test case, or test file is responsible for cleaning up after itself, either by keeping track of the rows that they created and deleting them from the database table, or (if I'm too lazy), truncating each table in the database.
3. Pass/Fail the tests based on the results.

### Inspiration from SQL-Lite

Another approach that I've seen is to use an in-memory version of a database for integration tests, which is the approach that inspired this post.

This has the added improved developer experience of spinning up the dependencies inside the scope of each test file, so there's no need to run something like `docker-compose up -d` _before_ running the tests. It's easier to create a test experience that works out of the box.

## The Code

For this example, let's use Typescript with Jest as our test runner. As you'll see, this approach could easily be adapted for other languages and test runners, since all we are doing is calling the local TigerBeetle executable with `os.exec`. 


### First Pass - Spawning an instance

Let's start with a simple test file, `example_1.test.ts`:

```ts
// TODO: replaceme example_1.ts
```

_note: you can find the full working code examples in the associated Github repo [here](https://github.com/lewisdaly/lewblog/tree/master/examples/testing_write_only_db)_

You can see here, in the `beforeEach()` hook, that we spawn a new TigerBeetle instance for each individual test.

This test file depends on the following file `TBRunner.ts`:

```ts
// TODO: replaceme TBRunner.ts
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
install the TigerBeetle binary - and it looks like they now have precompiled binaries hosted on GitHub you can download. I found
the `TODO!!` release to work with `tigerbeetle-node v0.11.6`.

The important thing is to grab the same version that the client, `tigerbeetle-node` uses, which as of the time of writing is 

After that, in your local environment, set `PATH_TO_TIGERBEETLE` to wherever you installed the `tigerbeetle` binary.

### Running the test:

There's a bit of other config for our `package.json` and `tsconfig.json` that needs to be set up (you can check out my code [here](https://github.com/lewisdaly/lewblog/tree/master/examples/testing_write_only_db)), but once that's in place we can run our test file:

```bash
npx jest example_1.test.ts
```

Which prints some output like the following:
```bash
  console.log
    execSync cmd: /Users/lewisdaly/developer/buoy/tigerbeetle/tigerbeetle format --cluster=0 --replica=0 /var/folders/8m/w6z8z73d2tbg3jb3v8h615600000gn/T/foo-LG1Itu/0_0.tigerbeetle

      at TBRunner.spawnTBInstance (TBRunner.ts:72:13)

  console.log
    spawn cmd: /Users/lewisdaly/developer/buoy/tigerbeetle/tigerbeetle start --addresses=0.0.0.0:61554 /var/folders/8m/w6z8z73d2tbg3jb3v8h615600000gn/T/foo-LG1Itu/0_0.tigerbeetle

      at TBRunner.spawnTBInstance (TBRunner.ts:82:13)

  console.log
    TB instance at PID 60816

      at Object.<anonymous> (example_1.test.ts:22:13)

 PASS  ./example_1.test.ts
  TigerBeetle
    ✓ has spawned the tb instance (117 ms)

Test Suites: 1 passed, 1 total
Tests:       1 passed, 1 total
Snapshots:   0 total
Time:        2.712 s, estimated 3 s
Ran all test suites matching /example_1.test.ts/i.
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

```ts
// TODO: replaceme example_3_multbeetle.test.ts
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