/**
 * VERITY — `claims` channel chaincode (Modules III and IV).
 *
 * Members: BankA (the resolution entity), Central Authority, Regulatory Council. BankB is
 * deliberately NOT on this channel — §6 Phase 1 puts the claims registry with
 * the resolution entity alone.
 */

import { ClaimsContract } from './contracts/claims';
import { LiabilityContract } from './contracts/liability';

export { ClaimsContract, LiabilityContract };
export const contracts = [LiabilityContract, ClaimsContract];
