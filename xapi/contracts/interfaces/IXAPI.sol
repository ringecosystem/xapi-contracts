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
    address exAggregator;
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
    // Aggregator account on near
    string aggregator;
    address rewardAddress;
    uint256 reportersFee;
    uint256 publishFee;
    bool suspended;
}

interface IXAPI {
    event RequestMade(
        uint256 indexed requestId,
        string aggregator,
        string requestData,
        address indexed requester,
        address indexed exAggregator,
        uint256 reportersFee,
        uint256 publishFee
    );
    event Fulfilled(uint256 indexed requestId, ResponseData response, RequestStatus indexed status);
    event RewardsWithdrawn(address indexed withdrawer, uint256 amount);
    event AggregatorConfigSet(
        address indexed exAggregator, uint256 reportersFee, uint256 publishFee, string aggregator, address rewardAddress
    );
    event AggregatorSuspended(address indexed exAggregator, string indexed aggregator);

    function makeRequest(string memory requestData, bytes4 callbackFunction, address exAggregator)
        external
        payable
        returns (uint256);

    function fulfill(uint256 requestId, ResponseData memory response) external;

    function retryFulfill(uint256 requestId) external;

    function withdrawRewards() external;

    // Should be called by Aggregator mpc
    function setAggregatorConfig(
        string memory aggregator,
        uint256 reportersFee,
        uint256 publishFee,
        address rewardAddress
    ) external;

    function suspendAggregator(address exAggregator) external;
}
