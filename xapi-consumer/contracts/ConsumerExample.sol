// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "xapi/contracts/interfaces/IXAPI.sol";

contract ConsumerExample {
    IXAPI public xapi;

    event RequestMade(uint256 requestId, string requestData);
    event ConsumeResult(uint256 requestId, bytes responseData);

    constructor(address xapiAddress) {
        xapi = IXAPI(xapiAddress);
    }

    function setXAPIAddress(address xapiAddress) external {
        xapi = IXAPI(xapiAddress);
    }

    function makeRequest(string memory aggregator) external payable {
        string memory requestData = "{'hello':'world'}";
        uint256 requestId = xapi.makeRequest{value: msg.value}(requestData, this.fulfillCallback.selector, aggregator);
        emit RequestMade(requestId, requestData);
    }

    function fulfillCallback(uint256 requestId, ResponseData memory response) external {
        require(msg.sender == address(xapi), "Only XAPI can call this function");

        emit ConsumeResult(requestId, response.result);
    }
}