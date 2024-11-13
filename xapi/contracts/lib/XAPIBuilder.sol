// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import {CBORChainlink} from "@chainlink/contracts/src/v0.8/vendor/CBORChainlink.sol";
import {BufferChainlink} from "@chainlink/contracts/src/v0.8/vendor/BufferChainlink.sol";

/**
 * @title Library for common XAPI functions
 * @dev Uses imported CBOR library for encoding to buffer
 * https://github.com/smartcontractkit/chainlink/blob/develop/contracts/src/v0.8/Chainlink.sol
 * https://github.com/smartcontractkit/chainlink/blob/develop/contracts/src/v0.8/ChainlinkClient.sol
 */
library XAPIBuilder {
    // solhint-disable-next-line chainlink-solidity/all-caps-constant-storage-variables
    uint256 internal constant defaultBufferSize = 256;

    using CBORChainlink for BufferChainlink.buffer;

    struct Request {
        // Derived address of aggregator account (on near)
        address exAggregator;
        bytes4 callbackFunctionId;
        BufferChainlink.buffer buf;
    }

    /**
     * @notice Initializes a XAPI request
     * @dev Sets the ID, callback address, and callback function signature on the request
     * @param self The uninitialized request
     * @param callbackFunc The callback function signature
     * @return The initialized request
     */
    function _initialize(Request memory self, address exAggregator, bytes4 callbackFunc)
        internal
        pure
        returns (XAPIBuilder.Request memory)
    {
        BufferChainlink.init(self.buf, defaultBufferSize);
        self.exAggregator = exAggregator;
        self.callbackFunctionId = callbackFunc;
        self.buf.startMap();
        return self;
    }

    /**
     * @notice Start build data source
     * @param self Request
     * @param method Request method
     * @param url Api url
     * @param resultPath Result path, split by `.`
     *
     */
    function _startDataSource(
        Request memory self,
        string memory name,
        string memory method,
        string memory url,
        string memory resultPath
    ) internal pure {
        self.buf.encodeString(name);
        self.buf.startMap();
        self.buf.encodeString("method");
        self.buf.encodeString(method);
        self.buf.encodeString("url");
        self.buf.encodeString(url);
        self.buf.encodeString("resultPath");
        self.buf.encodeString(resultPath);
        self.buf.encodeString("params");
        self.buf.startMap();
    }

    /**
     * @notice Start build data source
     * @param self Request
     * @param name Data source name
     * @param method Request method
     * @param url Api url
     * @param resultPath Result path, split by `.`
     * @param headers Request headers
     * @param auth For example: headers.Authorization:env.API_TOKEN,query.token:env:API_TOKEN,body.authorization.token:env.API_TOKEN
     *
     */
    function _startDataSourceEx(
        Request memory self,
        string memory name,
        string memory method,
        string memory url,
        string memory resultPath,
        string memory headers,
        string memory auth
    ) internal pure {
        self.buf.encodeString(name);
        self.buf.startMap();
        self.buf.encodeString("method");
        self.buf.encodeString(method);
        self.buf.encodeString("url");
        self.buf.encodeString(url);
        self.buf.encodeString("resultPath");
        self.buf.encodeString(resultPath);
        self.buf.encodeString("headers");
        self.buf.encodeString(headers);
        self.buf.encodeString("auth");
        self.buf.encodeString(auth);
        self.buf.encodeString("params");
        self.buf.startMap();
    }

    function _endDataSource(Request memory self) internal pure {
        self.buf.endSequence();
        self.buf.endSequence();
    }

    function _finalizeRequest(Request memory self) internal pure {
        self.buf.endSequence();
    }

    /**
     * @notice Sets the data for the buffer without encoding CBOR on-chain
     * @dev CBOR can be closed with curly-brackets {} or they can be left off
     * @param self The initialized request
     * @param data The CBOR data
     */
    function _setBuffer(Request memory self, bytes memory data) internal pure {
        BufferChainlink.init(self.buf, data.length);
        BufferChainlink.append(self.buf, data);
    }

    /**
     * @notice Adds a string value to the request with a given key name
     * @param self The initialized request
     * @param key The name of the key
     * @param value The string value to add
     */
    function _addParam(Request memory self, string memory key, string memory value) internal pure {
        self.buf.encodeString(key);
        self.buf.encodeString(value);
    }

    /**
     * @notice Adds a bytes value to the request with a given key name
     * @param self The initialized request
     * @param key The name of the key
     * @param value The bytes value to add
     */
    function _addParamBytes(Request memory self, string memory key, bytes memory value) internal pure {
        self.buf.encodeString(key);
        self.buf.encodeBytes(value);
    }

    /**
     * @notice Adds a int256 value to the request with a given key name
     * @param self The initialized request
     * @param key The name of the key
     * @param value The int256 value to add
     */
    function _addParamInt(Request memory self, string memory key, int256 value) internal pure {
        self.buf.encodeString(key);
        self.buf.encodeInt(value);
    }

    /**
     * @notice Adds a uint256 value to the request with a given key name
     * @param self The initialized request
     * @param key The name of the key
     * @param value The uint256 value to add
     */
    function _addParamUint(Request memory self, string memory key, uint256 value) internal pure {
        self.buf.encodeString(key);
        self.buf.encodeUInt(value);
    }

    /**
     * @notice Adds an array of strings to the request with a given key name
     * @param self The initialized request
     * @param key The name of the key
     * @param values The array of string values to add
     */
    function _addParamStringArray(Request memory self, string memory key, string[] memory values) internal pure {
        self.buf.encodeString(key);
        self.buf.startArray();
        for (uint256 i = 0; i < values.length; i++) {
            self.buf.encodeString(values[i]);
        }
        self.buf.endSequence();
    }
}
