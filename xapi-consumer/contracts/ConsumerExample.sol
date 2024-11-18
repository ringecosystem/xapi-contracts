// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "./interfaces/IXAPIConsumer.sol";
import "xapi/contracts/interfaces/IXAPI.sol";
import "xapi/contracts/lib/XAPIBuilder.sol";

contract ConsumerExample is IXAPIConsumer {
    using XAPIBuilder for XAPIBuilder.Request;

    IXAPI public xapi;

    event RequestMade(uint256 indexed requestId, XAPIBuilder.Request requestData);
    event ConsumeResult(uint256 indexed requestId, bytes responseData, uint16 errorCode);
    event ConsumeError(uint256 indexed requestId, uint16 errorCode);

    constructor(address xapiAddress) {
        xapi = IXAPI(xapiAddress);
    }

    function setXAPIAddress(address xapiAddress) external {
        xapi = IXAPI(xapiAddress);
    }

    function makeRequest(address exAggregator) external payable {
        XAPIBuilder.Request memory requestData;
        requestData._initialize(exAggregator, this.xapiCallback.selector);

        uint256 fee = xapi.fee(exAggregator);
        payable(msg.sender).transfer(msg.value - fee);
        uint256 requestId = xapi.makeRequest{value: fee}(requestData);
        emit RequestMade(requestId, requestData);
    }

    function queryGraph(address exAggregator) external payable {
        XAPIBuilder.Request memory requestData;
        requestData._initialize(exAggregator, this.xapiCallback.selector);
        // When it is empty, it means that all data sources are used. Multiple data sources can be specified by separating them with commas.
        requestData._addParam("_dataSources", "11155111");
        // * for all data sources, or data source name for specified data source.
        requestData._startNestedParam("*");
        {
            requestData._addParam(
                "query",
                "query Accepted($chainId: BigInt!, $channel: String!, $msgIndex: BigInt!) {\n  messageAcceptedV2s(where: {messageFromChainId: $chainId, messageChannel: $channel, messageIndex: $msgIndex}) {\n    items {\n      msgHash\n    }\n  }\n}\n"
            );
            requestData._startNestedParam("variables");
            {
                requestData._addParamUint("chainId", 42161);
                requestData._addParam("channel", "0x13b2211a7cA45Db2808F6dB05557ce5347e3634e");
                requestData._addParamUint("msgIndex", 13);
            }
            requestData._endNestedParam();
        }
        requestData._endNestedParam();

        uint256 fee = xapi.fee(exAggregator);
        payable(msg.sender).transfer(msg.value - fee);
        uint256 requestId = xapi.makeRequest{value: fee}(requestData);
        emit RequestMade(requestId, requestData);
    }

    function xapiCallback(uint256 requestId, ResponseData memory response) external {
        require(msg.sender == address(xapi), "Only XAPI can call this function");
        if (response.errorCode == 0) {
            emit ConsumeResult(requestId, response.result, response.errorCode);
        } else {
            emit ConsumeError(requestId, response.errorCode);
        }
    }
}
