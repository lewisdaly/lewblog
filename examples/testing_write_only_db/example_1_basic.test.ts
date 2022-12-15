import { Client, createClient } from "tigerbeetle-node"
import NativeTBRunner, { RunningTBResult } from "./TBRunner"

describe('TigerBeetle', () => {
  jest.setTimeout(10000)
  
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
    console.log('TB instance at PID', instance.pid)
  })
})