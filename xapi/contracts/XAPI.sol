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
    bool fulfilled;
    address fulfillAddress;
    bytes result;
    uint256 payment;
    ReporterRequired reporterRequired;
}

struct AggregatorConfig {
    address deriveAddress;
    uint256 perRepoterFee;
    uint256 publishFee;
    bool suspended;
}

struct ReporterRequired {
    uint256 quorum;
    uint256 threshold;
}

contract XAPI {
    event RequestMade(
        uint256 indexed requestId,
        string indexed aggregator,
        string requestData,
        address indexed requester,
        ReporterRequired reporterRequired
    );
    event Fulfilled(uint256 indexed requestId, bytes response);

    uint256 private requestCounter;
    mapping(uint256 => Request) private requests;
    mapping(string => AggregatorConfig) public aggregatorConfigs;
    mapping(address => uint256) public rewards;

    constructor() {}

    function makeRequest(
        string memory requestData,
        address callbackContract,
        bytes4 callbackFunction,
        string memory aggregator,
        ReporterRequired memory reporterRequired
    ) external payable returns (uint256) {
        AggregatorConfig memory aggregatorConfig = aggregatorConfigs[aggregator];
        require(aggregatorConfig.deriveAddress != address(0), "!Aggregator");
        require(!aggregatorConfig.suspended, "Suspended");

        uint256 feeRequired = aggregatorConfig.perRepoterFee * reporterRequired.quorum + aggregatorConfig.publishFee;
        require(msg.value >= feeRequired, "Insufficient fees");

        requestCounter++;
        uint256 requestId = encodeRequestId(requestCounter);
        requests[requestId] = Request({
            requester: msg.sender,
            callbackContract: callbackContract,
            callbackFunction: callbackFunction,
            fulfilled: false,
            payment: msg.value,
            aggregator: aggregator,
            fulfillAddress: aggregatorConfig.deriveAddress,
            reporterRequired: reporterRequired,
            result: new bytes(0),
            requestData: requestData
        });
        emit RequestMade(requestId, aggregator, requestData, msg.sender, reporterRequired);
        return requestId;
    }

    function fulfillRequest(uint256 requestId, bytes memory response) external {
        Request storage request = requests[requestId];
        require(decodeChainId(requestId) == block.chainid, "!chainId");
        require(
            keccak256(abi.encodePacked(msg.sender)) == keccak256(abi.encodePacked(request.fulfillAddress)),
            "!Fulfill address"
        );
        require(!request.fulfilled, "Fulfilled");

        request.fulfilled = true;
        // todo parse result or entire response?
        request.result = response;
        emit Fulfilled(requestId, response);

        (bool success,) =
            request.callbackContract.call(abi.encodeWithSelector(request.callbackFunction, requestId, response));
        require(success, "!Callback");

        // todo parse reporters from response, then distribute the rewards
        // payable(msg.sender).transfer(request.payment);
    }

    function encodeRequestId(uint256 counter) internal view returns (uint256) {
        return (block.chainid << 192) | counter;
    }

    function decodeChainId(uint256 requestId) public pure returns (uint256) {
        return requestId >> 192;
    }

    function decodeCounter(uint256 requestId) public pure returns (uint256) {
        return requestId & ((1 << 192) - 1);
    }

    function setAggregatorConfig(string memory aggregator, uint256 perRepoterFee, uint256 publishFee) external {
        aggregatorConfigs[aggregator] = AggregatorConfig({
            deriveAddress: msg.sender,
            perRepoterFee: perRepoterFee,
            publishFee: publishFee,
            suspended: false
        });
    }

    function suspendAggregator(string memory aggregator) external {
        aggregatorConfigs[aggregator].suspended = true;
    }
}
