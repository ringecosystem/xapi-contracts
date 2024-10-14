import { near } from "near-sdk-js";
import { encodeRlp, BytesLike, RlpStructuredDataish } from "./rlp";

type Address = BytesLike;
type AccessList = Array<[Address, Array<BytesLike>]>;

const EIP_1559_TYPE: number = 0x02;

export function toHexString(value: BytesLike | bigint | number): string {
    if (typeof value === 'bigint' || typeof value === 'number') {
        return '0x' + value.toString(16);
    }
    if (typeof value === 'string') {
        return value.startsWith('0x') ? value : '0x' + value;
    }
    return '0x' + Array.from(value, (byte) => ('0' + (byte & 0xFF).toString(16)).slice(-2)).join('');
}

export function hexToBytes(hex: string): Uint8Array {
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

export function bigIntToUnpaddedBytes(value: BigInt): Uint8Array {
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
        nonce > 0 ? bigIntToUnpaddedBytes(nonce) : new Uint8Array(),
        bigIntToUnpaddedBytes(maxPriorityFeePerGas),
        bigIntToUnpaddedBytes(maxFeePerGas),
        bigIntToUnpaddedBytes(gasLimit),
        hexToBytes(to),
        value > 0 ? bigIntToUnpaddedBytes(value) : new Uint8Array(),
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
    near.log("messageToSign", Array.from(messageToSign))

    // GetHashedMessageToSign: Implement https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/tx/src/capabilities/eip2718.ts#L12
    return near.keccak256(messageToSign);
}

//========================= function call

export function encodeParameter(type: string, value: any) {
    if (type === 'uint256') {
        return toHexString(BigInt(value)).slice(2).padStart(64, '0');
    } else if (type === 'bytes32') {
        return value.slice(2).padStart(64, '0');
    } else if (type === 'address') {
        return value.toLowerCase().slice(2).padStart(64, '0');
    } else if (type === 'bytes') {
        const encodedValue = toHexString(value).slice(2);
        near.log(`encode bytes: ${encodedValue}, value: ${value}`)
        const lengthHex = (encodedValue.length / 2).toString(16);
        const paddedLength = lengthHex.padStart(64, '0');

        const remainder = encodedValue.length % 64;
        const paddingSize = remainder === 0 ? 0 : (64 - remainder);
        const paddedEncodedValue = encodedValue.padEnd(encodedValue.length + paddingSize, '0');
        return paddedLength + paddedEncodedValue;
    }
    near.log(`Encode calldata, Unsupported type: ${type}, value: ${value}`)
}

export function getFunctionSelector(functionSignature: string) {
    const bytes = Uint8Array.from(Array.from(functionSignature).map(letter => letter.charCodeAt(0)));
    const keccakArray = near.keccak256(bytes);
    const hexStr = toHexString(keccakArray).substring(0, 10);
    // near.log("function selector", hexStr);
    return hexStr;
}

export function encodeFunctionCall({ functionSignature, params }: { functionSignature: string, params: any[] }): string {
    const selector = getFunctionSelector(functionSignature);
    const encodedParams = params.map((param, index) => {
        const type = functionSignature.split('(')[1].split(')')[0].split(',')[index].trim();
        return encodeParameter(type, param);
    }).join('');
    // near.log("encodedParams", encodedParams);
    return selector + encodedParams;
}

export function encodePublishCall({ functionSignature, params }: { functionSignature: string, params: any[] }): string {
    const selector = getFunctionSelector(functionSignature);
    near.log(`selector: ${selector}`)

    // encode address[]
    const addressesParams = params[1][0];
    const addresses = addressesParams.map((addr: string) => encodeParameter('address', addr)).join('');
    const addressesLength = (addressesParams.length).toString(16).padStart(64, '0');
    const addressesData = addressesLength + addresses;

    // encode bytes
    const bytesParams = params[1][1]
    const bytesValue = encodeParameter('bytes', bytesParams);

    // offset
    const offsetTuple = (64).toString(16).padStart(64, '0');
    const offsetAddresses = (64).toString(16).padStart(64, '0');
    const offsetBytes = ((64 + addressesData.length / 2).toString(16)).padStart(64, '0');

    const encodeParams = [
        encodeParameter("uint256", params[0]),
        offsetTuple,
        offsetAddresses,
        offsetBytes,
        addressesData,
        bytesValue
    ].join('');
    return selector + encodeParams;
}

export function encodeSetConfigCall({ functionSignature, params }: { functionSignature: string, params: any[] }): string {
    const selector = getFunctionSelector(functionSignature);
    near.log(`selector: ${selector}`)

    // Aggregator account string offset
    const offsetString = (128).toString(16).padStart(64, '0');

    const encodeParams = [
        offsetString,
        encodeParameter("uint256", params[1]),
        encodeParameter("uint256", params[2]),
        encodeParameter("address", params[3]),
        encodeParameter("bytes", stringToBytes(params[0]))
    ].join('');
    return selector + encodeParams;
}

export function stringToBytes(str: string): string {
    const bytes: number[] = [];
    for (let i = 0; i < str.length; i++) {
        bytes.push(str.charCodeAt(i));
    }
    near.log(`bytes: ${bytes}, string: ${str}`);
    return '0x' + bytes.map(byte => ('0' + byte.toString(16)).slice(-2)).join('');
}
