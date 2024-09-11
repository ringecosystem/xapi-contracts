// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "./interfaces/IXAPI.sol";

contract XAPI is IXAPI, Ownable2Step {
    uint256 public requestCount;
    mapping(uint256 => Request) public requests;
    mapping(string => AggregatorConfig) public aggregatorConfigs;
    mapping(address => uint256) public rewards;

    constructor() Ownable(msg.sender) {}

    function makeRequest(
        string memory requestData,
        bytes4 callbackFunction,
        string memory aggregator,
        ReporterRequired memory reporterRequired
    ) external payable returns (uint256) {
        require(msg.sender != address(this), "CANT call self");
        AggregatorConfig memory aggregatorConfig = aggregatorConfigs[aggregator];
        require(aggregatorConfig.deriveAddress != address(0), "!Aggregator");
        require(!aggregatorConfig.suspended, "Suspended");

        uint256 feeRequired = aggregatorConfig.perReporterFee * reporterRequired.quorum + aggregatorConfig.publishFee;
        require(msg.value >= feeRequired, "Insufficient fees");

        requestCount++;
        uint256 requestId = encodeRequestId(requestCount);
        requests[requestId] = Request({
            requester: msg.sender,
            callbackContract: msg.sender,
            callbackFunction: callbackFunction,
            status: RequestStatus.Pending,
            payment: msg.value,
            aggregator: aggregator,
            fulfillAddress: aggregatorConfig.deriveAddress,
            reporterRequired: reporterRequired,
            response: ResponseData({reporters: new address[](0), result: new bytes(0)}),
            requestData: requestData
        });
        emit RequestMade(requestId, aggregator, requestData, msg.sender, reporterRequired);
        return requestId;
    }

    function fulfill(uint256 requestId, ResponseData memory response) external {
        Request storage request = requests[requestId];
        require(decodeChainId(requestId) == block.chainid, "!chainId");
        require(msg.sender == request.fulfillAddress, "!Fulfill address");
        require(request.status == RequestStatus.Pending, "!Pending");

        request.response = response;

        AggregatorConfig memory aggregatorConfig = aggregatorConfigs[request.aggregator];
        // Avoid changing the reward configuration after the request but before the response to obtain the contract balance
        require(
            aggregatorConfig.publishFee + aggregatorConfig.perReporterFee * response.reporters.length <= request.payment,
            "Insufficient rewards"
        );
        for (uint256 i = 0; i < response.reporters.length; i++) {
            rewards[response.reporters[i]] += aggregatorConfig.perReporterFee;
        }

        (bool success,) =
            request.callbackContract.call(abi.encodeWithSelector(request.callbackFunction, requestId, response));

        request.status = success ? RequestStatus.Fulfilled : RequestStatus.CallbackFailed;

        emit Fulfilled(requestId, request.response, request.status);
    }

    function retryFulfill(uint256 requestId) external {
        Request storage request = requests[requestId];
        require(request.status == RequestStatus.CallbackFailed, "!Callback failed request");
        require(msg.sender == request.requester, "!Requester");

        (bool success,) =
            request.callbackContract.call(abi.encodeWithSelector(request.callbackFunction, requestId, request.response));

        request.status = success ? RequestStatus.Fulfilled : RequestStatus.CallbackFailed;

        emit Fulfilled(requestId, request.response, request.status);
    }

    function withdrawRewards() external {
        uint256 amount = rewards[msg.sender];
        require(amount > 0, "Insufficient rewards");

        rewards[msg.sender] = 0;
        emit RewardsWithdrawn(msg.sender, amount);

        payable(msg.sender).transfer(amount);
    }

    function setAggregatorConfig(string memory aggregator, uint256 perReporterFee, uint256 publishFee)
        external
        onlyOwner
    {
        aggregatorConfigs[aggregator] = AggregatorConfig({
            deriveAddress: msg.sender,
            perReporterFee: perReporterFee,
            publishFee: publishFee,
            suspended: false
        });

        emit AggregatorConfigSet(aggregator, perReporterFee, publishFee);
    }

    function suspendAggregator(string memory aggregator) external onlyOwner {
        aggregatorConfigs[aggregator].suspended = true;

        emit AggregatorSuspended(aggregator);
    }

    function encodeRequestId(uint256 count) internal view returns (uint256) {
        return (block.chainid << 192) | count;
    }

    function decodeChainId(uint256 requestId) public pure returns (uint256) {
        return requestId >> 192;
    }
}
