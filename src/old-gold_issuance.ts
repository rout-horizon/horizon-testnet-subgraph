// The latest Synthetix and event invocations
// import { Synthetix as SNX, Transfer as SNXTransferEvent } from '../generated/Issuance/Synthetix';
import {
    Synthetix as SNX,
    Transfer as SNXTransferEvent,
  } from '../generated/subgraphs/issuance/issuance_Synthetix_0/Synthetix';
  
// import { Synthetix32 } from '../generated/Issuance/Synthetix32';
// import { Synthetix4 } from '../generated/Issuance/Synthetix4';
import { SynthetixState } from '../generated/subgraphs/issuance/issuance_Synthetix_0/SynthetixState';
import { AddressResolver } from '../generated/subgraphs/issuance/issuance_Synthetix_0/AddressResolver';

import {
  Synth as SynthContract,
  Transfer as SynthTransferEvent,
  Issued as IssuedEvent,
  Burned as BurnedEvent,
} from '../generated/subgraphs/issuance/balances_SynthzUSD_0/Synth';
// } from '../generated/subgraphs/issuance/issuance_SynthzUSD_0/Synth'

import { VestingEntryCreated as VestedEvent, RewardEscrow } from '../generated/subgraphs/issuance/issuance_RewardEscrow_0/RewardEscrow'

import {
  FeePool as FeePoolContract,
  FeesClaimed as FeesClaimedEvent,
  FeePeriodClosed as FeePeriodClosedEvent,
} from '../generated/subgraphs/issuance/issuance_FeePool_0/FeePool'

import {
  // imports from Balances
  Synth,
  SynthBalance,
  LatestSynthBalance,
  SynthByCurrencyKey,

  Synthetix,
  Issued,
  Burned,
  Issuer,
  SNXHolder,
  DebtSnapshot,
  RewardEscrowHolder,
  FeesClaimed,
  TotalActiveStaker,
  TotalDailyActiveStaker,
  ActiveStaker,
  DailyIssued,
  DailyBurned,
  FeePeriod,
} from "../generated/subgraphs/issuance/schema"

// Libraries
import { store, log, BigDecimal, BigInt, Address, ethereum, Bytes, dataSource } from '@graphprotocol/graph-ts';

// Helpers
import {
  toDecimal,
  strToBytes,
  getTimeID,
  zUSD32,
  DAY_SECONDS,
  ZERO_ADDRESS,
  ZERO
} from './lib/helpers';
// import { sUSD4 } from './lib/helpers';


// Exclude escrow contracts
let contracts = new Map<string, string>();

let v250UpgradeBlock = BigInt.fromI32(16788982); // Mainnet new Synths Added April 09, 2022

contracts.set('escrow', '0x7C61913A778e0920693625fBDd2c1B645bc8d607');
contracts.set('rewardEscrowV1', '0xE4c2B8FDBD8D829FAce1C0B2FA0CE6F0d3B6279E');
contracts.set('rewardEscrowV2', '0x394c897Ab4eFB49eB7AD9f765F2D664402ee9264');


function getMetadata(): Synthetix {
  let synthetix = Synthetix.load('1');

  if (synthetix == null) {
    synthetix = new Synthetix('1');
    synthetix.issuers = BigInt.fromI32(0);
    synthetix.snxHolders = BigInt.fromI32(0);
    synthetix.save();
  }

  return synthetix;
}

function incrementMetadata(field: string): void {
  let metadata = getMetadata();
  if (field == 'issuers') {
    metadata.issuers = metadata.issuers.plus(BigInt.fromI32(1));
  } else if (field == 'snxHolders') {
    metadata.snxHolders = metadata.snxHolders.plus(BigInt.fromI32(1));
  }
  metadata.save();
}

function decrementMetadata(field: string): void {
  let metadata = getMetadata();
  if (field == 'issuers') {
    metadata.issuers = metadata.issuers.minus(BigInt.fromI32(1));
  } else if (field == 'snxHolders') {
    metadata.snxHolders = metadata.snxHolders.minus(BigInt.fromI32(1));
  }
  metadata.save();
}

function trackIssuer(account: Address): void {
  let existingIssuer = Issuer.load(account.toHex());
  if (existingIssuer == null) {
    incrementMetadata('issuers');
    let issuer = new Issuer(account.toHex());
    issuer.save();
  }
}

function trackSNXHolder(
  snxContract: Address,
  account: Address,
  block: ethereum.Block,
  txn: ethereum.Transaction,
): void {
  let holder = account.toHex();
  // ignore escrow accounts
  if (contracts.get('escrow') == holder || contracts.get('rewardEscrowV1') == holder || contracts.get('rewardEscrowV2') == holder) {
    return;
  }
  let existingSNXHolder = SNXHolder.load(holder);
  let snxHolder = new SNXHolder(holder);
  snxHolder.block = block.number;
  snxHolder.timestamp = block.timestamp;

  // // Don't bother trying these extra fields before v2 upgrade (slows down The Graph processing to do all these as try_ calls)
  // if (block.number > v219UpgradeBlock) {
  let synthetix = SNX.bind(snxContract);

  let balanceTry = synthetix.try_balanceOf(account);
  if (balanceTry.reverted) {
    return;
  }

  snxHolder.balanceOf = toDecimal(balanceTry.value);
  let collateralTry = synthetix.try_collateral(account);
  if (collateralTry.reverted) {
    return;
  }

  snxHolder.collateral = toDecimal(collateralTry.value);

  // Check transferable because it will be null when rates are stale
  let transferableTry = synthetix.try_transferableSynthetix(account);
  if (!transferableTry.reverted) {
    snxHolder.transferable = toDecimal(transferableTry.value);
  }
  let resolverTry = synthetix.try_resolver();
  if (resolverTry.reverted) {
    log.info('Skipping SNX holder tracking: No resolver property from SNX holder from hash: {}, block: {}', [
      txn.hash.toHex(),
      block.number.toString(),
    ]);
    return;
  }
  let resolverAddress = resolverTry.value;
  log.info('resolverAddress: {}', [resolverAddress.toHexString()]);
  let resolver = AddressResolver.bind(resolverAddress);

  // let synthetixStateAddress = resolver.getAddress(strToBytes('SynthetixState', 32));
  // if (synthetixStateAddress.reverted) {
  //   return;
  // }
  let synthetixState = SynthetixState.bind(resolver.getAddress(strToBytes('SynthetixState', 32)));
  // let synthetixState = SynthetixState.bind(resolver.try_getAddress(strToBytes('SynthetixState', 32)));
  // let totalIssuerCount = synthetixState.try_totalIssuerCount();
  // if (totalIssuerCount.reverted) {
  //   log.info('totalIssuerCount try erro : {}', [txn.hash.toHex()]);
  // }
  // log.info('totalIssuerCount : {}', [totalIssuerCount.value.toString()]);


  let issuanceDataTry = synthetixState.try_issuanceData(account);
  if (issuanceDataTry.reverted) {
    return
  }
  snxHolder.initialDebtOwnership = issuanceDataTry.value.value0;
  let debtLedgerTry = synthetixState.try_debtLedger(issuanceDataTry.value.value1);
  if (!debtLedgerTry.reverted) {
    snxHolder.debtEntryAtIndex = debtLedgerTry.value;
  }
  // }

  if (
    (existingSNXHolder == null && snxHolder.balanceOf!.gt(toDecimal(BigInt.fromI32(0)))) ||
    (existingSNXHolder != null &&
      existingSNXHolder.balanceOf == toDecimal(BigInt.fromI32(0)) &&
      snxHolder.balanceOf > toDecimal(BigInt.fromI32(0)))
  ) {
    incrementMetadata('snxHolders');
  } else if (
    existingSNXHolder != null &&
    existingSNXHolder.balanceOf!.gt(toDecimal(BigInt.fromI32(0))) &&
    snxHolder.balanceOf == toDecimal(BigInt.fromI32(0))
  ) {
    decrementMetadata('snxHolders');
  }

  snxHolder.save();
}

function trackDebtSnapshot(event: ethereum.Event): void {
  let snxContract = event.transaction.to as Address;
  let account = event.transaction.from;

  // ignore escrow accounts
  if (contracts.get('escrow') == account.toHex() || contracts.get('rewardEscrowV1') == account.toHex() || contracts.get('rewardEscrowV2') == account.toHex()) {
    return;
  }

  let entity = new DebtSnapshot(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
  entity.block = event.block.number;
  entity.timestamp = event.block.timestamp.minus(event.block.timestamp.mod(BigInt.fromI32(900)));
  entity.account = account;

  // if (event.block.number > v219UpgradeBlock) {
  let synthetix = SNX.bind(snxContract);
  let balanceTry = synthetix.try_balanceOf(account);
  if (balanceTry.reverted) {
    return;
  }
  entity.balanceOf = toDecimal(balanceTry.value);

  let collateralTry = synthetix.try_collateral(account);
  if (!collateralTry.reverted) {
    entity.collateral = toDecimal(collateralTry.value);
  }
  let debtBalanceOfTry = synthetix.try_debtBalanceOf(account, zUSD32);
  if (debtBalanceOfTry.reverted) {
    return;
  }
  entity.debtBalanceOf = toDecimal(debtBalanceOfTry.value);
  // }
  // Use bytes32
  entity.save();
}

/**
 * Handle reward vest events so that we know which addresses have rewards, and
 * to recalculate SNX Holders staking details.
 */
// Note: we use VestedEvent here even though is also handles VestingEntryCreated (they share the same signature)
export function handleRewardVestEvent(event: VestedEvent): void {
  let entity = new RewardEscrowHolder(event.params.beneficiary.toHex());
  let contract = RewardEscrow.bind(event.address);
  let balance_try = contract.try_balanceOf(event.params.beneficiary);
  let vestedBalance_try = contract.try_totalVestedAccountBalance(event.params.beneficiary);

  if (balance_try.reverted || vestedBalance_try.reverted) {
    return 
  }

  entity.balanceOf = toDecimal(balance_try.value);
  entity.vestedBalanceOf = toDecimal(vestedBalance_try.value);
  entity.save();

  // // now track the SNX holder as this action can impact their collateral
  let synthetixAddress = changetype<Address>(Address.fromHexString('0x9EF25320Ce7824F78387a07733B85C1FB6218D13'));
  if (event.block.number < v250UpgradeBlock){
    synthetixAddress =  contract.synthetix();
  }

  trackSNXHolder(synthetixAddress, event.params.beneficiary, event.block, event.transaction);
}

export function handleIssuedSynths(event: IssuedEvent): void {
  // update Debt snapshot history
  trackDebtSnapshot(event);

  // We need to figure out if this was generated from a call to Synthetix.issueSynths, issueMaxSynths or any earlier
  // versions.

  let functions = new Map<string, string>();

  functions.set('0xaf086c7e', 'issueMaxSynths()');
  functions.set('0x320223db', 'issueMaxSynthsOnBehalf(address)');
  functions.set('0x8a290014', 'issueSynths(uint256)');
  functions.set('0xe8e09b8b', 'issueSynthsOnBehalf(address,uint256');

  // Prior to Vega we had the currency key option in issuance
  functions.set('0xef7fae7c', 'issueMaxSynths(bytes32)'); // legacy
  functions.set('0x0ee54a1d', 'issueSynths(bytes32,uint256)'); // legacy

  // Prior to Sirius release, we had currency keys using bytes4
  functions.set('0x9ff8c63f', 'issueMaxSynths(bytes4)'); // legacy
  functions.set('0x49755b9e', 'issueSynths(bytes4,uint256)'); // legacy

  // Prior to v2
  functions.set('0xda5341a8', 'issueMaxNomins()'); // legacy
  functions.set('0x187cba25', 'issueNomins(uint256)'); // legacy

  // so take the first four bytes of input
  let input = changetype<Bytes>(event.transaction.input.subarray(0, 4));

  // and for any function calls that don't match our mapping, we ignore them
  if (!functions.has(input.toHexString())) {
    log.debug('Ignoring Issued event with input: {}, hash: {}, address: {}', [
      event.transaction.input.toHexString(),
      event.transaction.hash.toHex(),
      event.address.toHexString(),
    ]);
    return;
  }

  let entity = new Issued(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
  entity.account = event.transaction.from;

  // Note: this amount isn't in sUSD for sETH or sBTC issuance prior to Vega
  entity.value = toDecimal(event.params.value);

  let synth = SynthContract.bind(event.address);
  let currencyKeyTry = synth.try_currencyKey();
  if (!currencyKeyTry.reverted) {
    entity.source = currencyKeyTry.value.toString();
  } else {
    entity.source = 'zUSD';
  }

  entity.timestamp = event.block.timestamp;
  entity.block = event.block.number;
  entity.gasPrice = event.transaction.gasPrice;
  entity.save();

  trackActiveStakers(event, false);
  // if (event.block.number > v219UpgradeBlock) {
  // }

  // track this issuer for reference
  trackIssuer(event.transaction.from);

  // update SNX holder details
  trackSNXHolder(event.transaction.to!, event.transaction.from, event.block, event.transaction);

  // now update SNXHolder to increment the number of claims
  let snxHolder = SNXHolder.load(entity.account.toHexString());
  if (snxHolder != null) {
    if (!snxHolder.mints) {
      snxHolder.mints = BigInt.fromI32(0);
    }
    snxHolder.mints = snxHolder.mints!.plus(BigInt.fromI32(1));
    snxHolder.save();
  }

  // Don't bother getting data pre-Archernar to avoid slowing The Graph down. Can be changed later if needed.
  if (entity.source == 'zUSD') {
    let timestamp = getTimeID(event.block.timestamp, DAY_SECONDS);
    let synthetix = SNX.bind(event.transaction.to!);

    let issuedSynths = synthetix.try_totalIssuedSynthsExcludeOtherCollateral(zUSD32);
    if (issuedSynths.reverted) {
      issuedSynths = synthetix.try_totalIssuedSynthsExcludeEtherCollateral(zUSD32);
      if (issuedSynths.reverted) {
        log.debug('Reverted issued try_totalIssuedSynthsExcludeEtherCollateral for hash: {}', [
          event.transaction.hash.toHex(),
        ]);
        return;
      }
      
    }

    let dailyIssuedEntity = DailyIssued.load(timestamp.toString());
    if (dailyIssuedEntity == null) {
      dailyIssuedEntity = new DailyIssued(timestamp.toString());
      dailyIssuedEntity.value = toDecimal(event.params.value);
    } else {
      dailyIssuedEntity.value = dailyIssuedEntity.value.plus(toDecimal(event.params.value));
    }
    dailyIssuedEntity.totalDebt = toDecimal(issuedSynths.value);
    dailyIssuedEntity.save();
  }

}

export function handleBurnedSynths(event: BurnedEvent): void {
  // update Debt snapshot history
  trackDebtSnapshot(event);
  // We need to figure out if this was generated from a call to Synthetix.burnSynths, burnSynthsToTarget or any earlier
  // versions.

  let functions = new Map<string, string>();
  functions.set('0x295da87d', 'burnSynths(uint256)');
  functions.set('0xc2bf3880', 'burnSynthsOnBehalf(address,uint256');
  functions.set('0x9741fb22', 'burnSynthsToTarget()');
  functions.set('0x2c955fa7', 'burnSynthsToTargetOnBehalf(address)');

  // Prior to Vega we had the currency key option in issuance
  functions.set('0xea168b62', 'burnSynths(bytes32,uint256)');

  // Prior to Sirius release, we had currency keys using bytes4
  functions.set('0xaf023335', 'burnSynths(bytes4,uint256)');

  // Prior to v2 (i.e. in Havven times)
  functions.set('0x3253ccdf', 'burnNomins(uint256');

  // so take the first four bytes of input
  let input = changetype<Bytes>(event.transaction.input.subarray(0, 4));

  // and for any function calls that don't match our mapping, we ignore them
  if (!functions.has(input.toHexString())) {
    log.debug('Ignoring Burned event with input: {}, hash: {}, address: {}', [
      event.transaction.input.toHexString(),
      event.transaction.hash.toHex(),
      event.address.toHexString(),
    ]);
    return;
  }

  let entity = new Burned(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
  entity.account = event.transaction.from;

  // Note: this amount isn't in sUSD for sETH or sBTC issuance prior to Vega
  entity.value = toDecimal(event.params.value);

  let synth = SynthContract.bind(event.address);
  let currencyKeyTry = synth.try_currencyKey();
  if (!currencyKeyTry.reverted) {
    entity.source = currencyKeyTry.value.toString();
  } else {
    entity.source = 'zUSD';
  }

  entity.timestamp = event.block.timestamp;
  entity.block = event.block.number;
  entity.gasPrice = event.transaction.gasPrice;
  entity.save();

  // if (event.block.number > v219UpgradeBlock) {
  trackActiveStakers(event, true);
  // }

  // update SNX holder details
  trackSNXHolder(event.transaction.to!, event.transaction.from, event.block, event.transaction);

  // Don't bother getting data pre-Archernar to avoid slowing The Graph down. Can be changed later if needed.
  if (entity.source == 'zUSD') {
    let timestamp = getTimeID(event.block.timestamp, DAY_SECONDS);
    let synthetix = SNX.bind(event.transaction.to!);
    let issuedSynths = synthetix.try_totalIssuedSynthsExcludeOtherCollateral(zUSD32);
    if (issuedSynths.reverted) {
      issuedSynths = synthetix.try_totalIssuedSynthsExcludeEtherCollateral(zUSD32);
      if (issuedSynths.reverted) {
        // for some reason this can happen (not sure how)
        log.debug('Reverted issued try_totalIssuedSynthsExcludeEtherCollateral for hash: {}', [
          event.transaction.hash.toHex(),
        ]);
        return;
      }
    }

    let dailyBurnedEntity = DailyBurned.load(timestamp.toString());
    if (dailyBurnedEntity == null) {
      dailyBurnedEntity = new DailyBurned(timestamp.toString());
      dailyBurnedEntity.value = toDecimal(event.params.value);
    } else {
      dailyBurnedEntity.value = dailyBurnedEntity.value.plus(toDecimal(event.params.value));
    }
    dailyBurnedEntity.totalDebt = toDecimal(issuedSynths.value);
    dailyBurnedEntity.save();
  }
}

export function handleFeesClaimed(event: FeesClaimedEvent): void {
  let entity = new FeesClaimed(event.transaction.hash.toHex() + '-' + event.logIndex.toString());

  entity.account = event.params.account;
  entity.rewards = toDecimal(event.params.snxRewards);
  // if (event.block.number > v219UpgradeBlock) {
  // post Achernar, we had no XDRs, so use the value as sUSD
  entity.value = toDecimal(event.params.sUSDAmount);
  // }

  entity.block = event.block.number;
  entity.timestamp = event.block.timestamp;

  entity.save();

  // now update SNXHolder to increment the number of claims
  let snxHolder = SNXHolder.load(entity.account.toHexString());
  if (snxHolder != null) {
    if (!snxHolder.claims) {
      snxHolder.claims = BigInt.fromI32(0);
    }
    snxHolder.claims = snxHolder.claims!.plus(BigInt.fromI32(1));
    snxHolder.save();
  }

  updateCurrentFeePeriod(event.address);
}

export function handleFeePeriodClosed(event: FeePeriodClosedEvent): void {
  // Assign period feePeriodId
  let closedFeePeriod = FeePeriod.load('current');
  if (closedFeePeriod) {
    closedFeePeriod.id = event.params.feePeriodId.toString();
    closedFeePeriod.save();
  }

  updateCurrentFeePeriod(event.address);
}

function updateCurrentFeePeriod(feePoolAddress: Address): void {
  let FeePool = FeePoolContract.bind(feePoolAddress);

  // [0] is always the current active fee period which is not
  // claimable until closeCurrentFeePeriod() is called closing
  // the current weeks collected fees. [1] is last week's period.
  let recentFeePeriod = FeePool.try_recentFeePeriods(BigInt.fromI32(1));
  if (!recentFeePeriod.reverted) {
    let feePeriod = FeePeriod.load(recentFeePeriod.value.value0.toString());
    if (!feePeriod) {
      feePeriod = new FeePeriod(recentFeePeriod.value.value0.toString());
    }

    //feePeriod.startingDebtIndex = recentFeePeriod.value.value1;
    feePeriod.startTime = recentFeePeriod.value.value2;
    feePeriod.feesToDistribute = toDecimal(recentFeePeriod.value.value3);
    feePeriod.feesClaimed = toDecimal(recentFeePeriod.value.value4);
    feePeriod.rewardsToDistribute = toDecimal(recentFeePeriod.value.value5);
    feePeriod.rewardsClaimed = toDecimal(recentFeePeriod.value.value6);
    feePeriod.save();
  }
}

function trackActiveStakers(event: ethereum.Event, isBurn: boolean): void {
  let account = event.transaction.from;
  let timestamp = event.block.timestamp;
  let snxContract = event.transaction.to as Address;
  let accountDebtBalance = BigInt.fromI32(0);

  // if (event.block.number > v219UpgradeBlock) {
  let synthetix = SNX.bind(snxContract);
  let accountDebtBalanceTry = synthetix.try_debtBalanceOf(account, zUSD32);
  if (!accountDebtBalanceTry.reverted) {
    accountDebtBalance = accountDebtBalanceTry.value;
  }
  // }

  let dayTimestamp = getTimeID(timestamp, DAY_SECONDS);

  let totalActiveStaker = TotalActiveStaker.load('1');
  let activeStaker = ActiveStaker.load(account.toHex());

  if (totalActiveStaker == null) {
    totalActiveStaker = loadTotalActiveStaker();
  }

  // You are burning and have been counted before as active and have no debt balance
  // we reduce the count from the total and remove the active staker entity
  if (isBurn && activeStaker != null && accountDebtBalance == BigInt.fromI32(0)) {
    totalActiveStaker.count = totalActiveStaker.count.minus(BigInt.fromI32(1));
    totalActiveStaker.save();
    store.remove('ActiveStaker', account.toHex());
    ('');
    // else if you are minting and have not been accounted for as being active, add one
    // and create a new active staker entity
  } else if (!isBurn && activeStaker == null) {
    activeStaker = new ActiveStaker(account.toHex());
    activeStaker.save();
    totalActiveStaker.count = totalActiveStaker.count.plus(BigInt.fromI32(1));
    totalActiveStaker.save();
  }

  // Once a day we stor the total number of active stakers in an entity that is easy to query for charts
  let totalDailyActiveStaker = TotalDailyActiveStaker.load(dayTimestamp.toString());
  if (totalDailyActiveStaker == null) {
    updateTotalDailyActiveStaker(dayTimestamp, totalActiveStaker.count);
  }
}

function loadTotalActiveStaker(): TotalActiveStaker {
  let newActiveStaker = new TotalActiveStaker('1');
  newActiveStaker.count = BigInt.fromI32(0);
  return newActiveStaker;
}

function updateTotalDailyActiveStaker(timestamp: BigInt, count: BigInt): void {
  let newTotalDailyActiveStaker = new TotalDailyActiveStaker(timestamp.toString());
  newTotalDailyActiveStaker.timestamp = timestamp;
  newTotalDailyActiveStaker.count = count;
  newTotalDailyActiveStaker.save();
}


// Balances subgraph merged
// Major changes -
// - handleTransferSNX
// - trackSynthHolder
// - handleTransferSynth

export function handleTransferSNX(event: SNXTransferEvent): void {
  let synth = Synth.load(event.address.toHex());

  if (synth == null) {
    // ensure SNX is recorded
    synth = registerSynth(event.address);
  }

  if (event.params.from.toHex() != ZERO_ADDRESS.toHex()) {
    trackSNXHolder(event.address, event.params.from, event.block, event.transaction);
  } else if (synth != null) {
    // snx is minted
    synth.totalSupply = synth.totalSupply.plus(toDecimal(event.params.value));
    synth.save();
  }

  if (event.params.to.toHex() != ZERO_ADDRESS.toHex()) {
    trackSNXHolder(event.address, event.params.to, event.block, event.transaction);
  } else if (synth != null) {
    // snx is burned (only occurs on cross chain transfer)
    synth.totalSupply = synth.totalSupply.minus(toDecimal(event.params.value));
    synth.save();
  }
}

export function registerSynth(synthAddress: Address): Synth | null {
  // the address associated with the issuer may not be the proxy
  let synthBackContract = SynthContract.bind(synthAddress);
  let proxyQuery = synthBackContract.try_proxy();
  let nameQuery = synthBackContract.try_name();
  let symbolQuery = synthBackContract.try_symbol();
  let totalSupplyQuery = synthBackContract.try_totalSupply();

  if (symbolQuery.reverted || totalSupplyQuery.reverted) {
    log.warning('tried to save invalid synth {}', [synthAddress.toHex()]);
    return null;
  }

  if (!proxyQuery.reverted) {
    synthAddress = proxyQuery.value;
  }

  let newSynth = new Synth(synthAddress.toHex());
  newSynth.name = nameQuery.reverted ? symbolQuery.value : nameQuery.value;
  newSynth.symbol = symbolQuery.value;
  newSynth.totalSupply = toDecimal(totalSupplyQuery.value);
  newSynth.save();

  // symbol is same as currencyKey
  let newSynthByCurrencyKey = new SynthByCurrencyKey(symbolQuery.value);
  newSynthByCurrencyKey.proxyAddress = synthAddress;
  newSynthByCurrencyKey.save();

  // legacy sUSD contract uses wrong name ==> Not required for horizon
  // if (symbolQuery.value == 'nUSD') {
  //   let newSynthByCurrencyKey = new SynthByCurrencyKey('zUSD');
  //   newSynthByCurrencyKey.proxyAddress = synthAddress;
  //   newSynthByCurrencyKey.save();
  // }

  return newSynth;
}

function trackSynthHolder(synthAddress: Address, account: Address, timestamp: BigInt, value: BigDecimal): void {
  let synth = Synth.load(synthAddress.toHex());

  if (synth == null) {
    registerSynth(synthAddress);
  }

  let totalBalance = toDecimal(ZERO);
  let latestBalanceID = account.toHex() + '-' + synthAddress.toHex();
  let oldSynthBalance = LatestSynthBalance.load(latestBalanceID);

  if (oldSynthBalance == null || oldSynthBalance.timestamp.equals(timestamp)) {
    let synthC = SynthContract.bind(synthAddress);
    let balance_try = synthC.try_balanceOf(account);
    if (balance_try.reverted) {
      log.warning('tried to save balance of synth {}', [synthAddress.toHex()]);
      return;
    }
    totalBalance = toDecimal(balance_try.value);
    // totalBalance = toDecimal(SynthContract.bind(synthAddress).balanceOf(account));
  } else {
    totalBalance = oldSynthBalance.amount.plus(value);
  }

  let newLatestBalance = new LatestSynthBalance(latestBalanceID);
  newLatestBalance.address = account;
  newLatestBalance.account = account.toHex();
  newLatestBalance.timestamp = timestamp;
  newLatestBalance.synth = synthAddress.toHex();
  newLatestBalance.amount = totalBalance;
  newLatestBalance.save();

  let newBalanceID = timestamp.toString() + '-' + account.toHex() + '-' + synthAddress.toHex();
  let newBalance = new SynthBalance(newBalanceID);
  newBalance.address = account;
  newBalance.account = account.toHex();
  newBalance.timestamp = timestamp;
  newBalance.synth = synthAddress.toHex();
  newBalance.amount = totalBalance;
  newBalance.save();
}

function trackMintOrBurn(synthAddress: Address, value: BigDecimal): void {
  let synth = Synth.load(synthAddress.toHex());

  if (synth == null) {
    synth = registerSynth(synthAddress);
  }

  if (synth != null) {
    let newSupply = synth.totalSupply.plus(value);

    if (newSupply.lt(toDecimal(ZERO))) {
      log.warning('totalSupply needs correction, is negative: %s', [synth.symbol]);
      let synthBackContract = SynthContract.bind(synthAddress);
      synth.totalSupply = toDecimal(synthBackContract.totalSupply());
    } else {
      synth.totalSupply = newSupply;
    }

    synth.save();
  }
}


export function handleTransferSynth(event: SynthTransferEvent): void {
  if (event.params.from.toHex() != ZERO_ADDRESS.toHex() && event.params.from != event.address) {
    trackSynthHolder(event.address, event.params.from, event.block.timestamp, toDecimal(event.params.value).neg());
  } else {
    trackMintOrBurn(event.address, toDecimal(event.params.value));
  }

  if (event.params.to.toHex() != ZERO_ADDRESS.toHex() && event.params.to != event.address) {
    trackSynthHolder(event.address, event.params.to, event.block.timestamp, toDecimal(event.params.value));
  } else {
    trackMintOrBurn(event.address, toDecimal(event.params.value).neg());
  }
}