/**
 * Token-2022 mint extension detection, for the entry gate the whitepaper
 * marks as mandatory (§9.1).
 *
 * These are not exotic. A transfer hook runs arbitrary program code on every
 * transfer, so a mint can pass every authority check and still refuse to let
 * you sell. A permanent delegate can move your holdings without your
 * signature. A transfer fee whose config authority still exists can be
 * raised to 100% after entry, which is why checking the *current* fee is
 * not sufficient and the authority itself has to be revoked.
 *
 * Layout verified against the Token-2022 program source and the Solana
 * docs rather than assumed:
 *   bytes   0..82  base SPL Mint (identical to classic Token)
 *   bytes  82..165 zero padding, so a mint cannot be confused with a
 *                  165-byte token account
 *   byte      165  AccountType discriminator (1 = Mint)
 *   bytes  166..   TLV entries: u16 LE type, u16 LE length, then value
 */

const BASE_ACCOUNT_LEN = 165;
const ACCOUNT_TYPE_INDEX = BASE_ACCOUNT_LEN;
const TLV_START = ACCOUNT_TYPE_INDEX + 1;
const TLV_HEADER_LEN = 4;
const ACCOUNT_TYPE_MINT = 1;

/** ExtensionType discriminants (u16). Only the ones this gate reasons about. */
const EXT_TRANSFER_FEE_CONFIG = 1;
const EXT_NON_TRANSFERABLE = 9;
const EXT_PERMANENT_DELEGATE = 12;
const EXT_TRANSFER_HOOK = 14;
const EXT_PAUSABLE = 26;

/* Offsets inside TransferFeeConfig. A TransferFee is {epoch u64, maximumFee
   u64, transferFeeBasisPoints u16} = 18 bytes, and the config holds two of
   them (the older one still applies in the current epoch, so both matter). */
const TFC_AUTHORITY_OFFSET = 0;
const TFC_OLDER_FEE_OFFSET = 72;
const TFC_NEWER_FEE_OFFSET = 90;
const TRANSFER_FEE_BPS_OFFSET = 16;

/** Offset of programId inside TransferHook (authority occupies 0..32). */
const HOOK_PROGRAM_ID_OFFSET = 32;

export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export type MintExtensionFacts = {
  /** False for a classic SPL mint, which cannot carry any of this. */
  isToken2022: boolean;
  nonTransferable: boolean;
  hasPermanentDelegate: boolean;
  /** A hook whose program id is set. A nil program id invokes nothing. */
  hasTransferHook: boolean;
  pausable: boolean;
  /** Highest basis points across both fee epochs, null when no fee config. */
  transferFeeBps: number | null;
  /** True when the fee can still be changed after entry. */
  transferFeeAuthorityActive: boolean;
  /** Extension type ids seen, for the refusal record and for diagnosis. */
  extensionTypes: number[];
};

export const NO_EXTENSIONS: MintExtensionFacts = {
  isToken2022: false,
  nonTransferable: false,
  hasPermanentDelegate: false,
  hasTransferHook: false,
  pausable: false,
  transferFeeBps: null,
  transferFeeAuthorityActive: false,
  extensionTypes: [],
};

/** An OptionalNonZeroPubkey: 32 zero bytes encode None. */
function pubkeyIsSet(bytes: Buffer, offset: number): boolean {
  if (offset + 32 > bytes.length) return false;
  for (let i = offset; i < offset + 32; i++) {
    if (bytes[i] !== 0) return true;
  }
  return false;
}

function readFeeBps(value: Buffer, feeOffset: number): number | null {
  const at = feeOffset + TRANSFER_FEE_BPS_OFFSET;
  if (at + 2 > value.length) return null;
  return value.readUInt16LE(at);
}

/**
 * Walks the TLV area of a mint account.
 *
 * Deliberately tolerant of a truncated or malformed trailer: it stops
 * walking rather than throwing, and reports what it managed to read. The
 * caller treats "could not read" as a refusal (§9.4 fail-closed), so a
 * parse that gives up never becomes an accidental approval.
 */
export function parseMintExtensions(
  data: Buffer,
  ownerProgramId: string
): MintExtensionFacts {
  if (ownerProgramId !== TOKEN_2022_PROGRAM_ID) return NO_EXTENSIONS;
  if (data.length <= ACCOUNT_TYPE_INDEX) {
    // A Token-2022 mint with no extensions is still only 82 bytes.
    return { ...NO_EXTENSIONS, isToken2022: true };
  }
  if (data[ACCOUNT_TYPE_INDEX] !== ACCOUNT_TYPE_MINT) {
    return { ...NO_EXTENSIONS, isToken2022: true };
  }

  const facts: MintExtensionFacts = {
    ...NO_EXTENSIONS,
    isToken2022: true,
    extensionTypes: [],
  };

  let cursor = TLV_START;
  while (cursor + TLV_HEADER_LEN <= data.length) {
    const type = data.readUInt16LE(cursor);
    const length = data.readUInt16LE(cursor + 2);
    const valueStart = cursor + TLV_HEADER_LEN;
    const valueEnd = valueStart + length;
    if (type === 0 && length === 0) break; // padding / end of entries
    if (valueEnd > data.length) break; // truncated trailer, stop walking
    const value = data.subarray(valueStart, valueEnd);
    facts.extensionTypes.push(type);

    switch (type) {
      case EXT_NON_TRANSFERABLE:
        facts.nonTransferable = true;
        break;
      case EXT_PAUSABLE:
        facts.pausable = true;
        break;
      case EXT_PERMANENT_DELEGATE:
        // Present but nil means nobody holds the delegation.
        facts.hasPermanentDelegate = pubkeyIsSet(value, 0);
        break;
      case EXT_TRANSFER_HOOK:
        facts.hasTransferHook = pubkeyIsSet(value, HOOK_PROGRAM_ID_OFFSET);
        break;
      case EXT_TRANSFER_FEE_CONFIG: {
        const older = readFeeBps(value, TFC_OLDER_FEE_OFFSET);
        const newer = readFeeBps(value, TFC_NEWER_FEE_OFFSET);
        /* The higher of the two epochs. The older fee is still the one in
           force until the newer one's epoch arrives, so taking only the
           newer value would understate what a sale costs right now. */
        const bps = [older, newer].filter((n): n is number => n != null);
        facts.transferFeeBps = bps.length > 0 ? Math.max(...bps) : null;
        facts.transferFeeAuthorityActive = pubkeyIsSet(value, TFC_AUTHORITY_OFFSET);
        break;
      }
      default:
        break;
    }

    // Zero-length entries are legal (NonTransferable carries no value), so
    // advancing past the header alone is correct and still makes progress.
    cursor = valueEnd;
  }

  return facts;
}

/**
 * The reasons a mint's extensions disqualify it, as operator-facing text.
 * Empty array means nothing here objects.
 *
 * Thresholds are fixed rather than configurable: these are not risk
 * preferences an operator tunes, they are conditions under which an exit
 * may be impossible, and the whitepaper's refuse-by-default stance makes
 * them the platform's floor rather than a knob.
 */
export function extensionRefusalReasons(
  facts: MintExtensionFacts,
  maxTransferFeeBps: number
): string[] {
  const reasons: string[] = [];
  if (facts.nonTransferable) {
    reasons.push("mint is non-transferable: the position could never be sold");
  }
  if (facts.hasTransferHook) {
    reasons.push(
      "mint has an active transfer hook: arbitrary program code runs on every transfer and can block a sale"
    );
  }
  if (facts.hasPermanentDelegate) {
    reasons.push(
      "mint has a permanent delegate: a third party can move holdings without our signature"
    );
  }
  if (facts.pausable) {
    reasons.push("mint is pausable: transfers can be frozen after entry");
  }
  if (facts.transferFeeBps != null && facts.transferFeeBps > maxTransferFeeBps) {
    reasons.push(
      `transfer fee ${(facts.transferFeeBps / 100).toFixed(2)}% exceeds the ${(maxTransferFeeBps / 100).toFixed(2)}% limit`
    );
  }
  if (facts.transferFeeAuthorityActive) {
    reasons.push(
      "transfer fee config authority is not revoked: the fee can be raised after entry"
    );
  }
  return reasons;
}
