export interface PayoutBreakdown {
  stakeMinor: number;
  grossProfitMinor: number;
  commissionMinor: number;
  netProfitMinor: number;
  payoutMinor: number;
}

export function calculatePayout(stakeMinor: number, multiplier: number, commissionPercent: number): PayoutBreakdown {
  if (!Number.isSafeInteger(stakeMinor) || stakeMinor <= 0) throw new Error("Invalid bet stake.");
  if (!Number.isFinite(multiplier) || multiplier < 1) throw new Error("Invalid cash-out multiplier.");
  if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
    throw new Error("Invalid commission percentage.");
  }

  const grossPayoutMinor = Math.round(stakeMinor * multiplier);
  if (!Number.isSafeInteger(grossPayoutMinor)) throw new Error("Calculated payout is outside the supported range.");
  const grossProfitMinor = Math.max(0, grossPayoutMinor - stakeMinor);
  const commissionMinor = Math.min(
    grossProfitMinor,
    Math.round(grossProfitMinor * (commissionPercent / 100))
  );
  const netProfitMinor = grossProfitMinor - commissionMinor;

  return {
    stakeMinor,
    grossProfitMinor,
    commissionMinor,
    netProfitMinor,
    payoutMinor: stakeMinor + netProfitMinor
  };
}

export function calculateMaximumLiability(stakeMinor: number, maxCashoutMultiplier: number): number {
  return calculatePayout(stakeMinor, maxCashoutMultiplier, 0).grossProfitMinor;
}

export interface ReconciliationInput {
  totalApprovedDepositsMinor: number;
  availableUserBalanceMinor: number;
  withdrawalLockedMinor: number;
  activeBetEscrowMinor: number;
  pendingRewardsMinor: number;
  lossPoolMinor: number;
  commissionWalletMinor: number;
  bonusWalletMinor: number;
  totalBonusFundingMinor: number;
  totalCompletedWithdrawalsMinor: number;
}

export function reconcile(input: ReconciliationInput): { accountedMinor: number; differenceMinor: number; balanced: boolean } {
  const accountedMinor =
    input.availableUserBalanceMinor +
    input.withdrawalLockedMinor +
    input.activeBetEscrowMinor +
    input.pendingRewardsMinor +
    input.lossPoolMinor +
    input.commissionWalletMinor +
    input.bonusWalletMinor +
    input.totalCompletedWithdrawalsMinor;
  const differenceMinor = (input.totalApprovedDepositsMinor + input.totalBonusFundingMinor) - accountedMinor;
  return { accountedMinor, differenceMinor, balanced: differenceMinor === 0 };
}
