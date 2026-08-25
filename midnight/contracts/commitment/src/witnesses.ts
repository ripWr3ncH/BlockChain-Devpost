// VERITY — commitment contract witnesses.
//
// Real off-chain data a caller supplies privately to a circuit. Adapted to the
// interface shape compact compile generated in ./managed/commitment/contract/index.d.ts:
//   callerRole(context): [PS, number]
//   boardSignatures(context, eventHash): [PS, { is_some, value }[]]
//
// PrivateState here just needs to carry whatever the caller's local wallet/session
// already knows: which Role it is acting as, and — for board approvals — the set of
// director signatures collected out of band (e.g. via a UI approval flow) before the
// appendEvent transaction is built.

export interface CommitmentPrivateState {
  /** 0=NONE 1=BANK_A 2=BANK_B 3=CENTRAL_AUTHORITY 4=REGULATORY_COUNCIL — matches the Role enum order in commitment.compact. */
  callerRole: number;
  /** Up to 4 director signatures collected for the event currently being appended, keyed by event hash hex. */
  pendingBoardSignatures: Record<string, Array<Uint8Array | undefined>>;
}

export const commitmentPrivateStateId = 'commitmentPrivateState';

export const createCommitmentWitnesses = () => ({
  callerRole(context: { privateState: CommitmentPrivateState }): [CommitmentPrivateState, number] {
    return [context.privateState, context.privateState.callerRole];
  },

  boardSignatures(
    context: { privateState: CommitmentPrivateState },
    eventHash: Uint8Array,
  ): [CommitmentPrivateState, Array<{ is_some: boolean; value: Uint8Array }>] {
    const key = Buffer.from(eventHash).toString('hex');
    const sigs = context.privateState.pendingBoardSignatures[key] ?? [];
    const padded: Array<{ is_some: boolean; value: Uint8Array }> = [];
    for (let i = 0; i < 4; i++) {
      const sig = sigs[i];
      padded.push({ is_some: sig !== undefined, value: sig ?? new Uint8Array(32) });
    }
    return [context.privateState, padded];
  },
});
