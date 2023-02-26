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
    child_process.execSync(formatCmd.join(' '))

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

    // sleep for 2s for TB to be up
    await this._testSleep(2000)

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
   * 
   *   We need to wait a short amount of time for `tbStartProcess.on('close')` to
   *   be triggered, and clean up the file - this lazy sleep option works, but could
   *   be improved
   */
  public async killTBInstance(instance: RunningTBResult): Promise<void> {
    return new Promise(res => {
      instance.process.kill('SIGTERM')
      return setTimeout(res, 100);
    })
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

  public async _testSleep(timeMs: number): Promise<void> {
    return new Promise(resolve => {
      setTimeout(resolve, timeMs)
    })
  }
}