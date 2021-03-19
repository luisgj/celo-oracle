import { CeloTransactionObject, toTransactionObject, Connection, Contract, CeloTx, CeloTxReceipt, CeloTxObject } from '@celo/connect'
import { PromiEvent } from 'web3-core'
import BigNumber from 'bignumber.js'
import Web3 from 'web3'
import { TransactionReceipt } from 'web3-core'
import { TransactionManagerConfig } from '../../src/app'
import { BaseReporter } from '../../src/reporters/base'
import * as send from '../../src/reporters/transaction_manager/send'
import sendWithRetries from '../../src/reporters/transaction_manager/send_with_retries'
import * as utils from '../../src/utils'

const { ReportStrategy } = utils

const defaultReceipt: TransactionReceipt = {
  blockHash: 'xxx',
  blockNumber: 10,
  to: 'xxx',
  transactionHash: 'xxx',
  transactionIndex: 1,
  cumulativeGasUsed: 1,
  gasUsed: 1,
  logs: [],
  logsBloom: 'xxx',
  status: true,
  from: 'xxx',
}

// @ts-ignore
const defaultTx = ({} as unknown) as CeloTransactionObject<void>

export class MockReporter extends BaseReporter {
  _reportStrategy = ReportStrategy.BLOCK_BASED
}

describe('transaction manager', () => {
  const initialGasPrice = 10
  // Randomly generated addresss
  const mockOracleAccount = '0x086bb25bFCD323f82a7d1c95E4Cf3807B8831270'

  let defaultConfig: TransactionManagerConfig
  const metricAction: <T>(fn: () => Promise<T>, action: string) => Promise<T> = jest.fn()
  let sendSpy: any

  beforeEach(async () => {
    sendSpy = jest.spyOn(send, 'default')
    sendSpy.mockImplementation(() => Promise.reject('error'))
    defaultConfig = {
      gasPriceMultiplier: new BigNumber(5.0),
      transactionRetryLimit: 0,
      transactionRetryGasPriceMultiplier: new BigNumber(0),
      oracleAccount: mockOracleAccount,
    }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it("doesn't retry when 0 retry limit configured", async () => {
    expect(() =>
      sendWithRetries(defaultTx, initialGasPrice, defaultConfig, metricAction)
    ).rejects.toEqual('error')
    expect(sendSpy).toHaveBeenCalled()
    expect(sendSpy).toBeCalledTimes(1)
    expect(sendSpy).toBeCalledWith(defaultTx, initialGasPrice, mockOracleAccount, metricAction)
  })

  it('passes transaction receipt back on successful send', async () => {
    sendSpy.mockImplementation(() => Promise.resolve(defaultReceipt))
    const receipt = await sendWithRetries(defaultTx, initialGasPrice, defaultConfig, metricAction)

    expect(sendSpy).toBeCalledTimes(1)
    expect(sendSpy).toBeCalledWith(defaultTx, initialGasPrice, mockOracleAccount, metricAction)
    expect(receipt).toEqual(defaultReceipt)
  })

  it('retries when transactionRetryLimit is configured', async () => {
    sendSpy.mockImplementationOnce(() => Promise.reject('error'))
    sendSpy.mockImplementationOnce(() => Promise.reject('error'))
    sendSpy.mockImplementationOnce(() => Promise.resolve(defaultReceipt))
    const result = await sendWithRetries(
      defaultTx,
      initialGasPrice,
      {
        ...defaultConfig,
        transactionRetryLimit: 2,
      },
      metricAction
    )

    expect(sendSpy).toBeCalledTimes(3)
    expect(sendSpy).nthCalledWith(1, defaultTx, initialGasPrice, mockOracleAccount, metricAction)
    expect(sendSpy).nthCalledWith(2, defaultTx, initialGasPrice, mockOracleAccount, metricAction)
    expect(sendSpy).nthCalledWith(3, defaultTx, initialGasPrice, mockOracleAccount, metricAction)
    expect(result).toEqual(defaultReceipt)
  })

  it('retries with increased gas price when transactionRetryGasPriceMultiplier is configured', async () => {
    sendSpy.mockImplementationOnce(() => Promise.reject('error'))
    sendSpy.mockImplementationOnce(() => Promise.reject('error'))
    sendSpy.mockImplementationOnce(() => Promise.resolve(defaultReceipt))

    const result = await sendWithRetries(
      defaultTx,
      initialGasPrice,
      {
        ...defaultConfig,
        transactionRetryLimit: 2,
        transactionRetryGasPriceMultiplier: new BigNumber(0.1),
      },
      metricAction
    )

    expect(sendSpy).toBeCalledTimes(3)
    expect(sendSpy).nthCalledWith(1, defaultTx, initialGasPrice, mockOracleAccount, metricAction)
    expect(sendSpy).nthCalledWith(2, defaultTx, 11, mockOracleAccount, metricAction)
    expect(sendSpy).nthCalledWith(3, defaultTx, 12, mockOracleAccount, metricAction)
    expect(result).toEqual(defaultReceipt)
  })

  it('calls onError when transactionRetryLimit is reached with no successful send', async () => {
    sendSpy.mockImplementationOnce(() => Promise.reject('error'))
    sendSpy.mockImplementationOnce(() => Promise.reject('error'))
    sendSpy.mockImplementationOnce(() => Promise.reject('error'))

    await expect(() =>
      sendWithRetries(
        defaultTx,
        initialGasPrice,
        {
          ...defaultConfig,
          transactionRetryLimit: 2,
          transactionRetryGasPriceMultiplier: new BigNumber(0.1),
        },
        metricAction
      )
    ).rejects.toEqual('error')
    expect(sendSpy).toBeCalledTimes(3)
    expect(sendSpy).nthCalledWith(1, defaultTx, initialGasPrice, mockOracleAccount, metricAction)
    expect(sendSpy).nthCalledWith(2, defaultTx, 11, mockOracleAccount, metricAction)
    expect(sendSpy).nthCalledWith(3, defaultTx, 12, mockOracleAccount, metricAction)
  })

  describe.only('fallback gas', () => {
    let mockTxObject: CeloTxObject<void>
    let connection: Connection
    // Just wraps the fn passed in, required by the send fn
    const mockMetricAction: <T>(fn: () => Promise<T>, action: string) => Promise<T> =
      async <T>(fn: () => Promise<T>, _action: string) => fn()
    const mockEstimateGas = 1234
    const fallbackGas = 4321
    // This is where we will record the amount of gas actually used in the send call
    let gas: string | number | undefined

    beforeEach(() => {
      jest.mock('web3')
      // Restore the `send` mock so we use the real implementation
      sendSpy.mockRestore()

      // The mocked result from a call to the tx object's `send` function.
      // PromiEvent involves an `on` function that calls a callback upon
      // a specified event occurring.
      const mockSendResult = {} as PromiEvent<CeloTxReceipt>
      mockSendResult.on = (event: string, fn: any) => {
        // Only immediately handle these events
        switch (event) {
          case 'transactionHash':
            fn('0xf00b00')
            break
          case 'receipt':
            fn(defaultReceipt)
            break
        }
        // Return sendResult to allow chaining of `.on`s
        return mockSendResult
      }

      // Reset gas
      gas = 0

      mockTxObject = {
        arguments: [],
        call: (_tx?: CeloTx) => Promise.resolve(),
        send: (tx?: CeloTx) => {
          gas = tx ? tx.gas : 0
          return mockSendResult
        },
        estimateGas: (_tx?: CeloTx) => Promise.resolve(mockEstimateGas),
        encodeABI: () => '',
        _parent: ({} as Contract)
      }

      // Create a new Connection
      const web3 = new Web3('http://')
      connection = new Connection(web3)
    })

    it('estimates gas when gas estimation is successful', async () => {
      const txo = toTransactionObject(
        connection,
        mockTxObject,
      )
      await send.default(
        txo,
        123,
        '0xf000000000000000000000000000000000000000',
        mockMetricAction,
        fallbackGas
      )
      // Contractkit will multiply the estimateGas result by gasInflationFactor
      // @ts-ignore because connection.config is private
      expect(gas).toEqual(Math.floor(mockEstimateGas * connection.config.gasInflationFactor))
    })

    it('uses fallback gas when gas estimation fails but eth_call does not', async () => {
      mockTxObject.estimateGas = (_tx?: CeloTx) => Promise.reject('intentional error!')

      // Mock connection.web3.eth.call to return 0x0, indicating there is no error
      const connectionSendSpy = jest.spyOn(connection.web3.eth, 'call')
      connectionSendSpy.mockImplementation(() => Promise.resolve('0x0'))
      // Craft a transaction object
      const txo = toTransactionObject(
        connection,
        mockTxObject,
      )
      await send.default(
        txo,
        123,
        '0xf000000000000000000000000000000000000000',
        mockMetricAction,
        fallbackGas
      )
      expect(gas).toEqual(fallbackGas)
    })
  })
})
