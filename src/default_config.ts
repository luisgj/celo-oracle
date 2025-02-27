import BigNumber from 'bignumber.js'
import Logger from 'bunyan'
import {
  BaseReporterConfigSubset,
  BlockBasedReporterConfigSubset,
  DataAggregatorConfigSubset,
  OracleApplicationConfig,
} from './app'
import {
  AggregationMethod,
  minutesToMs,
  OracleCurrencyPair,
  ReportStrategy,
  secondsToMs,
  WalletType,
} from './utils'

export const baseLogger = Logger.createLogger({
  name: 'oracle',
  serializers: Logger.stdSerializers,
  level: 'debug',
})

export const defaultDataAggregatorConfig: DataAggregatorConfigSubset = {
  aggregationMethod: AggregationMethod.MIDPRICES,
  aggregationWindowDuration: minutesToMs(5),
  apiRequestTimeout: secondsToMs(5),
  baseLogger,
  maxSourceWeightShare: new BigNumber(0.99),
  maxPercentageBidAskSpread: new BigNumber(0.1),
  maxPercentageDeviation: new BigNumber(0.2),
  maxNoTradeDuration: secondsToMs(20), // with ETH on Coinbase it's common to see a no trade duration of 10s
  minPriceSourceCount: 1,
  minAggregatedVolume: new BigNumber(0),
}

export const defaultBaseReporterConfig: BaseReporterConfigSubset = {
  baseLogger,
  circuitBreakerPriceChangeThresholdMax: new BigNumber(0.25), // 25%
  circuitBreakerPriceChangeThresholdMin: new BigNumber(0.15), // 15%
  circuitBreakerPriceChangeThresholdTimeMultiplier: new BigNumber(0.0075),
  gasPriceMultiplier: new BigNumber(5),
  transactionRetryLimit: 3,
  transactionRetryGasPriceMultiplier: new BigNumber(0.1),
  unusedOracleAddresses: [],
}

export const defaultBlockBasedReporterConfig: BlockBasedReporterConfigSubset = {
  ...defaultBaseReporterConfig,
  expectedBlockTimeMs: secondsToMs(5),
  maxBlockTimestampAgeMs: secondsToMs(30),
  minReportPriceChangeThreshold: new BigNumber(0.005), // 0.5%
  targetMaxHeartbeatPeriodMs: minutesToMs(4.5),
}

export const defaultApplicationConfig: OracleApplicationConfig = {
  awsKeyRegion: 'eu-central-1',
  azureHsmInitMaxRetryBackoffMs: secondsToMs(30),
  azureHsmInitTryCount: 5,
  baseLogger,
  currencyPair: OracleCurrencyPair.CELOUSD,
  dataAggregatorConfig: defaultDataAggregatorConfig,
  httpRpcProviderUrl: 'http://localhost:8545',
  metrics: true,
  privateKeyPath: '/tmp/defaultPrivateKey',
  prometheusPort: 9090,
  reporterConfig: defaultBlockBasedReporterConfig,
  reportStrategy: ReportStrategy.BLOCK_BASED,
  reportTargetOverride: undefined,
  walletType: WalletType.PRIVATE_KEY,
  wsRpcProviderUrl: 'ws://localhost:8546',
}
