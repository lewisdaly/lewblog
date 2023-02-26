import { Client } from "tigerbeetle-node"
import NativeTBRunner, { RunningTBResult } from "./TBRunner"

describe('TigerBeetle', () => {
  jest.setTimeout(10 * 1000)
  const runner = new NativeTBRunner()
  let instance: RunningTBResult
  let client: Client

  beforeEach(async () => {
    jest.resetModules()
    const { createClient } = require('tigerbeetle-node');

    instance = await runner.spawnTBInstance();
    client = createClient({
      cluster_id: 0,
      replica_addresses: [instance.port]
    })
  })

  afterEach(async () => {
    client.destroy()
    await runner.cleanUp()
  })

  it('1. uses the tb runner', async () => {
   
    const accountDefaults = {
      user_data: 0n,
      reserved: Buffer.alloc(48, 0),
      ledger: 1,
      code: 1,
      flags: 0,
      debits_pending: 0n,
      debits_posted: 0n,
      credits_pending: 0n,
      credits_posted: 0n,
      timestamp: 0n
    }
    // Open 2 random accounts, 111 and 222
    console.log('createAccounts')
    await client.createAccounts([
      {
        id: 111n,
        ...accountDefaults
      },
      {
        id: 222n,
        ...accountDefaults
      }
    ])
    
    // Transfer 1000 from 111 to 222
    await client.createTransfers([{
      id: 123098123n,
      debit_account_id: 222n,
      credit_account_id: 111n,
      user_data: 0n,
      reserved: 0n,
      pending_id: 0n,
      timeout: 0n,
      ledger: 1,
      code: 0,
      flags: 0,
      amount: 100n,
      timestamp: 0n
    }])

    // Lookup the accounts
    const foundAccounts = await client.lookupAccounts([111n, 222n])
    console.log('foundAccounts', foundAccounts)
  })

  it('2. does not contain the accounts from the other instance', async () => {
    // lookup the accounts from the other test
    const foundAccounts = await client.lookupAccounts([111n, 222n])


    // they don't exist!
    console.log('foundAccounts', foundAccounts)

  })
})