const { getContractDeployments, getCurrentNetwork, createSubgraphManifest } = require('./utils/network');

const manifest = [];

const stakingContracts =
    {
        "CR-HZN-BNB" : "0x84838d0AB37857fAd5979Fcf6BDDf8ddb1cC1dA8", // Current Staking: HZN-BNB
        "CR-ZUSD-BUSD" : "0x5646aA2F9408C7c2eE1dC7db813C8B687A959a85", // Current Staking: zUSD-BUSD
        "CR-ZBNB-BNB" : "0x307326d24b5287b12f8079ba3854d9f7e7a139e1", // Current Staking: zBNB-BNB
        "LG-PHB-LG" : "0xD4552F3e19B91BeD5EF2c76a67ABdbFfeD5caEEC", // Legacy Staking: PHB Legacy
        "LG-PHB" : "0xa1771DCfb7822C8853D7E64B86E58f7f1eB5e33E", // Legacy Staking: PHB
        "LG-HZN" : "0x67D5a94F444DF4bBA254645065a4137fc665Bf98", // Legacy Staking: HZN
        "LG-HZN-BNB" : "0xb9c6c9f41d3da1c81c869e527f7b8f44d6e949b6", // Legacy Staking: HZN-BNB
    }

// "0xD4552F3e19B91BeD5EF2c76a67ABdbFfeD5caEEC", // Legacy: PHB Legacy
// "0xa1771DCfb7822C8853D7E64B86E58f7f1eB5e33E", // Legacy: PHB
// "0x67D5a94F444DF4bBA254645065a4137fc665Bf98", // Legacy: HZN
// "0xB9C6C9F41d3Da1C81c869e527F7b8f44D6e949b6", // Legacy: HZN-BNB

for (const contract of Object.keys(stakingContracts)) {
    manifest.push({
        kind: 'ethereum/contract',
        name: `staking_${contract}`,
        network: getCurrentNetwork(),
        source: {
          address: stakingContracts[contract],
          startBlock: parseInt(process.env.SNX_START_BLOCK),
          abi: 'StakingRewards',
        },
        mapping: {
          kind: 'ethereum/events',
          apiVersion: '0.0.5',
          language: 'wasm/assemblyscript',
          file: '../src/staking-rewards.ts',
          entities: ['Stake', 'Staker', 'StakingContract'],
          abis: [
            {
              name: 'StakingRewards',
              file: '../abis/StakingRewards.json',
            },
          ],
          eventHandlers: [
            {
              event: 'Staked(indexed address,uint256)',
              handler: 'handleStaked',
            },
            {
              event: 'Withdrawn(indexed address,uint256)',
              handler: 'handleWithdrawn',
            },
            {
                event: 'RewardPaid(indexed address,uint256)',
                handler: 'handleRewardPaid',
            },
          ],
        },
      });
}

console.log("manifest", manifest);

module.exports = createSubgraphManifest('staking-rewards', manifest, []);


