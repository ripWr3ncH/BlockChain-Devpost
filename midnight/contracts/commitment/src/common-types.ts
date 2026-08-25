// Adapted from midnightntwrk/example-counter's counter-cli/src/common-types.ts
// (see midnight/reference/counter-example-common-types.ts). Points the generic
// midnight-js contract types at the compiled Verity commitment contract instead
// of the counter example's.

import type { MidnightProviders } from '@midnight-ntwrk/midnight-js/types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js/contracts';
import type { ProvableCircuitId } from '@midnight-ntwrk/compact-js';
import { Contract as CommitmentContractClass } from './managed/commitment/contract/index.js';
import type { CommitmentPrivateState, commitmentPrivateStateId } from './witnesses.js';

export type CommitmentCircuits = ProvableCircuitId<CommitmentContractClass<CommitmentPrivateState>>;

export type CommitmentProviders = MidnightProviders<
  CommitmentCircuits,
  typeof commitmentPrivateStateId,
  CommitmentPrivateState
>;

export type CommitmentContract = CommitmentContractClass<CommitmentPrivateState>;

export type DeployedCommitmentContract = DeployedContract<CommitmentContract> | FoundContract<CommitmentContract>;
