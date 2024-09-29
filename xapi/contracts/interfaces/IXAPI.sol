// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

struct Request {
    // Currently, aggregators is deployed on Near. So use `string` type.
    string aggregator;
    // JSON string
    string requestData;
    address requester;
    address callbackContract;
    bytes4 callbackFunction;
    RequestStatus status;
    address fulfillAddress;
    ResponseData response;
    uint256 payment;
}

enum RequestStatus {
    Pending,
    Fulfilled,
    CallbackFailed
}

struct ResponseData {
    address[] reporters;
    bytes result;
}

struct AggregatorConfig {
    address fulfillAddress;
    address rewardAddress;
    uint256 perReporterFee;
    uint256 publishFee;
    uint8 quorum;
    bool suspended;
}

interface IXAPI {
    event RequestMade(uint256 indexed requestId, string aggregator, string requestData, address indexed requester);
    event Fulfilled(uint256 indexed requestId, ResponseData response, RequestStatus indexed status);
    event RewardsWithdrawn(address indexed withdrawer, uint256 amount);
    event AggregatorConfigSet(
        string indexed aggregator,
        uint256 perReporterFee,
        uint256 publishFee,
        address fulfillAddress,
        address rewardAddress
    );
    event AggregatorSuspended(string indexed aggregator);

    function makeRequest(string memory requestData, bytes4 callbackFunction, string memory aggregator)
        external
        payable
        returns (uint256);

    function fulfill(uint256 requestId, ResponseData memory response) external;

    function retryFulfill(uint256 requestId) external;

    function withdrawRewards() external;

    function setAggregatorConfig(
        string memory aggregator,
        uint256 perReporterFee,
        uint256 publishFee,
        address fulfillAddress,
        address rewardAddress,
        uint8 quorum
    ) external;

    function suspendAggregator(string memory aggregator) external;
}
