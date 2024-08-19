import { near } from "near-sdk-js";
import { encodeRlp, BytesLike, RlpStructuredDataish } from "./rlp";

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
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
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
    // Raw: Implement https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/tx/src/1559/tx.ts#L150
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
    // near.log("rawData", rawData);

    // Serialize: Implement https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/tx/src/capabilities/eip2718.ts#L17
    const rlpEncoded = encodeRlp(rawData);
    const rlpEncodedBytes = new Uint8Array(hexToBytes(rlpEncoded.slice(2)));
    const messageToSign = new Uint8Array(rlpEncodedBytes.length + 1);
    messageToSign[0] = EIP_1559_TYPE;
    messageToSign.set(rlpEncodedBytes, 1);
    // near.log("messageToSign", messageToSign)

    // GetHashedMessageToSign: Implement https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/tx/src/capabilities/eip2718.ts#L12
    return near.keccak256(messageToSign);
}

//========================= function call

function encodeParameter(type: string, value: any) {
    if (type === 'uint256') {
        return toHexString(BigInt(value)).slice(2).padStart(64, '0');
    } else if (type === 'bytes32') {
        return value.slice(2).padStart(64, '0');
    }
}

function getFunctionSelector(functionSignature: string) {
    const bytes = Uint8Array.from(Array.from(functionSignature).map(letter => letter.charCodeAt(0)));
    const keccakArray = near.keccak256(bytes);
    const hexStr = toHexString(keccakArray).substring(0, 10);
    near.log("function selector", hexStr);
    return hexStr;
}

export function encodeFunctionCall({ functionSignature, params }: { functionSignature: string, params: any[] }): string {
    const selector = getFunctionSelector(functionSignature);
    const encodedParams = params.map((param, index) => {
        const type = functionSignature.split('(')[1].split(')')[0].split(',')[index].trim();
        return encodeParameter(type, param);
    }).join('');
    near.log("encodedParams", encodedParams);
    return selector + encodedParams;
}