// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

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
        requestData._startDataSource("httpbin", "get", "https://httpbin.org/get?a=4", "");
        requestData._endDataSource();
        requestData._finalizeRequest();

        uint256 fee = xapi.fee(exAggregator);
        payable(msg.sender).transfer(msg.value - fee);
        uint256 requestId = xapi.makeRequest{value: fee}(requestData);
        emit RequestMade(requestId, requestData);
    }

    function makeMultiRequest(address exAggregator) external payable {
        XAPIBuilder.Request memory requestData;
        requestData._initialize(exAggregator, this.xapiCallback.selector);

        requestData._startDataSource("httpbin", "get", "https://httpbin.org/get", "args.a");
        requestData._addParam("a", "3");
        requestData._endDataSource();

        requestData._startDataSource("httpbin2", "get", "https://httpbin.org/get", "args.b");
        requestData._addParam("b", "3");
        requestData._addParamUint("d", 5);
        requestData._endDataSource();

        requestData._finalizeRequest();

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
