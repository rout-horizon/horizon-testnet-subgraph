const { getContractDeployments, getCurrentNetwork, createSubgraphManifest } = require('./utils/network');

const manifest = [];

getContractDeployments('ProxyERC20').forEach((a, i) => {
  manifest.push({
    kind: 'ethereum/contract',
    name: `liquidations_Synthetix_${i}`,
    network: getCurrentNetwork(),
    source: {
      address: a.address,
      startBlock: a.startBlock,
      abi: 'Synthetix',
    },
    mapping: {
      kind: 'ethereum/events',
      apiVersion: '0.0.5',
      language: 'wasm/assemblyscript',
      file: '../src/liquidations.ts',
      entities: ['AccountLiquidated'],
      abis: [
        {
          name: 'Synthetix',
          file: '../abis/Synthetix.json',
        },
      ],
      eventHandlers: [
        {
          event: 'AccountLiquidated(indexed address,uint256,uint256,address)',
          handler: 'handleAccountLiquidated',
        },
      ],
    },
  });
});

getContractDeployments('Liquidations').forEach((a, i) => {
  manifest.push({
    kind: 'ethereum/contract',
    name: `liquidations_Liquidations_${i}`,
    network: getCurrentNetwork(),
    source: {
      address: a.address,
      startBlock: a.startBlock,
      abi: 'Liquidations',
    },
    mapping: {
      kind: 'ethereum/events',
      apiVersion: '0.0.5',
      language: 'wasm/assemblyscript',
      file: '../src/liquidations.ts',
      entities: ['AccountFlaggedForLiquidation', 'AccountRemovedFromLiquidation'],
      abis: [
        {
          name: 'Liquidations',
          file: '../abis/Liquidations.json',
        },
        {
          name: 'AddressResolver',
          file: '../abis/AddressResolver.json',
        },
        {
          name: 'Synthetix32',
          file: '../abis/Synthetix_bytes32.json',
        },
      ],
      eventHandlers: [
        {
          event: 'AccountFlaggedForLiquidation(indexed address,uint256)',
          handler: 'handleAccountFlaggedForLiquidation',
        },
        {
          event: 'AccountRemovedFromLiquidation(indexed address,uint256)',
          handler: 'handleAccountRemovedFromLiquidation',
        },
      ],
    },
  });
});

module.exports = createSubgraphManifest('liquidations', manifest, []);
