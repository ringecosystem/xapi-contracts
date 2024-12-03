import { near } from "near-sdk-js";
import { encodeRlp, BytesLike, RlpStructuredDataish, getBytes } from "./rlp";
import { AggregatorConfigEip712, Eip712Domain, PublishChainConfig } from "../abstract/aggregator.abstract";

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
    // near.log("messageToSign", Array.from(messageToSign))

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
        // near.log(`encode bytes: ${encodedValue}, value: ${value}`)
        const lengthHex = (encodedValue.length / 2).toString(16);
        const paddedLength = lengthHex.padStart(64, '0');

        const remainder = encodedValue.length % 64;
        const paddingSize = remainder === 0 ? 0 : (64 - remainder);
        const paddedEncodedValue = encodedValue.padEnd(encodedValue.length + paddingSize, '0');
        return paddedLength + paddedEncodedValue;
    }
    // near.log(`Encode calldata, Unsupported type: ${type}, value: ${value}`)
}

export function getFunctionSelector(functionSignature: string) {
    const bytes = Uint8Array.from(Array.from(functionSignature).map(letter => letter.charCodeAt(0)));
    const keccakArray = near.keccak256(bytes);
    const hexStr = toHexString(keccakArray).substring(0, 10);
    // near.log("function selector", hexStr);
    return hexStr;
}

export function encodePublishCall({ functionSignature, params }: { functionSignature: string, params: any[] }): string {
    const selector = getFunctionSelector(functionSignature);
    // near.log(`selector: ${selector}`)

    // encode address[]
    const addressesParams = params[1][0];
    const addresses = addressesParams.map((addr: string) => encodeParameter('address', addr)).join('');
    const addressesLength = (addressesParams.length).toString(16).padStart(64, '0');
    const addressesData = addressesLength + addresses;

    // encode bytes
    const bytesParams = params[1][1]
    const bytesValue = encodeParameter('bytes', bytesParams);

    // encode uint16
    const uint16Value = encodeParameter('uint256', params[1][2]);

    // offset
    const offsetTuple = (64).toString(16).padStart(64, '0');
    const offsetAddresses = (96).toString(16).padStart(64, '0');
    const offsetBytes = ((96 + addressesData.length / 2).toString(16)).padStart(64, '0');

    const encodeParams = [
        encodeParameter("uint256", params[0]),
        offsetTuple,
        offsetAddresses,
        offsetBytes,
        uint16Value,
        addressesData,
        bytesValue,
    ].join('');
    return selector + encodeParams;
}

export function encodeSetConfigCall({ functionSignature, params }: { functionSignature: string, params: any[] }): string {
    const selector = getFunctionSelector(functionSignature);
    // near.log(`selector: ${selector}`)

    // Aggregator account string offset
    const offsetString = (160).toString(16).padStart(64, '0');

    const encodeParams = [
        offsetString,
        encodeParameter("uint256", params[1]),
        encodeParameter("uint256", params[2]),
        encodeParameter("address", params[3]),
        encodeParameter("uint256", params[4]),
        encodeParameter("bytes", stringToBytes(params[0])),
    ].join('');
    return selector + encodeParams;
}

export function stringToBytes(str: string): string {
    if (!str) {
        return "0x";
    }
    const bytes: number[] = [];
    for (let i = 0; i < str.length; i++) {
        bytes.push(str.charCodeAt(i));
    }
    // near.log(`bytes: ${bytes}, string: ${str}`);
    return '0x' + bytes.map(byte => ('0' + byte.toString(16)).slice(-2)).join('');
}

//========================= eip712

export function hexKeccak256(value: Uint8Array): string {
    return toHexString(near.keccak256(value));
}

export function concatHex(hexStr: string[]): string {
    return "0x"+hexStr.map(v=>v.substring(2)).join("");
}

/**
 *  Returns the UTF-8 byte representation of %%str%%.
 *
 *  Copy from ethers/utils/utf8.ts
 */
export function toUtf8Bytes(str: string): Uint8Array {
    let result: Array<number> = [];
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);

        if (c < 0x80) {
            result.push(c);

        } else if (c < 0x800) {
            result.push((c >> 6) | 0xc0);
            result.push((c & 0x3f) | 0x80);

        } else if ((c & 0xfc00) == 0xd800) {
            i++;
            const c2 = str.charCodeAt(i);

            // Surrogate Pair
            const pair = 0x10000 + ((c & 0x03ff) << 10) + (c2 & 0x03ff);
            result.push((pair >> 18) | 0xf0);
            result.push(((pair >> 12) & 0x3f) | 0x80);
            result.push(((pair >> 6) & 0x3f) | 0x80);
            result.push((pair & 0x3f) | 0x80);

        } else {
            result.push((c >> 12) | 0xe0);
            result.push(((c >> 6) & 0x3f) | 0x80);
            result.push((c & 0x3f) | 0x80);
        }
    }

    return new Uint8Array(result);
};

export function getDomainSeparator(domain: Eip712Domain) {
    const typeHash = hexKeccak256(
        toUtf8Bytes(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        )
    );
    near.log(`getDomainSeparator typeHash: ${typeHash}`);
    const encodeParams = [
        encodeParameter("bytes32", typeHash),
        encodeParameter("bytes32", hexKeccak256(toUtf8Bytes(domain.name))),
        encodeParameter("bytes32", hexKeccak256(toUtf8Bytes(domain.version))),
        encodeParameter("uint256", domain.chainId),
        encodeParameter("address", domain.verifyingContract),
    ].join('');
    const domainHash = hexKeccak256(getBytes(`0x${encodeParams}`));
    near.log(`getDomainSeparator domainHash: ${domainHash}`);
    return domainHash;
}

/// AggregatorConfig EIP-712

//  const eip712Domain = {
//     "name": "XAPI",
//     "version": "1",
//     "chainId": "421614",
//     "verifyingContract": "0x9F33a4809aA708d7a399fedBa514e0A0d15EfA85"
//   };
//   const types = {
//     "AggregatorConfig": [
//       { name: "aggregator", type: "string" },
//       { name: "rewardAddress", type: "address" },
//       { name: "reportersFee", type: "uint256" },
//       { name: "publishFee", type: "uint256" },
//       { name: "version", type: "uint256" },
//     ]
//   }
//   const message = {
//     "aggregator": "test.aggregator.testnet",
//     "rewardAddress": "0x9F33a4809aA708d7a399fedBa514e0A0d15EfA85",
//     "reportersFee": BigInt(100),
//     "publishFee": BigInt(200),
//     "version": "1234567",
//   }
// Domain Separator: 0xb28dd75abd5a0660e551b73675ed9c8954852622e082aab51f795d20ba125d18
// struct type Hash 0xac9c0d5b4d00605c29266ffe9da206e8630a373e4204e116506d967ae0ea887d
// structHash: 0x60d8714266136f32813a1bc9d1e779091457d7258c2f4c8dd798100b909f10da
// Digest: 0x447924def85c3e6edab7627a7a0e483b6471f302f2bc0eb988a9fc7b1730bd9d
// To sign Message: 68,121,36,222,248,92,62,110,218,183,98,122,122,14,72,59,100,113,243,2,242,188,14,185,136,169,252,123,23,48,189,157

export function getAggregatorConfigStructHash(data: AggregatorConfigEip712) {
    const typeHash = hexKeccak256(
        toUtf8Bytes("AggregatorConfig(string aggregator,uint256 reportersFee,uint256 publishFee,uint256 version)")
    )
    // 0xac9c0d5b4d00605c29266ffe9da206e8630a373e4204e116506d967ae0ea887d
    near.log(`getAggregatorConfigStructHash typeHash: ${typeHash}`);

    const encodeParams = [
        encodeParameter("bytes32", typeHash),
        encodeParameter("bytes32", hexKeccak256(toUtf8Bytes(data.aggregator))),
        encodeParameter("uint256", data.reporters_fee),
        encodeParameter("uint256", data.publish_fee),
        encodeParameter("uint256", data.version),
    ].join('');
    const structHash = hexKeccak256(getBytes(`0x${encodeParams}`));
    near.log(`getAggregatorConfigStructHash structHash: ${structHash}`);
    return structHash;
}

export function buildAggregatorConfigEip712Payload(domain: Eip712Domain, data: AggregatorConfigEip712) {
    const domainSeparator = getDomainSeparator(domain);
    const sturctHash = getAggregatorConfigStructHash(data);
    const digest = hexKeccak256(
        getBytes(concatHex(["0x1901", domainSeparator, sturctHash]))
    );
    near.log(`buildAggregatorConfigEip712Payload digest: ${digest}`);
    const toSignMessage = getBytes(digest);
    near.log(`buildAggregatorConfigEip712Payload toSignMessage: ${toSignMessage}`)
    return toSignMessage;
}
