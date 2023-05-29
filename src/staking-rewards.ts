import {
    StakingRewards,
    Staked as StakedEvent,
    Withdrawn as WithdrawnEvent,
    RewardPaid as RewardPaidEvent,
} from '../generated/subgraphs/staking-rewards/staking_CR-HZN-BNB/StakingRewards';

import { Stake, Staker, StakingContract } from '../generated/subgraphs/staking-rewards/schema'

import { store, log, BigDecimal, BigInt, Address, ethereum, Bytes, dataSource } from '@graphprotocol/graph-ts';

// Helpers
import {
    toDecimal,
    strToBytes,
    getTimeID,
    zUSD32,
    DAY_SECONDS,
    ZERO_ADDRESS,
    ZERO,
    ONE
  } from './lib/helpers';

export function handleStaked(event: StakedEvent): void {
    // 1. Register the staking contract if not already done
    // 2. Save a Stake entity with contractaddr-walletaddr as ID
    // 3. Track staker


    let existingContract = StakingContract.load(event.address.toHex());
    if (existingContract == null) {
        existingContract = registerStakingContract(event.address);
    }

    existingContract.totalStaked = existingContract.totalStaked.plus(toDecimal(event.params.amount));
    existingContract.save();
    
    
    let newStake = new Stake(event.transaction.hash.toHex());
    newStake.contract = event.address.toHex();
    newStake.account = event.params.user.toHex();
    newStake.amount = toDecimal(event.params.amount);
    newStake.typeofStake = "ADD";
    newStake.timestamp = event.block.timestamp;
    newStake.save();
    
    trackStaker(event.address, event.params.user, toDecimal(event.params.amount), true);
}

export function handleWithdrawn(event: WithdrawnEvent): void {
    let existingContract = StakingContract.load(event.address.toHex());
    if (existingContract == null) {
        return;
    }
    
    existingContract.totalStaked = existingContract.totalStaked.minus(toDecimal(event.params.amount));
    existingContract.save();
    
    
    
    let newStake = new Stake(event.transaction.hash.toHex());
    newStake.contract = event.address.toHex();
    newStake.account = event.params.user.toHex();
    newStake.amount = toDecimal(event.params.amount);
    newStake.typeofStake = "WITHDRAW";
    newStake.timestamp = event.block.timestamp;
    newStake.save();
    
    trackStaker(event.address, event.params.user, toDecimal(event.params.amount), false);
}

export function handleRewardPaid(event: RewardPaidEvent): void {
    let existingContract = StakingContract.load(event.address.toHex());
    if (existingContract == null) {
        return;
    }

    existingContract.totalClaimed = existingContract.totalClaimed.plus(toDecimal(event.params.reward));
    existingContract.save();

    let newStake = new Stake(event.transaction.hash.toHex());
    newStake.contract = event.address.toHex();
    newStake.account = event.params.user.toHex();
    newStake.amount = toDecimal(event.params.reward);
    newStake.typeofStake = "CLAIM";
    newStake.timestamp = event.block.timestamp;
    newStake.save();

    let staker = Staker.load(event.params.user.toHex() + '-' + event.address.toHex());
    if (staker != null) {
        staker.totalClaimed = staker.totalClaimed.plus(toDecimal(event.params.reward));
        staker.save();
    }
}

function registerStakingContract(contractAddress: Address): StakingContract {
    let contract = StakingRewards.bind(contractAddress);

    let stakingContract = new StakingContract(contractAddress.toHex());
    stakingContract.address = contractAddress.toHex();
    stakingContract.stakingToken = contract.stakingToken().toHex();
    stakingContract.rewardsToken = contract.rewardsToken().toHex();
    stakingContract.totalStaked = toDecimal(BigInt.fromI32(0));
    stakingContract.totalClaimed = toDecimal(BigInt.fromI32(0));
    stakingContract.save();

    return stakingContract;
}

function trackStaker(contract: Address, account: Address, amount: BigDecimal, isStake: boolean): void {
    let existingStaker = Staker.load(account.toHex() + '-' + contract.toHex());
    
    // Withdraw case
    if (!isStake && existingStaker) {
        existingStaker.totalStaked = existingStaker.totalStaked.minus(amount);
        existingStaker.save();
        return;
    }
    // New staker
    if (existingStaker == null) {
        let staker = new Staker(account.toHex() + '-' + contract.toHex());
        staker.account = account.toHex();
        staker.contract = contract.toHex();
        staker.totalStaked = amount;
        staker.totalClaimed = toDecimal(BigInt.fromI32(0));
        staker.save();
        return;
    }
    // Existing staker
    existingStaker.totalStaked = existingStaker.totalStaked.plus(amount);
    existingStaker.contract = contract.toHex();
    existingStaker.save();
}