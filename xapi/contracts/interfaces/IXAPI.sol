// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../lib/XAPIBuilder.sol";

struct Request {
    // Currently, aggregators is deployed on Near. So use `string` type.
    string aggregator;
    XAPIBuilder.Request requestData;
    address requester;
    RequestStatus status;
    ResponseData response;
    uint256 reportersFee;
    uint256 publishFee;
}

enum RequestStatus {
    Pending,
    Fulfilled,
    CallbackFailed
}

struct ResponseData {
    address[] reporters;
    bytes result;
    // 0 if no error
    uint16 errorCode;
}

struct AggregatorConfig {
    // Aggregator account on near
    string aggregator;
    uint256 reportersFee;
    uint256 publishFee;
    uint256 version;
    bool suspended;
}

interface IXAPI {
    event RequestMade(
        uint256 indexed requestId,
        string aggregator,
        XAPIBuilder.Request requestData,
        address indexed requester,
        uint256 reportersFee,
        uint256 publishFee
    );
    event Fulfilled(uint256 indexed requestId, ResponseData response, RequestStatus indexed status);
    event RewardsWithdrawn(address indexed withdrawer, uint256 amount);
    event AggregatorConfigSet(
        address indexed exAggregator,
        uint256 reportersFee,
        uint256 publishFee,
        string aggregator,
        uint256 version
    );
    event AggregatorSuspended(address indexed exAggregator, string indexed aggregator);

    function makeRequest(XAPIBuilder.Request memory requestData)
        external
        payable
        returns (uint256);

    function fulfill(uint256 requestId, ResponseData memory response) external;

    function retryCallback(uint256 requestId) external;

    function withdrawRewards() external;

    // Should be called by Aggregator mpc
    function setAggregatorConfig(
        string memory aggregator,
        uint256 reportersFee,
        uint256 publishFee,
        uint256 version
    ) external;

    function fee(address exAggregator) external view returns (uint256);

    function suspendAggregator(address exAggregator) external;
}
