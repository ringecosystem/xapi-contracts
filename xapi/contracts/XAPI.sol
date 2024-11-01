// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./interfaces/IXAPI.sol";

contract XAPI is Initializable, IXAPI, Ownable2StepUpgradeable, UUPSUpgradeable {
    uint256 public requestCount;
    mapping(uint256 => Request) public requests;
    mapping(address => AggregatorConfig) public aggregatorConfigs;
    mapping(address => uint256) public rewards;

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner) public initializer {
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();
    }

    function makeRequest(address exAggregator, string memory requestData, bytes4 callbackFunction)
        external
        payable
        override
        returns (uint256)
    {
        require(msg.sender != address(this), "CANT call self");
        AggregatorConfig memory aggregatorConfig = aggregatorConfigs[exAggregator];
        require(aggregatorConfig.rewardAddress != address(0), "!Aggregator");
        require(!aggregatorConfig.suspended, "Suspended");

        uint256 feeRequired = aggregatorConfig.reportersFee + aggregatorConfig.publishFee;
        require(msg.value == feeRequired, "!value");

        requestCount++;
        uint256 requestId = encodeRequestId(requestCount);
        requests[requestId] = Request({
            requester: msg.sender,
            callbackContract: msg.sender,
            callbackFunction: callbackFunction,
            status: RequestStatus.Pending,
            payment: msg.value,
            aggregator: aggregatorConfig.aggregator,
            exAggregator: exAggregator,
            response: ResponseData({reporters: new address[](0), result: new bytes(0), errorCode: 0}),
            requestData: requestData
        });
        emit RequestMade(
            requestId,
            aggregatorConfig.aggregator,
            requestData,
            msg.sender,
            exAggregator,
            aggregatorConfig.reportersFee,
            aggregatorConfig.publishFee
        );
        return requestId;
    }

    function fulfill(uint256 requestId, ResponseData memory response) external override {
        Request storage request = requests[requestId];
        require(decodeChainId(requestId) == block.chainid, "!chainId");
        require(request.exAggregator != address(0), "!Request");
        require(msg.sender == request.exAggregator, "!exAggregator address");
        require(request.status == RequestStatus.Pending, "!Pending");

        request.response = response;

        AggregatorConfig memory aggregatorConfig = aggregatorConfigs[msg.sender];
        // Avoid changing the reward configuration after the request but before the response to obtain the contract balance
        require(aggregatorConfig.publishFee + aggregatorConfig.reportersFee <= request.payment, "Insufficient rewards");
        for (uint256 i = 0; i < response.reporters.length; i++) {
            rewards[response.reporters[i]] += aggregatorConfig.reportersFee / response.reporters.length;
        }
        rewards[aggregatorConfig.rewardAddress] += aggregatorConfig.publishFee;

        (bool success,) =
            request.callbackContract.call(abi.encodeWithSelector(request.callbackFunction, requestId, response));

        request.status = success ? RequestStatus.Fulfilled : RequestStatus.CallbackFailed;

        emit Fulfilled(requestId, request.response, request.status);
    }

    function retryFulfill(uint256 requestId) external override {
        Request storage request = requests[requestId];
        require(request.status == RequestStatus.CallbackFailed, "!Callback failed request");
        require(msg.sender == request.requester, "!Requester");

        (bool success,) =
            request.callbackContract.call(abi.encodeWithSelector(request.callbackFunction, requestId, request.response));

        request.status = success ? RequestStatus.Fulfilled : RequestStatus.CallbackFailed;

        emit Fulfilled(requestId, request.response, request.status);
    }

    function withdrawRewards() external override {
        uint256 amount = rewards[msg.sender];
        require(amount > 0, "Insufficient rewards");

        rewards[msg.sender] = 0;
        emit RewardsWithdrawn(msg.sender, amount);

        payable(msg.sender).transfer(amount);
    }

    function setAggregatorConfig(
        string memory aggregator,
        uint256 reportersFee,
        uint256 publishFee,
        address rewardAddress,
        uint256 version
    ) external override {
        aggregatorConfigs[msg.sender] = AggregatorConfig({
            aggregator: aggregator,
            reportersFee: reportersFee,
            publishFee: publishFee,
            rewardAddress: rewardAddress,
            version: version,
            suspended: false
        });

        emit AggregatorConfigSet(msg.sender, reportersFee, publishFee, aggregator, rewardAddress, version);
    }

    function fee(address exAggregator) external view override returns (uint256) {
        AggregatorConfig memory aggregatorConfig = aggregatorConfigs[exAggregator];
        require(aggregatorConfig.rewardAddress != address(0), "!Aggregator");
        return aggregatorConfig.reportersFee + aggregatorConfig.publishFee;
    }

    function suspendAggregator(address exAggregator) external override onlyOwner {
        require(aggregatorConfigs[exAggregator].rewardAddress != address(0), "!Aggregator");
        aggregatorConfigs[exAggregator].suspended = true;

        emit AggregatorSuspended(exAggregator, aggregatorConfigs[exAggregator].aggregator);
    }

    function encodeRequestId(uint256 count) internal view returns (uint256) {
        return (block.chainid << 192) | count;
    }

    function decodeChainId(uint256 requestId) internal pure returns (uint256) {
        return requestId >> 192;
    }
}
