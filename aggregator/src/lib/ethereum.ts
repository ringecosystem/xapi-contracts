import { near } from "near-sdk-js";
import { encodeRlp, BytesLike, RlpStructuredDataish } from "./rlp";


//   /**
//    * Returns a Uint8Array Array of the raw Bytes of the EIP-1559 transaction, in order.
//    *
//    * Format: `[chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit, to, value, data,
//    * accessList, signatureYParity, signatureR, signatureS]`
//    *
//    * Use {@link FeeMarketEIP1559Transaction.serialize} to add a transaction to a block
//    * with {@link Block.fromValuesArray}.
//    *
//    * For an unsigned tx this method uses the empty Bytes values for the
//    * signature parameters `v`, `r` and `s` for encoding. For an EIP-155 compliant
//    * representation for external signing use {@link FeeMarketEIP1559Transaction.getMessageToSign}.
//    */
//   raw() {
//     return [
//       bigIntToUnpaddedBytes(this.chainId),
//       bigIntToUnpaddedBytes(this.nonce),
//       bigIntToUnpaddedBytes(this.maxPriorityFeePerGas),
//       bigIntToUnpaddedBytes(this.maxFeePerGas),
//       bigIntToUnpaddedBytes(this.gasLimit),
//       this.to !== void 0 ? this.to.bytes : new Uint8Array(0),
//       bigIntToUnpaddedBytes(this.value),
//       this.data,
//       this.accessList,
//       this.v !== void 0 ? bigIntToUnpaddedBytes(this.v) : new Uint8Array(0),
//       this.r !== void 0 ? bigIntToUnpaddedBytes(this.r) : new Uint8Array(0),
//       this.s !== void 0 ? bigIntToUnpaddedBytes(this.s) : new Uint8Array(0)
//     ];
//   }

//   /**
//    * Returns the raw serialized unsigned tx, which can be used
//    * to sign the transaction (e.g. for sending to a hardware wallet).
//    *
//    * Note: in contrast to the legacy tx the raw message format is already
//    * serialized and doesn't need to be RLP encoded any more.
//    *
//    * ```javascript
//    * const serializedMessage = tx.getMessageToSign() // use this for the HW wallet input
//    * ```
//    */
//   getMessageToSign() {
//     console.log("getMessageToSign", this, this.raw());
//     return serialize(this, this.raw().slice(0, 9));
//   }

//   // node_modules/@ethereumjs/tx/dist/esm/capabilities/eip2718.js
// function getHashedMessageToSign(tx) {
//     const keccakFunction = tx.common.customCrypto.keccak256 ?? keccak256;
//     return keccakFunction(tx.getMessageToSign());
//   }

//   serialize(tx, base) {
//     return concatBytes(txTypeBytes(tx.type), RLP.encode(base ?? tx.raw()));
//   }


type Address = BytesLike;
type AccessList = Array<[Address, Array<BytesLike>]>;

const EIP_1559_TYPE: number = 0x02;

function toHexString(value: BytesLike | bigint | number): string {
    if (typeof value === 'bigint' || typeof value === 'number') {
        return '0x' + value.toString(16);
    }
    if (typeof value === 'string') {
        return value.startsWith('0x') ? value : '0x' + value;
    }
    return '0x' + Array.from(value, (byte) => ('0' + (byte & 0xFF).toString(16)).slice(-2)).join('');
}

function hexToBytes(hex: string): Uint8Array {
    if (hex.startsWith('0x')) hex = hex.slice(2);
    if (hex.length % 2) hex = '0' + hex;
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
}

export function parseEthAddress(address: string): Address {
    address = address.toLowerCase();
    if (!address.startsWith('0x')) {
        address = '0x' + address;
    }
    if (!/^0x[0-9a-f]{40}$/i.test(address)) {
        throw new Error("Invalid Ethereum address format");
    }
    return address;
}

function bigIntToUnpaddedBytes(value: BigInt): Uint8Array {
    let hexString = value.toString(16);

    if (hexString.length % 2 !== 0) {
        hexString = '0' + hexString;
    }

    const bytes = new Uint8Array(hexString.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hexString.slice(i * 2, i * 2 + 2), 16);
    }

    return bytes;
}

export function ethereumTransaction({
    chainId,
    nonce,
    maxPriorityFeePerGas,
    maxFeePerGas,
    gasLimit,
    to,
    value,
    data,
    accessList
}:
    {
        chainId: bigint,
        nonce: bigint,
        maxPriorityFeePerGas: bigint,
        maxFeePerGas: bigint,
        gasLimit: bigint,
        to: string,
        value: bigint,
        data: BytesLike,
        accessList: AccessList
    }
): Uint8Array {
    const rawData: RlpStructuredDataish = [
        bigIntToUnpaddedBytes(chainId),
        bigIntToUnpaddedBytes(nonce),
        bigIntToUnpaddedBytes(maxPriorityFeePerGas),
        bigIntToUnpaddedBytes(maxFeePerGas),
        bigIntToUnpaddedBytes(gasLimit),
        hexToBytes(to),
        bigIntToUnpaddedBytes(value),
        data,
        accessList
    ];
    near.log("rawData", rawData);

    const rlpEncoded = encodeRlp(rawData);
    const rlpEncodedBytes = new Uint8Array(hexToBytes(rlpEncoded.slice(2)));
    const messageToSign = new Uint8Array(rlpEncodedBytes.length + 1);
    messageToSign[0] = EIP_1559_TYPE;
    messageToSign.set(rlpEncodedBytes, 1);
    near.log("messageToSign", messageToSign)
    return near.keccak256(messageToSign);
}