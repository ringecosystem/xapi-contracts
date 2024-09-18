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
    ReporterRequired reporterRequired;
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
    bool suspended;
}

struct ReporterRequired {
    uint8 quorum;
    uint8 threshold;
}

interface IXAPI {
    event RequestMade(
        uint256 indexed requestId,
        string aggregator,
        string requestData,
        address indexed requester,
        ReporterRequired reporterRequired
    );
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

    function makeRequest(
        string memory requestData,
        bytes4 callbackFunction,
        string memory aggregator,
        ReporterRequired memory reporterRequired
    ) external payable returns (uint256);

    function fulfill(uint256 requestId, ResponseData memory response) external;

    function retryFulfill(uint256 requestId) external;

    function withdrawRewards() external;

    function setAggregatorConfig(
        string memory aggregator,
        uint256 perReporterFee,
        uint256 publishFee,
        address fulfillAddress,
        address rewardAddress
    ) external;

    function suspendAggregator(string memory aggregator) external;
}
