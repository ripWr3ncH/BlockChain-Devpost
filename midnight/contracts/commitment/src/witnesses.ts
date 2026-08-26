// QUORUM — private witnesses for the commitment contract.
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
  /**
   * Director approval secrets for the transaction currently being built. Each is the
   * preimage of the publicKeyCommitment that director registered on-ledger; it stays
   * in the witness and is never disclosed.
   *
   * Deliberately NOT keyed by event hash. The circuit takes an eventHash argument, but
   * it only uses it to ask for this bundle — an approval is a proof of knowledge of a
   * registered commitment, not a signature over the event, so keying the store by event
   * would imply a per-event binding that nothing actually enforces. See the board
   * threshold notes in README.md.
   */
  pendingBoardSignatures: Array<Uint8Array | undefined>;
  /**
   * The director key ids the secrets above belong to, slot for slot. Unlike the secrets
   * these ARE disclosed — the on-ledger `directors` registry is a public Map and the
   * circuit needs a public key to look a director up.
   */
  pendingBoardKeyIds: Array<Uint8Array | undefined>;
}

export const commitmentPrivateStateId = 'commitmentPrivateState';

/** Board approval slots per event — must match the Vector<4, ...> width in commitment.compact. */
export const BOARD_SLOTS = 4;

export const createCommitmentWitnesses = () => ({
  callerRole(context: { privateState: CommitmentPrivateState }): [CommitmentPrivateState, number] {
    return [context.privateState, context.privateState.callerRole];
  },

  boardSignatures(
    context: { privateState: CommitmentPrivateState },
    _eventHash: Uint8Array,
  ): [CommitmentPrivateState, Array<{ is_some: boolean; value: Uint8Array }>] {
    const sigs = context.privateState.pendingBoardSignatures;
    const padded: Array<{ is_some: boolean; value: Uint8Array }> = [];
    for (let i = 0; i < BOARD_SLOTS; i++) {
      const sig = sigs[i];
      padded.push({ is_some: sig !== undefined, value: sig ?? new Uint8Array(32) });
    }
    return [context.privateState, padded];
  },

  boardKeyIds(
    context: { privateState: CommitmentPrivateState },
    _eventHash: Uint8Array,
  ): [CommitmentPrivateState, Uint8Array[]] {
    const ids = context.privateState.pendingBoardKeyIds;
    const padded: Uint8Array[] = [];
    for (let i = 0; i < BOARD_SLOTS; i++) {
      // An empty slot gets all-zeroes, which will not match any registered
      // director, so the circuit scores it as not counting toward the threshold.
      padded.push(ids[i] ?? new Uint8Array(32));
    }
    return [context.privateState, padded];
  },
});
